import * as THREE from 'three';
import { Cube } from './cube/cube';
import { Input } from './input/input';
import { FixedStepper } from './physics/clock';
import { HALF, PhysicsWorld, type PhysicsInput } from './physics/world';
import { sampleSky } from './sky/cycle';
import { Sky } from './sky/sky';
import { createTerrain, surfaceNormal } from './terrain/height';
import { TerrainMesh } from './terrain/mesh';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#dff1ff', 30, 92);
const sky = new Sky(scene);

// 낮밤: 하루 = 4분. 빨리감기를 켜면 20배.
const DAY_SECONDS = 240;
const FAST = 20;
let timeOfDay = 0.3;
let fast = false;
const timeBtn = document.getElementById('timeBtn')!;
const toggleFast = () => {
  fast = !fast;
  timeBtn.classList.toggle('on', fast);
};
timeBtn.addEventListener('click', toggleFast);
addEventListener('keydown', (e) => { if (e.code === 'KeyT' && !e.repeat) toggleFast(); });

const terrain = createTerrain(1337);
const terrainMesh = new TerrainMesh(terrain);
scene.add(terrainMesh.mesh);

const physics = new PhysicsWorld(terrain, 0, 0);
const cube = new Cube();
scene.add(cube.group, cube.shadow);

const input = new Input(renderer.domElement, app);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
let camYaw = 0.6;
let camPitch = 0.26;
const CAM_DIST = 7.5;
const camTarget = new THREE.Vector3();

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const stepper = new FixedStepper();
const pos = new THREE.Vector3();
const normal = new THREE.Vector3();
const nTmp = { x: 0, y: 1, z: 0 };
let faceX = 0;
let faceZ = 1;
let last = performance.now();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const inp = input.read();
  camYaw -= inp.lookYaw;
  camPitch = THREE.MathUtils.clamp(camPitch + inp.lookPitch, 0.12, 1.25);

  // 카메라 기준 입력 → 월드 방향
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  const moveX = fx * inp.moveY + rx * inp.moveX;
  const moveZ = fz * inp.moveY + rz * inp.moveX;
  if (moveX * moveX + moveZ * moveZ > 0.01) { faceX = moveX; faceZ = moveZ; }

  const { steps, alpha } = stepper.advance(dt);
  let jumped = false;
  let landImpact = 0;
  let pressed = steps > 0 && input.consumeJump();
  for (let i = 0; i < steps; i++) {
    const pi: PhysicsInput = { moveX, moveZ, jumpPressed: pressed, jumpHeld: input.jumpHeld };
    physics.step(pi);
    pressed = false;
    jumped ||= physics.state.jumped;
    landImpact = Math.max(landImpact, physics.state.landImpact);
  }
  const s = physics.state;
  if (jumped) cube.kickJump();
  if (landImpact > 2) cube.kickLand(landImpact);

  // 렌더 보간
  pos.set(
    s.px + (s.x - s.px) * alpha,
    s.py + (s.y - s.py) * alpha,
    s.pz + (s.z - s.pz) * alpha,
  );

  const groundY = terrain.height(pos.x, pos.z);
  surfaceNormal(terrain, pos.x, pos.z, nTmp);
  normal.set(nTmp.x, nTmp.y, nTmp.z);

  timeOfDay = (timeOfDay + (dt / DAY_SECONDS) * (fast ? FAST : 1)) % 1;
  terrainMesh.update(pos.x, pos.z);
  cube.update(dt, pos, s.vy, s.grounded, groundY, faceX, faceZ, normal);

  // 추적 카메라: 높이는 천천히, 수평은 빠르게 따라간다
  const k = 1 - Math.exp(-dt * 10);
  const ky = 1 - Math.exp(-dt * 4);
  camTarget.x += (pos.x - camTarget.x) * k;
  camTarget.z += (pos.z - camTarget.z) * k;
  camTarget.y += (pos.y - camTarget.y) * ky;
  const cp = Math.cos(camPitch);
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * cp * CAM_DIST,
    camTarget.y + 1.2 + Math.sin(camPitch) * CAM_DIST,
    camTarget.z + Math.cos(camYaw) * cp * CAM_DIST,
  );
  const minY = terrain.height(camera.position.x, camera.position.z) + 1;
  if (camera.position.y < minY) camera.position.y = minY;
  camera.lookAt(camTarget.x, camTarget.y + 1.1, camTarget.z);

  sky.update(camera, sampleSky(timeOfDay));
  renderer.render(scene, camera);
  fpsCount++;
}

let fpsCount = 0;
camTarget.set(physics.state.x, physics.state.y, physics.state.z);
requestAnimationFrame(frame);

// 검증/디버깅용 훅
(window as unknown as Record<string, unknown>).__cube = {
  state: () => ({ ...physics.state, half: HALF, frames: fpsCount, timeOfDay }),
  setTime: (t: number) => { timeOfDay = t; },
};
