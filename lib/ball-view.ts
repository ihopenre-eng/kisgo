import * as THREE from 'three';
import { BALL_RADIUS, FLOOR, type Vec3, type Viewport } from './physics';
export type BallView = {
  pose: (position: Vec3, angle?: number, tilt?: number) => void;
  trail: (points: Vec3[], curved: boolean) => void;
  resize: (view: Viewport) => void;
  dispose: () => void;
};
export function createBallView(host: HTMLElement, view: Viewport): BallView {
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: !coarsePointer,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(
    Math.min(devicePixelRatio, coarsePointer ? 1.25 : 1.5),
  );
  renderer.setSize(view.width, view.height);
  renderer.setClearColor(0, 0);
  renderer.domElement.className = 'ball-webgl';
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(50, view.width / view.height, 0.1, 40);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x68855d, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 3.2);
  light.position.set(-3, 5, 3);
  scene.add(light);
  const group = new THREE.Group();
  scene.add(group);
  const materials = [
    new THREE.MeshStandardMaterial({
      color: 0xf55246,
      roughness: 0.26,
      metalness: 0.12,
    }),
    new THREE.MeshStandardMaterial({
      color: 0xfffdf5,
      roughness: 0.28,
      metalness: 0.1,
    }),
    new THREE.MeshStandardMaterial({ color: 0x193c34, roughness: 0.4 }),
  ];
  const geometries: THREE.BufferGeometry[] = [];
  const sphereWidthSegments = coarsePointer ? 24 : 32;
  const sphereHeightSegments = coarsePointer ? 12 : 16;
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    group.add(m);
    return m;
  }
  mesh(
    new THREE.SphereGeometry(
      BALL_RADIUS,
      sphereWidthSegments,
      sphereHeightSegments,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    ),
    materials[0],
  );
  mesh(
    new THREE.SphereGeometry(
      BALL_RADIUS,
      sphereWidthSegments,
      sphereHeightSegments,
      0,
      Math.PI * 2,
      Math.PI / 2,
      Math.PI / 2,
    ),
    materials[1],
  );
  mesh(
    new THREE.SphereGeometry(
      BALL_RADIUS * 1.007,
      sphereWidthSegments,
      6,
      0,
      Math.PI * 2,
      Math.PI / 2 - 0.065,
      0.13,
    ),
    materials[2],
  );
  const rim = mesh(
    new THREE.CylinderGeometry(0.044, 0.044, 0.016, 20),
    materials[2],
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.z = BALL_RADIUS - 0.002;
  const button = mesh(
    new THREE.CylinderGeometry(0.031, 0.031, 0.018, 20),
    materials[1],
  );
  button.rotation.x = Math.PI / 2;
  button.position.z = BALL_RADIUS + 0.009;
  const dot = mesh(
    new THREE.CylinderGeometry(0.021, 0.021, 0.019, 20),
    materials[1],
  );
  dot.rotation.x = Math.PI / 2;
  dot.position.z = BALL_RADIUS + 0.014;
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x183b2b,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });
  const shadowGeometry = new THREE.CircleGeometry(0.22, 24),
    shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const trailPositions = new Float32Array(16 * 3),
    trailGeometry = new THREE.BufferGeometry(),
    trailMaterial = new THREE.LineBasicMaterial({
      color: 0xffed9d,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
  const trailAttribute = new THREE.BufferAttribute(trailPositions, 3);
  trailAttribute.setUsage(THREE.DynamicDrawUsage);
  trailGeometry.setAttribute('position', trailAttribute);
  trailGeometry.setDrawRange(0, 0);
  const tail = new THREE.Line(trailGeometry, trailMaterial);
  scene.add(tail);
  const render = () => renderer.render(scene, camera);
  return {
    pose(p, angle = 0, tilt = 0) {
      group.position.set(p.x, p.y, -p.z);
      group.rotation.set(tilt, angle, angle * 0.14);
      shadow.position.set(p.x, FLOOR + 0.006, -p.z);
      const height = Math.max(0, p.y - FLOOR);
      shadow.scale.setScalar(1 + height * 0.18);
      shadowMaterial.opacity = 0.2 / (1 + height);
      render();
    },
    trail(points, curved) {
      const count = Math.min(points.length, 16);
      for (let index = 0; index < count; index++) {
        const point = points[index];
        trailPositions[index * 3] = point.x;
        trailPositions[index * 3 + 1] = point.y;
        trailPositions[index * 3 + 2] = -point.z;
      }
      trailAttribute.needsUpdate = true;
      trailGeometry.setDrawRange(0, count);
      trailMaterial.color.set(curved ? 0xffe89a : 0xffffff);
      tail.visible = count > 1;
    },
    resize(size) {
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      renderer.setSize(size.width, size.height);
      render();
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
