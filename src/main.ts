import * as THREE from 'three';
import { GameAudio } from './audio/audio';
import { Cube } from './cube/cube';
import { Particles } from './fx/particles';
import { hud } from './hud';
import { Input } from './input/input';
import { FixedStepper } from './physics/clock';
import { HALF, PhysicsWorld, type PhysicsInput } from './physics/world';
import { Clouds } from './sky/clouds';
import { sampleSky } from './sky/cycle';
import { Sky } from './sky/sky';
import { createTerrain, surfaceNormal } from './terrain/height';
import { ChunkManager } from './world/chunks';
import { PickupField } from './world/pickups';
import { ObjectCache, CHUNK } from './world/scatter';
import { StarField } from './world/stars';
import { Water } from './world/water';

// ---------- 저장 (막혀 있어도 게임은 돌아간다) ----------
const STORE_KEY = 'cubeworld.progress.v1';
function loadProgress(): { ids: Set<string>; score: number } {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return { ids: new Set<string>(Array.isArray(d.ids) ? d.ids : []), score: Number(d.score) || 0 };
  } catch {
    return { ids: new Set(), score: 0 };
  }
}
function saveProgress(ids: Set<string>, score: number) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ids: [...ids], score })); } catch { /* 무시 */ }
}

// ---------- 장면 ----------
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
let pixelRatio = Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#dff1ff', 30, 92);
const sky = new Sky(scene);
const clouds = new Clouds();
scene.add(clouds.mesh);

const terrain = createTerrain(1337);
const waterLevel = terrain.waterLevel ?? -Infinity;
const objects = new ObjectCache(terrain);
const chunks = new ChunkManager(terrain, objects);
chunks.prime(0, 0, 2);
scene.add(chunks.group);
const water = new Water(waterLevel);
scene.add(water.mesh);

const physics = new PhysicsWorld(terrain, 0, 0, objects);
const cube = new Cube();
scene.add(cube.group, cube.shadow);

const particles = new Particles();
scene.add(particles.mesh);

const progress = loadProgress();
let score = progress.score;
const field = new PickupField(terrain, progress.ids);
const starField = new StarField(field);
scene.add(starField.mesh);
hud.setScore(score);

const audio = new GameAudio();
hud.setMuted(audio.muted);
hud.onMute(() => hud.setMuted(audio.toggleMuted()));

// ---------- 낮밤 ----------
const DAY_SECONDS = 240;
const FAST = 20;
let timeOfDay = 0.3;
let fast = false;
hud.onFast(() => {
  fast = !fast;
  hud.setFast(fast);
});

// ---------- 카메라/입력 ----------
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

// ---------- 시작 ----------
let started = false;
hud.onStart(() => {
  started = true;
  audio.unlock();
  window.focus();
  hud.showHint(
    hud.isTouch ? '왼쪽 스틱으로 이동, 오른쪽 버튼으로 점프. 별을 찾아보세요' : '화살표가 가리키는 쪽에 별이 있어요. 높이 뜬 별은 점프로 잡아요',
  );
});
for (const ev of ['pointerdown', 'keydown'] as const) {
  addEventListener(ev, () => { if (started) audio.unlock(); });
}

// ---------- 상태 ----------
const stepper = new FixedStepper();
const pos = new THREE.Vector3();
const normal = new THREE.Vector3();
const nTmp = { x: 0, y: 1, z: 0 };
let faceX = 0;
let faceZ = 1;
let last = performance.now();
let stepDist = 0;
let compassT = 0;
let pruneT = 0;
let target: { x: number; z: number; dist: number } | null = null;
let fpsCount = 0;
let emaDt = 1 / 60;
let prTimer = -5; // 시작 직후의 셰이더 컴파일 끊김은 무시한다
const MILESTONES = [5, 15, 30, 60, 100, 200, 400];

const DUST = '#f1e8cc';
const SPLASH = '#dff6ff';

