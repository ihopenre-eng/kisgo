'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ScanFace,
  BookHeart,
  ArrowUp,
  Sparkles,
  Target,
  CircleHelp,
  X,
  RotateCcw,
  Check,
  LoaderCircle,
  Volume2,
  VolumeX,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Ball } from '@/components/ball';
import {
  judgeThrow,
  judgeContact,
  captureSucceeded,
  listFriends,
  writeFriend,
  deleteFriend,
  type FriendCard,
} from '@/lib/game';
import {
  gesture,
  launch,
  aimedLaunch,
  stepBody,
  sweepScreenTarget,
  unproject,
  project,
  focal,
  STEP,
  DEPTH,
  BALL_RADIUS,
  clamp,
  type Body,
  type Sample,
  type Vec3,
  type Viewport,
} from '@/lib/physics';
import type { BallView } from '@/lib/ball-view';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

type Face = { originX: number; originY: number; width: number; height: number };
type Phase = 'idle' | 'flying' | 'shaking' | 'caught';
const DETECTION_WIDTH = 320;
const DETECTION_INTERVAL = 240;
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const publicAsset = (path: string) => `${publicBasePath}${path}`;
export default function Home() {
  const [screen, setScreen] = useState<'capture' | 'collection'>('capture');
  const [phase, setPhase] = useState<Phase>('idle');
  const [modal, setModal] = useState<'help' | 'caught' | null>(null);
  const [cards, setCards] = useState<FriendCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [detail, setDetail] = useState<FriendCard | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState('');
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [modelReady, setModelReady] = useState(false);
  const [faceCount, setFaceCount] = useState(0);
  const [target, setTarget] = useState({ x: 50, y: 38, r: 71 });
  const [lockedTarget, setLockedTarget] = useState({
    x: 50,
    y: 38,
    r: 71,
    scale: 1,
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<FriendCard | null>(null);
  const [sound, setSound] = useState(false);
  const arena = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    ball = useRef<HTMLButtonElement>(null),
    ring = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null),
    detector = useRef<FaceDetector | null>(null),
    detectionCanvas = useRef<HTMLCanvasElement | null>(null),
    face = useRef<Face | null>(null);
  const alive = useRef(true),
    busy = useRef(false),
    cameraGeneration = useRef(0),
    misses = useRef(0),
    lastSeen = useRef(0);
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    samples: Sample[];
    spin: number;
    angle: number;
  } | null>(null);
  const view3d = useRef<BallView | null>(null);
  const cancelFlight = useRef<(() => void) | null>(null);
  const ballHome = useRef({
    x: 0,
    y: 0,
    depth: 2,
    view: { width: 400, height: 600 } as Viewport,
  });
  const [holding, setHolding] = useState(false);
  const [rendered3d, setRendered3d] = useState(false);
  const autoCameraStarted = useRef(false);
  const resetBall = useCallback(() => {
    const b = ball.current,
      a = arena.current;
    if (!a || !b || !a.clientWidth || !a.clientHeight) return;
    b.style.transform = '';
    const ar = a.getBoundingClientRect(),
      br = b.getBoundingClientRect();
    const view = { width: ar.width, height: ar.height };
    ballHome.current = {
      x: br.left + br.width / 2 - ar.left,
      y: br.top + br.height / 2 - ar.top,
      depth: (focal(view) * BALL_RADIUS) / 41,
      view,
    };
    const h = ballHome.current;
    view3d.current?.resize(view);
    view3d.current?.trail([], false);
    view3d.current?.pose(unproject(h.x, h.y, h.depth, view));
  }, []);
  useEffect(() => {
    let disposed = false;
    let ownedView: BallView | null = null;
    const host = arena.current;
    if (!host) return;
    const resize = () => {
      if (!busy.current && !pointer.current) resetBall();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    void import('@/lib/ball-view')
      .then(({ createBallView }) => {
        if (disposed) return;
        ownedView = createBallView(host, {
          width: host.clientWidth,
          height: host.clientHeight,
        });
        view3d.current = ownedView;
        setRendered3d(true);
        resetBall();
      })
      .catch(() => {
        if (!disposed)
          setMessage(
            '3D 그래픽을 사용할 수 없어 기본 볼로 표시해요. 물리는 동일하게 적용돼요.',
          );
      });
    return () => {
      disposed = true;
      observer.disconnect();
      ownedView?.dispose();
      view3d.current = null;
    };
  }, [resetBall]);
  const audio = useRef<AudioContext | null>(null);
  const disposeResources = useCallback(() => {
    cancelFlight.current?.();
    cameraGeneration.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    detector.current?.close();
    detector.current = null;
    detectionCanvas.current = null;
    void audio.current?.close();
    audio.current = null;
  }, []);
  const stopCamera = useCallback(() => {
    cameraGeneration.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    detector.current?.close();
    detector.current = null;
    detectionCanvas.current = null;
    face.current = null;
    setFaceCount(0);
    setModelReady(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    listFriends()
      .then((result) => {
        if (alive.current) setCards(result.filter((card) => !card.demo));
      })
      .catch(() => {
        if (alive.current)
          setError(
            '도감을 불러오지 못했어요. 브라우저 저장소 설정을 확인해주세요.',
          );
      })
      .finally(() => {
        if (alive.current) setLoadingCards(false);
      });
    return () => {
      alive.current = false;
      disposeResources();
    };
  }, [disposeResources]);
  useEffect(() => {
    if (!modelReady) return;
    let lastTime = -1;
    const timer = setInterval(() => {
      const v = video.current;
      if (
        !v ||
        !detector.current ||
        v.readyState < 2 ||
        v.currentTime === lastTime ||
        document.hidden ||
        busy.current ||
        pointer.current
      )
        return;
      lastTime = v.currentTime;
      try {
        const input =
          detectionCanvas.current ??= document.createElement('canvas');
        const detectionHeight = Math.max(
          180,
          Math.round(DETECTION_WIDTH * (v.videoHeight / v.videoWidth)),
        );
        if (input.width !== DETECTION_WIDTH) input.width = DETECTION_WIDTH;
        if (input.height !== detectionHeight) input.height = detectionHeight;
        const context = input.getContext('2d', { alpha: false });
        if (!context) return;
        context.drawImage(v, 0, 0, input.width, input.height);
        const result = detector.current.detectForVideo(input, performance.now());
        const count = result.detections.length;
        setFaceCount((current) => (current === count ? current : count));
        const detectedBox =
          result.detections.length === 1
            ? result.detections[0].boundingBox
            : undefined;
        const box = detectedBox
          ? {
              originX: detectedBox.originX * (v.videoWidth / input.width),
              originY: detectedBox.originY * (v.videoHeight / input.height),
              width: detectedBox.width * (v.videoWidth / input.width),
              height: detectedBox.height * (v.videoHeight / input.height),
            }
          : undefined;
        face.current = box ?? null;
        if (box && arena.current) {
          lastSeen.current = performance.now();
          const w = arena.current.clientWidth,
            h = arena.current.clientHeight,
            s = Math.max(w / v.videoWidth, h / v.videoHeight);
          const ox = (v.videoWidth * s - w) / 2,
            oy = (v.videoHeight * s - h) / 2;
          setTarget({
            x: (((box.originX + box.width / 2) * s - ox) / w) * 100,
            y: (((box.originY + box.height / 2) * s - oy) / h) * 100,
            r: Math.max(42, Math.min(100, box.width * s * 0.7)),
          });
        }
      } catch {
        setCameraError('얼굴 감지가 중단됐어요. 카메라를 다시 시작해주세요.');
        stopCamera();
      }
    }, DETECTION_INTERVAL);
    return () => clearInterval(timer);
  }, [modelReady, stopCamera]);
  function chime(success: boolean) {
    if (!sound) return;
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      [0, 0.12, 0.24].forEach((delay, i) => {
        const osc = audio.current!.createOscillator(),
          gain = audio.current!.createGain();
        osc.connect(gain);
        gain.connect(audio.current!.destination);
        osc.frequency.value = success ? [523, 659, 784][i] : [330, 294, 262][i];
        gain.gain.setValueAtTime(0.07, audio.current!.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          audio.current!.currentTime + delay + 0.15,
        );
        osc.start(audio.current!.currentTime + delay);
        osc.stop(audio.current!.currentTime + delay + 0.18);
      });
    } catch {
      /* 소리가 지원되지 않아도 게임은 계속 진행한다. */
    }
  }
  const startCamera = useCallback(async () => {
    if (cameraLoading) return;
    stopCamera();
    const generation = cameraGeneration.current;
    setCameraLoading(true);
    setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('카메라는 HTTPS 또는 localhost에서 사용할 수 있어요.');
      const next = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (generation !== cameraGeneration.current || !alive.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = next;
      setModal(null);
      setMessage('친구 한 명의 얼굴을 카메라에 비춰주세요');
      await pause(70);
      if (!video.current)
        throw new Error('카메라 화면을 준비하지 못했어요. 다시 시도해주세요.');
      video.current.srcObject = next;
      await video.current.play();
      const fileset = await FilesetResolver.forVisionTasks(
        publicAsset('/vision'),
      );
      const loaded = await FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: publicAsset('/face-model.tflite'),
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.65,
      });
      if (generation !== cameraGeneration.current || !alive.current) {
        loaded.close();
        return;
      }
      detector.current = loaded;
      setModelReady(true);
    } catch (err) {
      if (generation !== cameraGeneration.current || !alive.current) return;
      stopCamera();
      setTarget({ x: 50, y: 38, r: 71 });
      const exception = err as Error;
      setCameraError(
        exception.name === 'NotAllowedError'
          ? '카메라 권한이 필요해요. 브라우저 사이트 설정에서 허용한 뒤 다시 눌러주세요.'
          : exception.name === 'NotFoundError'
            ? '연결된 카메라를 찾지 못했어요. 카메라가 있는 기기로 접속해주세요.'
            : exception.name === 'NotReadableError'
              ? '다른 앱이 카메라를 사용하고 있어요. 종료한 뒤 다시 시도해주세요.'
              : exception.message ||
                '카메라를 시작하지 못했어요. 다시 시도해주세요.',
      );
    } finally {
      if (alive.current) setCameraLoading(false);
    }
  }, [cameraLoading, stopCamera]);

  useEffect(() => {
    if (autoCameraStarted.current) return;
    autoCameraStarted.current = true;
    void startCamera();
  }, [startCamera]);
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopCamera();
        return;
      }
      if (screen === 'capture' && !stream.current) void startCamera();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [screen, startCamera, stopCamera]);
  function snapshot() {
    const v = video.current,
      b = face.current;
    if (!v || !b || v.readyState < 2) return null;
    const size = Math.min(
        v.videoWidth,
        v.videoHeight,
        Math.max(b.width, b.height) * 2.1,
      ),
      x = Math.max(
        0,
        Math.min(v.videoWidth - size, b.originX + b.width / 2 - size / 2),
      ),
      y = Math.max(
        0,
        Math.min(v.videoHeight - size, b.originY + b.height / 2 - size * 0.42),
      );
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, x, y, size, size, 0, 0, 400, 400);
    return canvas.toDataURL('image/jpeg', 0.83);
  }
  function drawBody(body: Body, trail: Vec3[] = []) {
    const h = ballHome.current,
      screen = project(body.p, h.view);
    view3d.current?.trail(trail, Math.abs(body.spin) > 1);
    view3d.current?.pose(body.p, body.angle, body.time * 3);
    if (!view3d.current && ball.current)
      ball.current.style.transform = `translate(${screen.x - h.x}px,${screen.y - h.y}px) scale(${screen.r / 41}) rotate(${body.angle * 57.3}deg)`;
  }
  function simulate(
    initial: Body,
    checkHit: (previous: Body, next: Body) => Vec3 | null,
    settling = false,
  ): Promise<{ body: Body; point: Vec3 | null } | null> {
    cancelFlight.current?.();
    return new Promise((resolve) => {
      let state = initial,
        previousTime = performance.now(),
        accumulator = 0,
        frame = 0,
        finished = false;
      let crossing: Vec3 | null = null;
      const trail: Vec3[] = [];
      const finish = (result: { body: Body; point: Vec3 | null } | null) => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(frame);
        cancelFlight.current = null;
        resolve(result);
      };
      cancelFlight.current = () => finish(null);
      const tick = (now: number) => {
        if (!alive.current) {
          finish(null);
          return;
        }
        // 120Hz 고정 스텝으로 갱신률에 독립적인 물리 궤적을 계산한다.
        accumulator += Math.min((now - previousTime) / 1000, 0.05);
        previousTime = now;
        while (accumulator >= STEP) {
          const next = stepBody(state);
          accumulator -= STEP;
          const cross = settling ? null : checkHit(state, next);
          if (cross) {
            crossing = cross;
            {
              state = { ...next, p: cross };
              drawBody(state, trail);
              finish({ body: state, point: cross });
              return;
            }
          }
          state = next;
        }
        trail.push({ ...state.p });
        if (trail.length > 16) trail.shift();
        drawBody(state, settling ? [] : trail);
        if (
          state.time > (settling ? 1.25 : 2.2) ||
          state.bounces >= 2 ||
          Math.abs(state.p.x) > 12 ||
          state.p.z > 18
        ) {
          finish({ body: state, point: crossing });
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
  }
  async function throwBall(released?: Body) {
    if (busy.current || modal || detail) return;
    if (
      !modelReady ||
      faceCount !== 1 ||
      !face.current ||
      performance.now() - lastSeen.current > 500
    ) {
      setMessage('친구 한 명의 얼굴이 보일 때 던져주세요');
      resetBall();
      return;
    }
    const a = arena.current,
      b = ball.current;
    if (!a || !b) return;
    const photo = snapshot();
    if (!photo) {
      setMessage('친구 얼굴을 다시 비춰주세요');
      resetBall();
      return;
    }
    busy.current = true;
    setPhase('flying');
    setError('');
    const home = ballHome.current,
      view = home.view;
    const tx = (target.x / 100) * view.width,
      ty = (target.y / 100) * view.height;
    const initial =
      released ??
      aimedLaunch(
        unproject(home.x, home.y, home.depth, view),
        unproject(tx, ty, DEPTH, view),
      );
    const curve = Math.abs(initial.spin) > 1;
    const transform = ring.current
      ? getComputedStyle(ring.current).transform
      : 'none';
    const scale =
      transform === 'none' ? 1 : Math.abs(new DOMMatrix(transform).a);
    setLockedTarget({ ...target, scale });
    let result = judgeThrow(-999, -999, tx, ty, target.r, scale, curve);
    setMessage(
      curve
        ? initial.spin > 0
          ? '시계 방향 커브볼!'
          : '반시계 방향 커브볼!'
        : '',
    );
    const landed = await simulate(initial, (previous, next) => {
      const point = sweepScreenTarget(
        previous,
        next,
        { x: tx, y: ty, r: target.r },
        view,
      );
      if (!point) return null;
      const screen = project(point, view);
      result = judgeContact(
        screen,
        { x: tx, y: ty, r: target.r },
        scale,
        curve,
      );
      return point;
    });
    if (!landed || !alive.current) return;
    if (!result.hit) {
      resetBall();
      setPhase('idle');
      busy.current = false;
      setMessage(
        landed.body.bounces
          ? '바닥에 떨어졌어요. 조금 더 빠르게 위로 던져보세요.'
          : '아깝다! 던지는 방향과 회전을 조절해보세요.',
      );
      chime(false);
      return;
    }
    setMessage(`${result.grade}!${curve ? ' · 커브볼 +25 XP' : ''}`);
    setPhase('shaking');
    const settled = await simulate(
      {
        ...landed.body,
        v: { x: 0, y: 0.7, z: 0 },
        spin: 0,
        time: 0,
        bounces: 0,
      },
      () => null,
      true,
    );
    if (!settled || !alive.current) return;
    for (let i = 0; i < 18; i++) {
      if (!alive.current) return;
      drawBody({
        ...settled.body,
        angle: Math.sin(i * 1.25) * 0.24 * (1 - i / 20),
      });
      await pause(35);
    }
    resetBall();
    if (!captureSucceeded(result, misses.current, Math.random())) {
      misses.current++;
      setPhase('idle');
      busy.current = false;
      setMessage('앗, 빠져나왔어요! 한 번 더 던져보세요');
      chime(false);
      return;
    }
    misses.current = 0;
    setPending({
      id: crypto.randomUUID(),
      name: name.trim(),
      photo,
      date: new Date().toISOString(),
      grade: result.grade,
      xp: result.xp,
      demo: false,
      curve,
    });
    setName(name.trim());
    setPhase('caught');
    setModal('caught');
    setMessage('잡았다! 새로운 순간을 수집했어요');
    chime(true);
    navigator.vibrate?.([60, 50, 90]);
  }
  function cancelDrag() {
    setHolding(false);
    pointer.current = null;
    if (!busy.current) resetBall();
  }
  function onDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (
      busy.current ||
      modal ||
      !e.isPrimary ||
      (e.pointerType === 'mouse' && e.button !== 0)
    )
      return;
    resetBall();
    const t = performance.now();
    pointer.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      samples: [{ x: e.clientX, y: e.clientY, t }],
      spin: 0,
      angle: 0,
    };
    setHolding(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    setMessage('');
  }
  function onMove(e: React.PointerEvent<HTMLButtonElement>) {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const time = performance.now();
    const dt = Math.min(0.05, (time - (p.samples.at(-1)?.t ?? time)) / 1000);
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const event of coalesced) {
      p.samples.push({
        x: event.clientX,
        y: event.clientY,
        t: event.timeStamp || time,
      });
    }
    p.samples = p.samples.filter((v) => time - v.t < 2400);
    const g = gesture(p.samples);
    p.spin = g.spin;
    p.angle += g.spin * dt;
    const h = ballHome.current;
    const dx = clamp(e.clientX - p.x, 25 - h.x, h.view.width - 25 - h.x),
      dy = clamp(e.clientY - p.y, 25 - h.y, h.view.height - 25 - h.y);
    // 손 위치를 직접 반영해 드래그 보간 지연을 없앤다.
    if (ball.current)
      ball.current.style.transform = `translate(${dx}px,${dy}px)`;
    view3d.current?.pose(
      unproject(h.x + dx, h.y + dy, h.depth, h.view),
      p.angle,
    );
  }
  function onUp(e: React.PointerEvent<HTMLButtonElement>) {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    p.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    const g = gesture(p.samples);
    pointer.current = null;
    setHolding(false);
    if (g.vy > -100) {
      resetBall();
      setMessage('볼을 위로 빠르게 튕긴 후 놓아주세요');
      return;
    }
    const h = ballHome.current;
    const x = clamp(h.x + e.clientX - p.x, 25, h.view.width - 25),
      y = clamp(h.y + e.clientY - p.y, 25, h.view.height - 25);
    if (ball.current) ball.current.style.transform = '';
    void throwBall({
      ...launch(unproject(x, y, h.depth, h.view), g.vx, g.vy, g.spin, h.view),
      angle: p.angle,
    });
  }
  function resetCatch() {
    resetBall();
    setModal(null);
    setPending(null);
    setPhase('idle');
    busy.current = false;
    setMessage('');
  }
  async function save() {
    if (!pending || !name.trim() || saving) return;
    setSaving(true);
    setError('');
    const card = { ...pending, name: name.trim().slice(0, 24) };
    try {
      await writeFriend(card);
      setCards((current) => [card, ...current.filter((v) => v.id !== card.id)]);
      resetCatch();
      setMessage(`${card.name}, 도감에 저장했어요!`);
    } catch {
      setError(
        '저장 공간이 부족하거나 저장소가 차단됐어요. 공간을 확보하고 다시 저장해주세요.',
      );
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!detail || saving) return;
    setSaving(true);
    try {
      await deleteFriend(detail.id);
      setCards((current) => current.filter((card) => card.id !== detail.id));
      setDeleteOpen(false);
      setDetail(null);
      setError('');
    } catch {
      setError('카드를 삭제하지 못했어요. 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    type Context = {
      registerTool: (
        tool: {
          name: string;
          description: string;
          inputSchema: object;
          annotations: object;
          execute: (input: unknown) => unknown;
        },
        options: { signal: AbortSignal },
      ) => void | Promise<void>;
    };
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'list_collected_friends',
          description:
            '이 브라우저에 저장된 친구 도감의 이름과 포획 기록을 조회합니다. 사진은 반환하지 않습니다.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input) => {
            if (
              !input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              Object.keys(input).length
            )
              throw new Error('빈 객체를 입력해주세요.');
            return (await listFriends())
              .filter((card) => !card.demo)
              .map(({ id, name, date, grade, xp }) => ({
                id,
                name,
                date,
                grade,
                xp,
              }));
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  const ready = modelReady && faceCount === 1;
  const shownTarget = phase === 'flying' ? lockedTarget : target;
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <ScanFace />
          </span>
          KIS<span>GO</span>
        </Link>
        <button
          className="icon-btn"
          aria-label="도움말"
          onClick={() => setModal('help')}
          disabled={phase !== 'idle'}
        >
          <CircleHelp />
        </button>
      </header>
      <Tabs
        className="app-tabs"
        value={screen}
        onValueChange={(value) => {
          if (busy.current || cameraLoading) return;
          if (value === 'collection') {
            stopCamera();
            setTarget({ x: 50, y: 38, r: 71 });
          } else if (!stream.current) {
            void startCamera();
          }
          setScreen(value as 'capture' | 'collection');
        }}
      >
        <main className="workspace">
          <TabsContent value="capture" keepMounted className="capture-panel">
            <section className="game-column" aria-label="친구 포획 게임">
              <div
                className={`arena ${phase === 'caught' ? 'celebrating' : ''}`}
                ref={arena}
              >
                <video
                  className="scene"
                  ref={video}
                  autoPlay
                  playsInline
                  muted
                  aria-label="친구를 감지하는 카메라 화면"
                />
                <div className="arena-shade" />
                <div className="arena-top">
                  <span className="glass-label">
                    <span className="live-dot" />
                    카메라 ON
                  </span>
                  <div className="arena-tools">
                    <button
                      className="glass-icon"
                      aria-label={sound ? '소리 끄기' : '소리 켜기'}
                      onClick={() => setSound(!sound)}
                    >
                      {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                  </div>
                </div>
                <div className="friend-label">
                  <span>
                    {!modelReady
                      ? '얼굴 감지 준비 중…'
                      : faceCount > 1
                        ? '한 명씩 비춰주세요'
                        : faceCount === 1
                          ? ''
                          : '친구를 찾아주세요'}
                  </span>
                  <h2>
                    {name || '새로운 친구'}
                    {ready && <Sparkles size={19} />}
                  </h2>
                </div>
                {!modelReady && (
                  <div className="camera-loading">
                    <LoaderCircle className="spin" />
                    <span>{cameraError || '얼굴 감지를 준비하고 있어요'}</span>
                    {cameraError && (
                      <button onClick={() => void startCamera()}>
                        다시 연결
                      </button>
                    )}
                  </div>
                )}
                {((ready && phase === 'idle') || phase === 'flying') && (
                  <div
                    className="target-ring"
                    style={{
                      left: `${shownTarget.x}%`,
                      top: `${shownTarget.y}%`,
                      width: shownTarget.r * 2,
                      height: shownTarget.r * 2,
                    }}
                  >
                    <div
                      ref={ring}
                      style={
                        phase === 'flying'
                          ? {
                              animation: 'none',
                              transform: `scale(${lockedTarget.scale})`,
                            }
                          : undefined
                      }
                    />
                  </div>
                )}
                {phase === 'shaking' && (
                  <div className="capture-word">{message}</div>
                )}
                {phase === 'caught' && (
                  <div className="success-burst">
                    <Sparkles size={72} />
                  </div>
                )}
                <div className="throw-zone">
                  <output className="throw-hint" aria-live="polite">
                    {message}
                  </output>
                  <button
                    className={`ball ${rendered3d ? 'rendered-ball' : ''}`}
                    ref={ball}
                    aria-label="프렌드볼. 위로 스와이프하거나 Enter 키로 중앙에 던지기"
                    disabled={(!ready && !holding) || phase !== 'idle'}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={cancelDrag}
                    onLostPointerCapture={() => {
                      if (pointer.current) cancelDrag();
                    }}
                    onClick={(e) => {
                      if (e.detail === 0) void throwBall();
                    }}
                  >
                    <Ball />
                  </button>
                  <span className="ball-name">
                    프렌드볼 <span className="infinity">∞</span>
                  </span>
                </div>
              </div>
            </section>
          </TabsContent>
          <TabsContent value="collection" className="collection-panel">
            <aside className="collection" aria-label="저장된 친구 도감">
              <div className="collection-heading">
                <BookHeart size={22} />
                <h2>나의 도감</h2>
                <span>{String(cards.length).padStart(2, '0')}</span>
              </div>
              {loadingCards ? (
                <div className="collection-empty">
                  <LoaderCircle className="spin" />
                  <p>도감을 불러오는 중…</p>
                </div>
              ) : cards.length === 0 ? (
                <div className="collection-empty">
                  <BookHeart size={35} />
                  <h3>아직 수집한 친구가 없어요</h3>
                </div>
              ) : (
                <div className="card-list">
                  {cards.map((card, i) => (
                    <button
                      className="friend-card"
                      key={card.id}
                      onClick={() => {
                        setError('');
                        setDetail(card);
                      }}
                      disabled={phase !== 'idle'}
                    >
                      <div className="card-photo">
                        <Image
                          unoptimized
                          width={400}
                          height={400}
                          src={card.photo}
                          alt={`${card.name}의 수집 사진`}
                        />
                        {i === 0 && <span>NEW</span>}
                      </div>
                      <div className="card-copy">
                        <b>{card.name}</b>
                        <span>
                          함께한 친구 ·{' '}
                          {new Date(card.date).toLocaleDateString('ko-KR', {
                            month: '2-digit',
                            day: '2-digit',
                          })}
                        </span>
                        <small>
                          {card.grade} <span>+{card.xp} XP</span>
                        </small>
                      </div>
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
              )}
              {error && !modal && !detail && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
            </aside>
          </TabsContent>
        </main>
        <TabsList className="bottom-nav" aria-label="화면 선택">
          <TabsTrigger
            value="capture"
            disabled={phase !== 'idle' || cameraLoading}
          >
            <Target size={23} />
            <span>포획</span>
          </TabsTrigger>
          <TabsTrigger
            value="collection"
            disabled={phase !== 'idle' || cameraLoading}
          >
            <BookHeart size={23} />
            <span>도감 {cards.length > 0 && <b>{cards.length}</b>}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open && !saving) {
            if (modal === 'caught') resetCatch();
            else {
              setModal(null);
            }
          }
        }}
      >
        <DialogContent className="game-dialog" showCloseButton={false}>
          <DialogClose
            className="dialog-close icon-btn"
            aria-label="닫기"
            disabled={saving}
          >
            <X size={18} />
          </DialogClose>
          {modal === 'help' && (
            <>
              <span className="modal-symbol">
                <ScanFace size={28} />
              </span>
              <DialogTitle className="modal-title">플레이 방법</DialogTitle>
              <DialogDescription>
                볼을 튕겨 던지세요. 원을 그리면 커브볼이 충전됩니다.
              </DialogDescription>
              <ol className="help-list">
                <li>
                  <b>친구 발견</b>
                  <p>
                    카메라를 켜고 친구 한 명을 비추세요. 얼굴 위치를 감지하며,
                    신원이나 이름은 자동으로 식별하지 않아요.
                  </p>
                </li>
                <li>
                  <b>볼 던지기</b>
                  <p>
                    볼을 누른 채 링 방향으로 위로 스와이프하세요. 거리는 놓는
                    순간의 속도로 조절해요. 볼을 누르고 원을 그린 뒤 던지면
                    커브볼이 돼요.
                  </p>
                </li>
                <li>
                  <b>도감에 저장</b>
                  <p>
                    포획에 성공하면 이름을 입력하고 저장하세요. 사진은 현재
                    브라우저에만 남아요. 브라우저 데이터를 지우면 도감도
                    삭제돼요.
                  </p>
                </li>
              </ol>
              <p className="small-note">
                볼에 포커스를 두고 Enter 또는 Space를 누르면 중앙으로 던집니다.
                포획은 실패할 수도 있으며 볼은 무제한입니다.
              </p>
              <button className="primary-btn" onClick={() => setModal(null)}>
                알겠어요 <ArrowUp size={16} />
              </button>
            </>
          )}
          {modal === 'caught' && pending && (
            <>
              <span className="caught-eyebrow">
                <Sparkles size={16} />
                GOTCHA!
              </span>
              <DialogTitle className="modal-title">포획 성공</DialogTitle>
              <DialogDescription>
                {pending.grade} Throw ·{' '}
                {pending.curve ? '커브볼 보너스 포함 · ' : ''}+{pending.xp} XP
              </DialogDescription>
              <div className="caught-photo">
                <Image
                  unoptimized
                  width={400}
                  height={400}
                  src={pending.photo}
                  alt="방금 포획한 친구 사진"
                />
                <span>
                  <Check size={17} />
                </span>
              </div>
              <label className="field-label" htmlFor="friend-name">
                친구 이름
              </label>
              <input
                id="friend-name"
                className="text-input"
                maxLength={24}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="친구의 이름을 알려주세요"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                }}
              />
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <button
                className="primary-btn"
                disabled={!name.trim() || saving}
                onClick={() => void save()}
              >
                {saving ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <BookHeart size={18} />
                )}{' '}
                {saving ? '저장 중…' : '도감에 저장하기'}
              </button>
              <button
                className="text-btn"
                onClick={resetCatch}
                disabled={saving}
              >
                <RotateCcw size={14} /> 저장하지 않고 다시 던지기
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open && !deleteOpen) setDetail(null);
        }}
      >
        <DialogContent className="game-dialog" showCloseButton={false}>
          <DialogClose className="dialog-close icon-btn" aria-label="닫기">
            <X size={18} />
          </DialogClose>
          <DialogTitle className="modal-title">{detail?.name}</DialogTitle>
          <DialogDescription>함께한 순간의 기록</DialogDescription>
          {detail && (
            <>
              <div className="detail-photo">
                <Image
                  unoptimized
                  width={400}
                  height={400}
                  src={detail.photo}
                  alt={`${detail.name}의 사진`}
                />
              </div>
              <div className="detail-stats">
                <span>
                  {detail.grade}
                  <small>THROW</small>
                </span>
                <span>
                  {detail.xp}
                  <small>XP</small>
                </span>
                <span>
                  {detail.curve ? '커브볼' : '직선볼'}
                  <small>포획 방식</small>
                </span>
              </div>
              <p className="small-note">
                {new Date(detail.date).toLocaleString('ko-KR')}
              </p>
              <button
                className="text-btn delete-btn"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={15} /> 이 카드 삭제
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="game-dialog">
          <AlertDialogTitle className="modal-title">
            이 카드를 삭제할까요?
          </AlertDialogTitle>
          <AlertDialogDescription>
            사진과 포획 기록이 이 브라우저에서 삭제됩니다.
          </AlertDialogDescription>
          {error && <p className="error-message">{error}</p>}
          <button
            className="primary-btn"
            onClick={() => void remove()}
            disabled={saving}
          >
            {saving ? '삭제 중…' : '삭제하기'}
          </button>
          <button
            className="text-btn"
            onClick={() => setDeleteOpen(false)}
            disabled={saving}
          >
            취소
          </button>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
