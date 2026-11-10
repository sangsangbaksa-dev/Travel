import * as THREE from 'three';
import { GameAudio } from './audio/audio';
import { Cube } from './cube/cube';
import { Particles } from './fx/particles';
import { hud } from './hud';
import { Input } from './input/input';
import { FixedStepper } from './physics/clock';
import { HALF, type PhysicsInput } from './physics/world';
import { surfaceNormal } from './physics/terrain';
import { Clouds } from './sky/clouds';
import { sampleSkyForSun } from './sky/cycle';
import { Sky } from './sky/sky';
import { Atmosphere } from './earth/atmosphere';
import { Frame, LocalTerrain, SphereBody } from './earth/body';
import { loadCountries } from './earth/countries';
import { dirFromLatLon, eastNorth, latLonFromDir, METERS_PER_HEIGHT, RADIUS } from './earth/geo';
import { Landmarks } from './earth/landmarks';
import { Ocean } from './earth/ocean';
import { EARTH_IMAGE_URL, loadPlanet } from './earth/planet';
import { seaName } from './earth/places';
import { dayOfYear, sunDirection } from './earth/sun';
import { PlanetTerrain } from './earth/terrain';
import { Vegetation } from './earth/vegetation';
import { Minimap } from './world/minimap';

// ---------- 장면 ----------
const app = document.getElementById('app')!;
const coarsePointer = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const renderer = new THREE.WebGLRenderer({ antialias: !coarsePointer, logarithmicDepthBuffer: true });
let pixelRatio = Math.min(devicePixelRatio || 1, coarsePointer ? 1.25 : 1.75);
renderer.setPixelRatio(pixelRatio);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#b4d2ee', 150, 2200);
/** 플레이어 발밑 해수면을 원점으로 하는 지역 좌표계. 카메라, 큐브, 하늘이 여기 들어간다 */
const local = new THREE.Group();
local.matrixAutoUpdate = false;
scene.add(local);

hud.setLoading('지구를 불러오는 중…');
const [planet, countries] = await Promise.all([loadPlanet(), loadCountries()]);
const landmarks = new Landmarks(planet);
scene.add(landmarks.group);

const terrain = new PlanetTerrain(planet);
scene.add(terrain.group);
const ocean = new Ocean();
local.add(ocean.near);
scene.add(ocean.far);
const atmosphere = new Atmosphere();
scene.add(atmosphere.mesh);
const sky = new Sky(scene, local);
const clouds = new Clouds();
local.add(clouds.mesh);
const vegetation = new Vegetation(planet, landmarks);
scene.add(vegetation.group);

const body = new SphereBody(planet, landmarks.spawn);
{
  // 처음에는 북쪽을 기준으로 둔다 (지역 -Z = 북쪽)
  const e = new THREE.Vector3(), n = new THREE.Vector3();
  eastNorth(body.frame.up, e, n);
  body.frame.z.copy(n).negate();
  body.frame.moveTo(body.pos);
}
body.addObstacles(landmarks);
body.addObstacles(vegetation);
const cube = new Cube();
local.add(cube.group, cube.shadow);
const particles = new Particles();
scene.add(particles.mesh);

const audio = new GameAudio();
hud.setMuted(audio.muted);
hud.onMute(() => hud.setMuted(audio.toggleMuted()));

// ---------- 시간: 실제 날짜의 계절, 뉴욕 오전 10시에서 시작. 하루는 10분 ----------
const DAY_SECONDS = 600;
const today = dayOfYear(new Date());
let utcHours = 15;

// ---------- 카메라/입력 ----------
const input = new Input(renderer.domElement, app);
const minimap = new Minimap(app, EARTH_IMAGE_URL, landmarks.marks);
const camera = new THREE.PerspectiveCamera(60, 1, 0.08, 60000);
local.add(camera);
let camYaw = -0.5; // 맨해튼 애비뉴를 따라 북쪽을 바라본다
let camPitch = 0.26;
let camDist = 6;
let firstPerson = false;
const MIN_DIST = 4, MAX_DIST = 26000;
hud.onView(() => { firstPerson = !firstPerson; hud.setView(firstPerson); });
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDist = THREE.MathUtils.clamp(camDist * Math.exp(e.deltaY * 0.0012), MIN_DIST, MAX_DIST);
}, { passive: false });
const zoomKeys = new Set<string>();
addEventListener('keydown', (e) => { if (e.code === 'Minus' || e.code === 'Equal') zoomKeys.add(e.code); });
addEventListener('keyup', (e) => zoomKeys.delete(e.code));
hud.onZoom((dir) => { camDist = THREE.MathUtils.clamp(camDist * (dir > 0 ? 3 : 1 / 3), MIN_DIST, MAX_DIST); });

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- 상태 ----------
const stepper = new FixedStepper();
const view = new Frame();
const viewTerrain = new LocalTerrain(planet, view);
const interp = new THREE.Vector3();
const normal = new THREE.Vector3();
const nTmp = { x: 0, y: 1, z: 0 };
const camWorld = new THREE.Vector3();
const targetWorld = new THREE.Vector3();
const sunWorld = new THREE.Vector3();
const sunLocal = new THREE.Vector3();
const east = new THREE.Vector3(), north = new THREE.Vector3();
const lastPos = new THREE.Vector3();
const feet = new THREE.Vector3();
const tmp = new THREE.Vector3();
const ray = new THREE.Raycaster();
const horizonColor = new THREE.Color();
const DEEP = new THREE.Color('#06202c');
const SHALLOW = new THREE.Color('#2d7f8c');
let faceX = 0, faceZ = 1;
let odoX = 0, odoZ = 0;
let camAlt = 0;
let last = performance.now();
let stepDist = 0;
let placeT = 0;
let placeName = '';
let fpsCount = 0;
let emaDt = 1 / 60;
let prTimer = -5;
const DUST = '#d8cdb0';
const SPLASH = '#dff6ff';