function collectStars() {
  const s = physics.state;
  const got = field.collectNear(s.x, s.y, s.z, 1.3);
  if (got.length === 0) return;
  const before = score;
  for (const g of got) {
    score += g.value;
    particles.emit(g.x, g.y, g.z, g.big ? 24 : 12, { color: '#ffe27a', speed: 3, up: 3.5, size: 0.14, life: 0.75, gravity: 5 });
    audio.collect(g.value);
    if (g.big) hud.toast('큰 별 조각! +5');
  }
  hud.setScore(score, true);
  const hit = MILESTONES.find((m) => before < m && score >= m);
  if (hit) {
    hud.toast(`별 ${hit}개 달성!`, 2800);
    audio.milestone();
  }
  saveProgress(field.collected, score);
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const time = now / 1000;

  // 느린 기기에서는 해상도를 낮춰 부드러움을 지킨다
  emaDt += (dt - emaDt) * 0.05;
  prTimer += dt;
  if (prTimer > 3) {
    prTimer = 0;
    if (emaDt > 1 / 28 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      resize();
    }
  }

  const inp = input.read();
  if (!started) {
    input.consumeJump();
    inp.moveX = inp.moveY = inp.lookYaw = inp.lookPitch = 0;
    camYaw += dt * 0.12; // 시작 화면 뒤에서 천천히 도는 카메라
  }
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
    const pi: PhysicsInput = { moveX, moveZ, jumpPressed: pressed, jumpHeld: started && input.jumpHeld };
    physics.step(pi);
    pressed = false;
    jumped ||= physics.state.jumped;
    landImpact = Math.max(landImpact, physics.state.landImpact);
  }
  const s = physics.state;
  const speed = Math.hypot(s.vx, s.vz);
  const feetY = s.inWater ? waterLevel + 0.05 : s.groundY + 0.1;

  // ---- 연출: 점프/착지/발걸음 ----
  if (jumped) {
    cube.kickJump();
    audio.jump();
    particles.emit(s.x, feetY, s.z, s.inWater ? 8 : 5, { color: s.inWater ? SPLASH : DUST, speed: 1.6, up: 2, size: 0.1 });
  }
  if (landImpact > 2) {
    cube.kickLand(landImpact);
    if (s.inWater) {
      audio.splash();
      particles.emit(s.x, feetY, s.z, 16, { color: SPLASH, speed: 2.6, up: 5, size: 0.12, life: 0.7 });
    } else {
      audio.land(landImpact);
      particles.emit(s.x, feetY, s.z, Math.min(12, 4 + Math.round(landImpact * 0.4)), { color: DUST, speed: 2.4, up: 1.6, size: 0.12 });
    }
  }
  if (started && s.grounded && speed > 2) {
    stepDist += speed * dt;
    if (stepDist > 1.6) {
      stepDist = 0;
      audio.step();
      particles.emit(s.x - (s.vx / speed) * 0.4, feetY, s.z - (s.vz / speed) * 0.4, 2, {
        color: s.inWater ? SPLASH : DUST, speed: 0.8, up: 1.4, size: 0.08, life: 0.4,
      });
    }
  }

  if (started) collectStars();

  // ---- 나침반: 가장 가까운 별을 가리킨다 ----
  compassT -= dt;
  if (compassT <= 0) {
    compassT = 0.25;
    const n = field.nearest(s.x, s.z, 3);
    target = n ? { x: n.pickup.x, z: n.pickup.z, dist: n.dist } : null;
  }
  if (started && target) {
    const dx = target.x - s.x, dz = target.z - s.z;
    const deg = (Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) * 180) / Math.PI;
    hud.setCompass(deg, Math.hypot(dx, dz));
  } else {
    hud.setCompass(null);
  }
  pruneT -= dt;
  if (pruneT <= 0) {
    pruneT = 2;
    field.prune(Math.floor(s.x / CHUNK), Math.floor(s.z / CHUNK), 6);
  }

  // ---- 렌더 보간 ----
  pos.set(
    s.px + (s.x - s.px) * alpha,
    s.py + (s.y - s.py) * alpha,
    s.pz + (s.z - s.pz) * alpha,
  );

  // 그림자/기울기: 물 위나 바위 위에서는 수평으로, 그 외에는 지형 법선을 따른다
  const terrH = terrain.height(pos.x, pos.z);
  const groundY = s.inWater ? waterLevel - 0.01 : s.groundY;
  if (s.inWater || s.groundY > terrH + 0.05) normal.set(0, 1, 0);
  else {
    surfaceNormal(terrain, pos.x, pos.z, nTmp);
    normal.set(nTmp.x, nTmp.y, nTmp.z);
  }
  if (s.inWater) pos.y += Math.sin(now / 380) * 0.04; // 물 위에서 살짝 출렁

  timeOfDay = (timeOfDay + (dt / DAY_SECONDS) * (fast ? FAST : 1)) % 1;
  chunks.update(pos.x, pos.z);
  cube.update(dt, pos, s.vy, s.grounded, groundY, faceX, faceZ, normal);
  starField.update(s.x, s.z, time);
  particles.update(dt);

  // ---- 추적 카메라: 높이는 천천히, 수평은 빠르게 ----
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
  const minY = Math.max(terrain.height(camera.position.x, camera.position.z), waterLevel) + 1;
  if (camera.position.y < minY) camera.position.y = minY;
  camera.lookAt(camTarget.x, camTarget.y + 1.1, camTarget.z);

  const skyState = sampleSky(timeOfDay);
  sky.update(camera, skyState);
  clouds.update(camera, time, skyState);
  water.update(camera.position.x, camera.position.z, time, Math.min(1, skyState.sunIntensity / 1.25 + skyState.moonIntensity * 0.3));
  if (started) audio.update(dt, { elevation: skyState.elevation, speed, grounded: s.grounded });

  renderer.render(scene, camera);
  fpsCount++;
}

camTarget.set(physics.state.x, physics.state.y, physics.state.z);
requestAnimationFrame(frame);

// 검증/디버깅용 훅
(window as unknown as Record<string, unknown>).__cube = {
  state: () => ({ ...physics.state, half: HALF, frames: fpsCount, timeOfDay, score, pixelRatio, audio: audio.state }),
  setTime: (t: number) => { timeOfDay = t; },
  chunks: () => chunks.count,
  nearestStar: () => {
    const n = field.nearest(physics.state.x, physics.state.z, 3);
    return n ? { ...n.pickup, dist: n.dist } : null;
  },
  teleport: (x: number, z: number, y?: number) => {
    const st = physics.state;
    st.x = st.px = x; st.z = st.pz = z;
    st.y = st.py = y ?? Math.max(terrain.height(x, z), waterLevel) + 4;
    st.vx = st.vy = st.vz = 0;
    camTarget.set(x, st.y, z);
  },
};
