export type Vec3 = { x: number; y: number; z: number };
export type Sample = { x: number; y: number; t: number };
export type Body = {
  p: Vec3;
  v: Vec3;
  spin: number;
  angle: number;
  time: number;
  bounces: number;
};
export type Viewport = { width: number; height: number };
export const DEPTH = 6.5;
export const BALL_RADIUS = 0.14;
export const STEP = 1 / 120;
export const MIN_CATCH_FLIGHT = 0.22;
export const GRAVITY = 9.81;
export const FLOOR = -1.75;
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
export function focal(view: Viewport) {
  return view.height / (2 * Math.tan((25 * Math.PI) / 180));
}
export function unproject(
  x: number,
  y: number,
  z: number,
  view: Viewport,
): Vec3 {
  const f = focal(view);
  return {
    x: ((x - view.width / 2) * z) / f,
    y: ((view.height / 2 - y) * z) / f,
    z,
  };
}
export function project(p: Vec3, view: Viewport) {
  const scale = focal(view) / Math.max(0.2, p.z);
  return {
    x: view.width / 2 + p.x * scale,
    y: view.height / 2 - p.y * scale,
    r: BALL_RADIUS * scale,
  };
}
export function gesture(samples: Sample[]) {
  const last = samples.at(-1);
  if (!last) return { vx: 0, vy: 0, spin: 0 };
  const recent = samples.filter((p) => last.t - p.t <= 100);
  const first = recent[0] ?? last;
  const dt = Math.max(0.008, (last.t - first.t) / 1000);
  let turn = 0,
    path = 0;
  for (let i = 2; i < samples.length; i++) {
    const a = samples[i - 2],
      b = samples[i - 1],
      c = samples[i];
    const ux = b.x - a.x,
      uy = b.y - a.y,
      vx = c.x - b.x,
      vy = c.y - b.y;
    const length = Math.hypot(vx, vy);
    path += length;
    if (Math.hypot(ux, uy) < 2 || length < 2) continue;
    const angle = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    // 클릭 지터와 급격한 왕복은 회전 충전으로 계산하지 않는다.
    if (Math.abs(angle) < 1.3) turn += angle * Math.exp(-(last.t - c.t) / 1800);
  }
  const spin =
    path > 70 && Math.abs(turn) > 1.4 ? clamp(turn * 3.2, -18, 18) : 0;
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt, spin };
}
export function launch(
  position: Vec3,
  vx: number,
  vy: number,
  spin: number,
  view: Viewport,
): Body {
  const upward = clamp(-vy / view.height, 0, 3.5);
  return {
    p: { ...position },
    v: {
      x: clamp((vx / view.height) * 4.6, -7, 7),
      y: 1.6 + upward * 1.8,
      z: 5.4 + upward * 3.2,
    },
    spin,
    angle: 0,
    time: 0,
    bounces: 0,
  };
}
export function stepBody(body: Body, dt = STEP): Body {
  const { p, v } = body,
    speed = Math.hypot(v.x, v.y, v.z),
    drag = 0.032 * speed;
  // 중력 + 속도 제곱 공기저항 + 회전축과 속도의 외적에 비례하는 마그누스 힘.
  const ax = -drag * v.x + 0.055 * body.spin * v.z,
    ay = -GRAVITY - drag * v.y,
    az = -drag * v.z - 0.055 * body.spin * v.x;
  const next: Body = {
    p: {
      x: p.x + v.x * dt + (ax * dt * dt) / 2,
      y: p.y + v.y * dt + (ay * dt * dt) / 2,
      z: p.z + v.z * dt + (az * dt * dt) / 2,
    },
    v: { x: v.x + ax * dt, y: v.y + ay * dt, z: v.z + az * dt },
    spin: body.spin * Math.exp(-0.7 * dt),
    angle: body.angle + body.spin * dt,
    time: body.time + dt,
    bounces: body.bounces,
  };
  if (next.p.y - BALL_RADIUS < FLOOR && next.v.y < 0) {
    next.p.y = FLOOR + BALL_RADIUS;
    next.v.y = -next.v.y * 0.48;
    next.v.x *= 0.76;
    next.v.z *= 0.76;
    next.spin *= 0.65;
    next.bounces++;
  }
  return next;
}
export function crossTarget(previous: Body, next: Body): Vec3 | null {
  if (previous.p.z >= DEPTH || next.p.z < DEPTH) return null;
  const t = (DEPTH - previous.p.z) / (next.p.z - previous.p.z);
  return {
    x: previous.p.x + (next.p.x - previous.p.x) * t,
    y: previous.p.y + (next.p.y - previous.p.y) * t,
    z: DEPTH,
  };
}

