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
import { BIOME_NAMES, BIOMES, dominantBiome } from './terrain/biome';
import { createTerrain, surfaceNormal, terrainInfo, waterHeightAt } from './terrain/height';
import { ChunkManager } from './world/chunks';
import { CreatureField } from './world/creatures';
import { FishSchools } from './world/fish';
import { DeepSea } from './world/deepSea';
import { Residents } from './world/residents';
import { CAVE, caveCeilingAt, caveObstacles, createPassageTerrain, isCave, passageZone, Passages, type Realm } from './world/passages';
import { createVolcanicTerrain, Volcano, VOLCANO } from './world/volcano';
import { alpineDistance, createAlpineTerrain, makeAlpineLake } from './world/alpineLake';
import { RealmCreatures } from './world/realmCreatures';
import { Minimap } from './world/minimap';
import { Settlements } from './world/settlements';
import { settlementNameAt } from './world/settlement-layout';
import { ObjectCache } from './world/scatter';
import { Water } from './world/water';

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

const terrain = createPassageTerrain(createAlpineTerrain(createVolcanicTerrain(createTerrain(1337))));
const waterLevel = terrain.waterLevel ?? -Infinity;
const objects = new ObjectCache(terrain);
const chunks = new ChunkManager(terrain, objects);
chunks.prime(0, 0, 2);
scene.add(chunks.group);
const water = new Water(waterLevel);
const lake = makeAlpineLake();
scene.add(water.mesh, lake.mesh);

const realms: { terrain: typeof terrain; mode: Realm } = { terrain, mode: 'surface' };
scene.add(new Passages(terrain).group);
const volcano = new Volcano();
scene.add(volcano.group);
const realmCreatures = new RealmCreatures(realms.terrain);
const creatures = new CreatureField(terrain);
const fish = new FishSchools(terrain);
const deepSea = new DeepSea(terrain);
const residents = new Residents(terrain);
const settlements = new Settlements(terrain);
scene.add(creatures.group, residents.group, settlements.group, realmCreatures.group);
scene.add(fish.mesh, deepSea.group);
const physics = new PhysicsWorld(realms.terrain, 0, 0, {
  near: (x, z) => realms.mode === 'surface' ? objects.near(x, z) : caveObstacles(x, z),
});
const cube = new Cube();
scene.add(cube.group, cube.shadow);