view.z.copy(body.frame.z);
view.moveTo(body.pos);
camAlt = body.pos.length() - RADIUS;
local.matrix.copy(view.matrix);
local.updateMatrixWorld(true);
camera.position.set(0, camAlt + 4, 8);
terrain.prime(view.toWorld(0, camAlt + 4, 8, tmp));
hud.setLoading(null);

// ---------- 시작 ----------
let started = false;
hud.onStart(() => {
  started = true;
  input.start();
  document.body.classList.add('game-started');
  audio.unlock();
  window.focus();
  hud.showHint(hud.isTouch
    ? '왼쪽 스틱으로 이동, 두 손가락 버튼으로 우주까지 멀어질 수 있어요'
    : '마우스 휠로 우주까지 멀어지고, T로 1인칭/3인칭을 바꿔요');
});
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => { if (started) audio.unlock(); });

/** 지금 있는 곳의 이름 */
/** h: 지형 높이(칸, 1칸 = 100m), above: 지형 위로 올라선 높이(m, 건물 옥상 등) */
function placeAt(dir: THREE.Vector3, h: number, above: number, inWater: boolean): string {
  const ll = latLonFromDir(dir.x, dir.y, dir.z);
  const mark = landmarks.nameAt(dir);
  const country = countries.nameAt(ll.lat, ll.lon);
  const where = mark ? (country && country !== mark ? `${country} · ${mark}` : mark)
    : country ?? (inWater || h < 0 ? seaName(ll.lat, ll.lon) : '');
  const m = Math.round(h * METERS_PER_HEIGHT + Math.max(0, above));
  const alt = h < -0.3 ? `수심 ${(-m).toLocaleString('ko-KR')}m` : `해발 ${Math.max(0, m).toLocaleString('ko-KR')}m`;
  const ns = ll.lat >= 0 ? 'N' : 'S', ew = ll.lon >= 0 ? 'E' : 'W';
  return `${where || '지구'} · ${alt} · ${Math.abs(ll.lat).toFixed(1)}°${ns} ${Math.abs(ll.lon).toFixed(1)}°${ew}`;
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const time = now / 1000;

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

  const inp = input.read(dt);
  if (!started) {
    input.consumeJump();
    inp.moveX = inp.moveY = inp.lookYaw = inp.lookPitch = 0;
    camYaw += dt * 0.12;
  }
  camYaw -= inp.lookYaw;
  if (zoomKeys.has('Minus')) camDist = Math.min(MAX_DIST, camDist * Math.exp(dt * 2.2));
  if (zoomKeys.has('Equal')) camDist = Math.max(MIN_DIST, camDist * Math.exp(-dt * 2.2));
  const space = THREE.MathUtils.smoothstep(camDist, 60, 2400);
  if (firstPerson) camPitch = THREE.MathUtils.clamp(camPitch + inp.lookPitch, -1.35, 1.35);
  else camPitch = THREE.MathUtils.clamp(camPitch + inp.lookPitch, 0.05, THREE.MathUtils.lerp(1.25, 1.52, space));

  // 카메라 기준 입력 → 지역 좌표계 방향
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  const moveX = fx * inp.moveY + rx * inp.moveX;
  const moveZ = fz * inp.moveY + rz * inp.moveX;
  if (moveX * moveX + moveZ * moveZ > 0.01) { faceX = moveX; faceZ = moveZ; }

  const { steps, alpha } = stepper.advance(dt);
  let jumped = false;
  let landImpact = 0;
  let pressed = steps > 0 && input.consumeJump();
  lastPos.copy(body.pos);
  for (let i = 0; i < steps; i++) {
    const pi: PhysicsInput = { moveX, moveZ, jumpPressed: pressed, jumpHeld: started && input.jumpHeld, diveHeld: started && input.diveHeld, run: started && input.runHeld };
    body.step(pi);
    pressed = false;
    jumped ||= body.physics.state.jumped;
    landImpact = Math.max(landImpact, body.physics.state.landImpact);
  }
  const s = body.physics.state;
  tmp.subVectors(body.pos, lastPos);
  odoX += tmp.dot(body.frame.x);
  odoZ += tmp.dot(body.frame.z);
  const speed = Math.hypot(s.vx, s.vz);

  // ---- 렌더 좌표계: 보간 위치의 접평면 ----
  body.lerp(alpha, interp);
  view.z.copy(body.frame.z);
  view.moveTo(interp);
  local.matrix.copy(view.matrix);
  local.updateMatrixWorld(true);
  const y = interp.length() - RADIUS;
  const localWater = viewTerrain.waterAt(0, 0);
  const groundY = s.inWater && !s.submerged ? localWater - 0.01 : s.groundY;
  const feetY = s.inWater && !s.submerged ? localWater + 0.05 : s.groundY + 0.1;
  view.toWorld(0, feetY, 0, feet);

  // ---- 연출: 점프/착지/발걸음 ----
  if (jumped) {
    cube.kickJump();
    audio.jump();
    particles.emit(feet, view.up, s.inWater ? 8 : 5, { color: s.inWater ? SPLASH : DUST, speed: 1.6, up: 2, size: 0.1 });
  }
  if (landImpact > 2) {
    cube.kickLand(landImpact);
    if (s.inWater) {
      audio.splash();
      particles.emit(feet, view.up, 16, { color: SPLASH, speed: 2.6, up: 5, size: 0.12, life: 0.7 });
    } else {
      audio.land(landImpact);
      particles.emit(feet, view.up, Math.min(12, 4 + Math.round(landImpact * 0.4)), { color: DUST, speed: 2.4, up: 1.6, size: 0.12 });
    }
  }
  if (started && s.grounded && speed > 2) {
    stepDist += speed * dt;
    if (stepDist > 1.6) {
      stepDist = 0;
      audio.step();
      particles.emit(feet, view.up, 2, { color: s.inWater ? SPLASH : DUST, speed: 0.8, up: 1.4, size: 0.08, life: 0.4 });
    }
  }

  placeT -= dt;
  if (placeT <= 0) {
    placeT = 0.5;
    const terr = viewTerrain.height(0, 0);
    const name = placeAt(view.up, s.inWater ? Math.max(terr, s.submerged ? terr : 0) : terr, s.inWater ? 0 : s.groundY - terr, s.inWater);
    if (name !== placeName) { placeName = name; hud.setPlace(name); }
  }

  // 그림자/기울기
  const terrH = viewTerrain.height(0, 0);
  if (s.inWater || s.groundY > terrH + 0.05) normal.set(0, 1, 0);
  else {
    surfaceNormal(viewTerrain, 0, 0, nTmp);
    normal.set(nTmp.x, nTmp.y, nTmp.z);
  }
  const cubePos = tmp.set(0, y, 0);
  if (s.inWater && !s.submerged) cubePos.y += Math.sin(now / 380) * 0.04;
  cube.update(dt, cubePos, s.vy, s.grounded, groundY, faceX, faceZ, normal);
  cube.group.visible = !firstPerson;
  cube.shadow.visible = !firstPerson && camDist < 200;
  particles.update(dt);

  // ---- 카메라 ----
  const ky = 1 - Math.exp(-dt * 6);
  camAlt += (y - camAlt) * ky;
  if (firstPerson) {
    const eye = y + 0.22;
    camera.position.set(0, eye, 0);
    const cp = Math.cos(camPitch);
    targetWorld.copy(view.toWorld(fx * cp, eye - Math.sin(camPitch), fz * cp, targetWorld));
  } else {
    const cp = Math.cos(camPitch);
    const dist = s.submerged ? Math.min(camDist, 3.2) : camDist;
    const lift = THREE.MathUtils.lerp(s.submerged ? 0.35 : 1.2, 0, space);
    camera.position.set(Math.sin(camYaw) * cp * dist, camAlt + lift + Math.sin(camPitch) * dist, Math.cos(camYaw) * cp * dist);
    if (dist < 400) {
      const cx = camera.position.x, cz = camera.position.z;
      const floor = viewTerrain.height(cx, cz), water = viewTerrain.waterAt(cx, cz);
      const minY = s.submerged ? floor + 0.25 : Math.max(floor, water) + 1;
      if (camera.position.y < minY) camera.position.y = minY;
      if (s.submerged) camera.position.y = Math.min(camera.position.y, water - 0.1);
    }
    view.toWorld(0, camAlt + THREE.MathUtils.lerp(s.submerged ? 0.2 : 1.1, 0, space), 0, targetWorld);
    // 빌딩 숲에서는 카메라가 벽 속으로 들어가지 않게 앞으로 당긴다
    const city = landmarks.nyc.buildings;
    if (city && dist < 120 && landmarks.nyc.near(targetWorld)) {
      view.toWorld(camera.position.x, camera.position.y, camera.position.z, camWorld);
      const toCam = tmp.subVectors(camWorld, targetWorld);
      const len = toCam.length();
      ray.set(targetWorld, toCam.divideScalar(len));
      ray.far = len;
      const hit = ray.intersectObject(city, false)[0];
      if (hit) {
        const k = Math.max(0.15, (hit.distance - 0.4) / len);
        camera.position.y = camAlt + (camera.position.y - camAlt) * k;
        camera.position.x *= k;
        camera.position.z *= k;
      }
    }
  }
  camera.up.copy(view.up);
  camera.lookAt(targetWorld);
  camera.updateMatrixWorld();
  camera.getWorldPosition(camWorld);
  const altitude = camWorld.length() - RADIUS;

  // ---- 해와 하늘 ----
  utcHours = (utcHours + (dt / DAY_SECONDS) * 24) % 24;
  sunDirection(today, utcHours, sunWorld);
  view.dirToLocal(sunWorld, sunLocal);
  eastNorth(view.up, east, north);
  const skyState = sampleSkyForSun(sunLocal.y, sunWorld.dot(east) > 0);
  skyState.sunDir = [sunLocal.x, sunLocal.y, sunLocal.z];
  const ll = latLonFromDir(view.up.x, view.up.y, view.up.z);
  const night = THREE.MathUtils.clamp((0.05 - sunLocal.y) / 0.25, 0, 1);
  const aurora = night * THREE.MathUtils.smoothstep(Math.abs(ll.lat), 56, 68);
  sky.update(camera.position, skyState, time, { sun: sunWorld, up: view.up, space, aurora });
  terrain.sunDir.value.copy(sunWorld);
  horizonColor.setRGB(...skyState.horizon);

  // 안개: 땅에서는 아지랑이, 높이 오를수록 걷히고, 물속에서는 짙은 청록색
  const fog = scene.fog as THREE.Fog;
  const underwater = camWorld.length() < RADIUS - 0.02 && !s.inWater || (s.submerged && camWorld.length() < RADIUS);
  document.body.classList.toggle('underwater', underwater);
  if (underwater) {
    const depth = THREE.MathUtils.clamp((RADIUS - camWorld.length()) / 40, 0, 1);
    fog.color.copy(SHALLOW).lerp(DEEP, depth);
    fog.near = 2;
    fog.far = 42 - depth * 18;
  } else {
    fog.color.copy(horizonColor);
    fog.near = 150 + altitude * 2;
    fog.far = (2200 + altitude * 6) / Math.max(0.02, 1 - space);
  }

  terrain.update(camWorld);
  landmarks.update(camWorld, time, night);
  vegetation.update(body.pos);
  ocean.update(time, sunWorld, camWorld, view.up, horizonColor);
  atmosphere.update(sunWorld, camWorld, space);
  clouds.update(time, skyState, odoX, odoZ, altitude);
  const faceWorld = tmp.copy(view.x).multiplyScalar(faceX).addScaledVector(view.z, faceZ);
  minimap.update(ll.lat, ll.lon, Math.atan2(faceWorld.dot(east), faceWorld.dot(north)), dt, started && camDist < 1500);
  if (started) audio.update(dt, { elevation: sunLocal.y, speed, grounded: s.grounded });

  renderer.render(scene, camera);
  fpsCount++;
}

requestAnimationFrame(frame);

// 검증/디버깅용 훅
(window as unknown as Record<string, unknown>).__cube = {
  state: () => {
    const ll = latLonFromDir(body.pos.x, body.pos.y, body.pos.z);
    return { ...body.physics.state, ...ll, half: HALF, frames: fpsCount, utcHours, pixelRatio, terrainMeshes: terrain.count, camDist };
  },
  setTime: (h: number) => { utcHours = h; },
  setZoom: (d: number) => { camDist = d; },
  setView: (yaw: number, pitch: number) => { camYaw = yaw; camPitch = pitch; },
  firstPerson: (v: boolean) => { firstPerson = v; hud.setView(v); },
  teleport: (lat: number, lon: number, lift = 3) => {
    body.teleport(dirFromLatLon(lat, lon), lift);
    camAlt = body.pos.length() - RADIUS;
  },
  prime: () => terrain.prime(camWorld),
};