// 한 스텝의 이동 선분과 볼 반지름까지 확장한 타깃 구체를 교차 검사한다.
// 타깃 중심 깊이를 통과하기 전의 접촉과 빠른 커브볼의 관통도 잡는다.
export function sweepTarget(
  previous: Body,
  next: Body,
  center: Vec3,
  radius: number,
): Vec3 | null {
  if (previous.bounces > 0 || next.bounces > 0) return null;
  const d = {
    x: next.p.x - previous.p.x,
    y: next.p.y - previous.p.y,
    z: next.p.z - previous.p.z,
  };
  const m = {
    x: previous.p.x - center.x,
    y: previous.p.y - center.y,
    z: previous.p.z - center.z,
  };
  const expanded = radius + BALL_RADIUS;
  const c = m.x * m.x + m.y * m.y + m.z * m.z - expanded * expanded;
  if (c <= 0) return { ...previous.p };
  const a = d.x * d.x + d.y * d.y + d.z * d.z;
  if (a < 1e-12) return null;
  const b = m.x * d.x + m.y * d.y + m.z * d.z;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  if (t < 0 || t > 1) return null;
  return {
    x: previous.p.x + d.x * t,
    y: previous.p.y + d.y * t,
    z: previous.p.z + d.z * t,
  };
}
// 화면에 투영된 이동 선분을 검사해 깊이가 달라도 눈에 보이는 접촉을 인정한다.
export function sweepScreenTarget(
  previous: Body,
  next: Body,
  target: { x: number; y: number; r: number },
  view: Viewport,
): Vec3 | null {
  // 손에서 놓는 순간의 겹침은 무시하고 실제 비행 구간부터 접촉을 검사한다.
  if (
    previous.time < MIN_CATCH_FLIGHT ||
    previous.bounces > 0 ||
    next.bounces > 0 ||
    previous.p.z < 0.2 ||
    next.p.z < 0.2
  )
    return null;
  const start = project(previous.p, view),
    end = project(next.p, view);
  const mx = start.x - target.x,
    my = start.y - target.y;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const radius = target.r + start.r,
    dr = end.r - start.r;
  const c = mx * mx + my * my - radius * radius;
  if (c <= 0) return { ...previous.p };
  const a = dx * dx + dy * dy - dr * dr;
  const b = 2 * (mx * dx + my * dy - radius * dr);
  let roots: number[];
  if (Math.abs(a) < 1e-9) {
    roots = Math.abs(b) < 1e-9 ? [] : [-c / b];
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  }
  const s = roots
    .filter((value) => value >= 0 && value <= 1)
    .sort((x, y) => x - y)[0];
  if (s === undefined) return null;
  // 화면 선분의 접촉 비율을 원근 투영 전의 3D 이동 비율로 되돌린다.
  const t = (s * previous.p.z) / (next.p.z * (1 - s) + s * previous.p.z);
  return {
    x: previous.p.x + (next.p.x - previous.p.x) * t,
    y: previous.p.y + (next.p.y - previous.p.y) * t,
    z: previous.p.z + (next.p.z - previous.p.z) * t,
  };
}
export function aimedLaunch(position: Vec3, target: Vec3): Body {
  const time = 0.55;
  let body: Body = {
    p: { ...position },
    v: {
      x: (target.x - position.x) / time,
      y: (target.y - position.y) / time + (GRAVITY * time) / 2,
      z: (DEPTH - position.z) / time + 0.65,
    },
    spin: 0,
    angle: 0,
    time: 0,
    bounces: 0,
  };
  // 키보드 접근성: 동일한 물리 적분으로 중앙을 향하는 초기 속도만 보정한다.
  for (let attempt = 0; attempt < 5; attempt++) {
    let s = body;
    for (let i = 0; i < 180; i++) {
      const n = stepBody(s),
        cross = crossTarget(s, n);
      if (cross) {
        body = {
          ...body,
          v: {
            ...body.v,
            x: body.v.x + (target.x - cross.x) / time,
            y: body.v.y + (target.y - cross.y) / time,
          },
        };
        break;
      }
      s = n;
    }
  }
  return body;
}