const particles = new Particles();
scene.add(particles.mesh);

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
const minimap = new Minimap(app, deepSea.site);
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
  input.start();
  document.body.classList.add('game-started');
  audio.unlock();
  window.focus();
  hud.showHint(
    hud.isTouch ? '왼쪽 스틱으로 이동하고 오른쪽 버튼으로 점프해요' : '마우스로 둘러보고, Esc로 커서를 꺼내요. 다시 클릭하면 돌아와요',
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
let placeT = 0;
let placeName = '';
let fireflyT = 0;
let fpsCount = 0;
let emaDt = 1 / 60;
let prTimer = -5; // 시작 직후의 셰이더 컴파일 끊김은 무시한다

const DUST = '#f1e8cc';
const SPLASH = '#dff6ff';
const DEEP_WATER_COLOR = new THREE.Color('#244858');

/** 지금 서 있는 곳의 이름 */
function placeAt(x: number, z: number, y: number, inWater: boolean): string {
  if (realms.mode === 'cave') return '지하 동굴';
  if (realms.mode === 'sky') return '구름 위 전망대';
  if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < 105 && !inWater) return '화산';
  if (alpineDistance(x, z) < 1.55) return '빙하호';
  const settlement = settlementNameAt(x, z);
  if (settlement) return settlement;
  if (inWater) return terrainInfo(x, z, 1337).landness < 0.6 ? '바다' : '강·호수';
  if (y > 14) return '산악 지대';
  const b = dominantBiome(terrain.climate!(x, z));
  return BIOME_NAMES[BIOMES[b]];
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
    const pi: PhysicsInput = { moveX, moveZ, jumpPressed: pressed, jumpHeld: started && input.jumpHeld, diveHeld: started && input.diveHeld };
    physics.step(pi);
    pressed = false;
    jumped ||= physics.state.jumped;
    landImpact = Math.max(landImpact, physics.state.landImpact);
  }
  const s = physics.state;
  realms.mode = passageZone(s.x, s.z);
  creatures.group.visible = residents.group.visible = realms.mode === 'surface';
  minimap.update(s.x, s.z, faceX, faceZ, dt, started && realms.mode === 'surface');
  fish.update(s.x, s.z, time, dt, started && realms.mode === 'surface' && s.submerged);
  deepSea.update(s.x, s.z, started && realms.mode === 'surface' && s.submerged);
  const speed = Math.hypot(s.vx, s.vz);
  const localWater = waterHeightAt(terrain, s.x, s.z);
  const feetY = s.inWater && !s.submerged ? localWater + 0.05 : s.groundY + 0.1;

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

  placeT -= dt;
  if (placeT <= 0) {
    placeT = 0.5;
    const name = placeAt(s.x, s.z, s.y, s.inWater);
    if (name !== placeName) {
      placeName = name;
      hud.setPlace(name);
    }
  }
  // ---- 렌더 보간 ----
  pos.set(
    s.px + (s.x - s.px) * alpha,
    s.py + (s.y - s.py) * alpha,
    s.pz + (s.z - s.pz) * alpha,
  );

  // 그림자/기울기: 물 위나 바위 위에서는 수평으로, 그 외에는 지형 법선을 따른다
  const terrH = realms.terrain.height(pos.x, pos.z);
  const groundY = s.inWater && !s.submerged ? localWater - 0.01 : s.groundY;
  if (s.inWater || s.groundY > terrH + 0.05) normal.set(0, 1, 0);
  else {
    surfaceNormal(realms.terrain, pos.x, pos.z, nTmp);
    normal.set(nTmp.x, nTmp.y, nTmp.z);
  }
  if (s.inWater && !s.submerged) pos.y += Math.sin(now / 380) * 0.04; // 물 위에서 살짝 출렁

  timeOfDay = (timeOfDay + (dt / DAY_SECONDS) * (fast ? FAST : 1)) % 1;
  chunks.update(pos.x, pos.z);
  volcano.update(time);
  if (realms.mode === 'surface') {
    creatures.update(pos.x, pos.z, time);
    residents.update(time);
    settlements.update(pos.x, pos.z);
  }
  realmCreatures.update(realms.mode, pos.x, pos.z, time);
  cube.update(dt, pos, s.vy, s.grounded, groundY, faceX, faceZ, normal);
  particles.update(dt);

  // ---- 추적 카메라: 높이는 천천히, 수평은 빠르게 ----
  const k = 1 - Math.exp(-dt * 10);
  const ky = 1 - Math.exp(-dt * 4);
  camTarget.x += (pos.x - camTarget.x) * k;
  camTarget.z += (pos.z - camTarget.z) * k;
  camTarget.y += (pos.y - camTarget.y) * ky;
  const cp = Math.cos(camPitch);
  const cameraDistance = s.submerged ? 3.2 : CAM_DIST;
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * cp * cameraDistance,
    camTarget.y + (s.submerged ? 0.35 : 1.2) + Math.sin(camPitch) * (s.submerged ? 0.5 : CAM_DIST),
    camTarget.z + Math.cos(camYaw) * cp * cameraDistance,
  );
  if (realms.mode === 'cave') {
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, CAVE.x - 3.15, CAVE.x + 3.15);
    camera.position.z = Math.max(camera.position.z, CAVE.endWall + 4);
  }
  let cameraWater = waterHeightAt(terrain, camera.position.x, camera.position.z);
  if (s.submerged && (cameraWater !== localWater || terrain.height(camera.position.x, camera.position.z) + .5 >= cameraWater)) {
    camera.position.x = pos.x;
    camera.position.z = pos.z;
    cameraWater = waterHeightAt(terrain, pos.x, pos.z);
  }
  const cameraFloor = terrain.height(camera.position.x, camera.position.z);
  const minY = s.submerged ? cameraFloor + 0.25 : Math.max(cameraFloor, cameraWater) + 1;
  if (camera.position.y < minY) camera.position.y = minY;
  if (realms.mode === 'cave' && isCave(camera.position.x, camera.position.z)) {
    const ceiling = caveCeilingAt(terrain, camera.position.x, camera.position.z);
    camera.position.y = Math.min(camera.position.y, Math.max(minY, ceiling - .45));
  }
  if (s.submerged && minY < cameraWater - 0.1) camera.position.y = Math.min(camera.position.y, cameraWater - 0.1);
  camera.lookAt(camTarget.x, camTarget.y + (s.submerged ? 0.2 : 1.1), camTarget.z);

  const skyState = sampleSky(timeOfDay);
  const night = THREE.MathUtils.clamp((0.1 - skyState.elevation) / 0.3, 0, 1);
  chunks.animate(time);

  // 밤의 반딧불: 마법 지대에서는 더 많고 색이 다르다
  if (started && night > 0.3 && realms.mode === 'surface') {
    fireflyT -= dt;
    if (fireflyT <= 0) {
      fireflyT = 0.35;
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 9;
      const fx2 = s.x + Math.cos(a) * r, fz2 = s.z + Math.sin(a) * r;
      const fy = Math.max(terrain.height(fx2, fz2), waterHeightAt(terrain, fx2, fz2)) + 0.6 + Math.random() * 2.2;
      particles.emit(fx2, fy, fz2, 1, { color: '#fff6a8', speed: 0.5, up: 0.4, size: 0.09, life: 4, gravity: 0 });
    }
  }
  sky.update(camera, skyState, time);
  const underwaterView = realms.mode === 'surface' && camera.position.y < cameraWater;
  document.body.classList.toggle('underwater', underwaterView);
  const fog = scene.fog as THREE.Fog;
  const inCave = realms.mode === 'cave';
  fog.near = underwaterView ? 5 : inCave ? 12 : 30;
  fog.far = underwaterView ? 38 : inCave ? 68 : 92;
  if (underwaterView) {
    const depth = THREE.MathUtils.clamp((cameraWater - camera.position.y) / 20, 0, 1);
    fog.color.set('#5ea6b1').lerp(DEEP_WATER_COLOR, depth);
    fog.far = 38 - depth * 10;
  }
  else if (inCave) fog.color.set('#55566a');
  clouds.mesh.visible = !inCave;
  clouds.update(camera, time, skyState);
  const brightness = Math.min(1, skyState.sunIntensity / 1.25 + skyState.moonIntensity * 0.3);
  water.update(camera.position.x, camera.position.z, time, brightness);
  lake.update(camera.position.x, camera.position.z, time, brightness);
  if (started) audio.update(dt, { elevation: skyState.elevation, speed, grounded: s.grounded });

  renderer.render(scene, camera);
  fpsCount++;
}

camTarget.set(physics.state.x, physics.state.y, physics.state.z);
requestAnimationFrame(frame);

// 검증/디버깅용 훅
(window as unknown as Record<string, unknown>).__cube = {
  state: () => ({ ...physics.state, half: HALF, frames: fpsCount, timeOfDay, pixelRatio, audio: audio.state }),
  setTime: (t: number) => { timeOfDay = t; },
  chunks: () => chunks.count,
  teleport: (x: number, z: number, y?: number) => {
    const st = physics.state;
    st.x = st.px = x; st.z = st.pz = z;
    st.y = st.py = y ?? Math.max(terrain.height(x, z), waterHeightAt(terrain, x, z)) + 4;
    st.vx = st.vy = st.vz = 0;
    camTarget.set(x, st.y, z);
  },
};
