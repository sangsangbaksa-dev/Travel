import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { WorldObstacle } from './body';
import type { TerrainShaper } from './elevation';
import { RADIUS, TangentPlane } from './geo';
import { noise3 } from './noise3';

// 뉴욕: 행성 축척(1칸 ≈ 1.2km)으로는 맨해튼이 3칸뿐이라, 이 주변만 약 1칸 ≈ 145m로 확대해서
// 섬, 강, 항구, 격자 도로, 마천루, 센트럴 파크, 자유의 여신상을 꾸민다.
// 좌표: e(동), n(북). 맨해튼 격자는 북쪽에서 29° 기울어져 있다 → s(섬 방향), t(섬을 가로지르는 방향).

export const NYC = { lat: 40.758, lon: -73.9855, name: '뉴욕' } as const;
/** 도시 좌표 1칸이 행성 몇 칸(m)인가 (가로), 건물 높이 배율 (세로). 큐브 = 1m, 건물은 실제 높이 */
const K = 6;
const V = 12;
export const NYC_RADIUS = 175 * K;
const BLEND_END = 215 * K;
export const STREET_Y = 0.6;
const ANG = 29 * Math.PI / 180;
const DS = { e: Math.sin(ANG), n: Math.cos(ANG) }; // 섬 방향 (북북동)
const DT = { e: Math.cos(ANG), n: -Math.sin(ANG) }; // 가로 방향 (동남동)

const S_SOUTH = -45, S_NORTH = 100;
const HALF_W = 13.5;
const AVE_PITCH = 6, ST_PITCH = 5, ROAD = 2;
const PARK = { s0: 11, s1: 39, t0: -5, t1: 5 };
const LIBERTY = { s: -64, t: -21, r: 2.8 };
const TIMES_SQ = { s0: 1, s1: 4, t0: -5, t1: -1 };

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const st = (e: number, n: number) => ({ s: (e * DS.e + n * DS.n) / K, t: (e * DT.e + n * DT.n) / K });
const en = (s: number, t: number) => ({ e: (s * DS.e + t * DT.e) * K, n: (s * DS.n + t * DT.n) * K });

/** 맨해튼 섬 안쪽으로 얼마나 들어와 있는가 (양수면 섬) */
function manhattan(s: number, t: number): number {
  const w = s > -30 ? HALF_W : HALF_W - (-30 - s) * 0.42;
  return Math.min(w - Math.abs(t), s - S_SOUTH, S_NORTH - s);
}

/** 육지 정도: 양수면 땅, 음수면 물. 해안에서 0 */
export function nycLand(s: number, t: number): number {
  const nj = Math.min(-27 - t, s + 100); // 허드슨 강 서쪽 뉴저지
  const edge = s < 48 ? 20 : 20 - Math.min(1, (s - 48) / 14) * 5;
  const brooklyn = Math.min(t - edge, s + 92 - Math.max(0, t - 40) * 0.25); // 이스트 강 건너 브루클린·퀸스
  const bronx = Math.min(s - 104, t + 12); // 할렘 강 건너 브롱크스
  const liberty = LIBERTY.r - Math.hypot(s - LIBERTY.s, t - LIBERTY.t);
  return Math.max(manhattan(s, t), nj, brooklyn, bronx, liberty);
}

export function nycHeight(e: number, n: number, real: number, d: number): number {
  const { s, t } = st(e, n);
  const land = nycLand(s, t);
  let h: number;
  if (land >= 0) {
    h = 0.22 + (STREET_Y - 0.22) * smooth(0, 1.4, land);
    // 맨해튼 밖의 땅은 살짝 굽이친다
    if (manhattan(s, t) < 1.4) h += Math.max(0, noise3(e / (23 * K), n / (23 * K), 3.1)) * 0.6 * smooth(3, 12, land);
  } else {
    const depth = -2.6 - smooth(-45, -110, s) * 5.5;
    h = 0.22 + (depth - 0.22) * smooth(0, 2.4, -land);
  }
  const w = smooth(NYC_RADIUS, BLEND_END, d);
  return h + (real - h) * w;
}

/** 길·보도·공원 색 (선형 RGB) */
export function nycColor(e: number, n: number, d: number, out: number[]): boolean {
  if (d > BLEND_END) return false;
  const { s, t } = st(e, n);
  const land = nycLand(s, t);
  if (land < 0.2) return false;
  const inPark = s > PARK.s0 && s < PARK.s1 && t > PARK.t0 - 1 && t < PARK.t1 + 1 && manhattan(s, t) > 0;
  const k = 1 - smooth(NYC_RADIUS, BLEND_END, d);
  let r: number, g: number, b: number;
  if (inPark) { r = 0.07; g = 0.16; b = 0.045; }
  else if (Math.hypot(s - LIBERTY.s, t - LIBERTY.t) < LIBERTY.r) { r = 0.16; g = 0.24; b = 0.09; }
  else if (manhattan(s, t) > 0) { r = g = b = 0.045; }
  else { r = 0.085; g = 0.085; b = 0.078; }
  out[0] += (r - out[0]) * k; out[1] += (g - out[1]) * k; out[2] += (b - out[2]) * k;
  return true;
}

// ---- 건물 ----
function mulberry(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 창문 격자 텍스처 (낮)와 불 켜진 창문 텍스처 (밤) */
function facadeTextures(): { day: THREE.CanvasTexture; night: THREE.CanvasTexture } {
  const make = (lit: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = lit ? '#000' : '#d9d6cf';
    g.fillRect(0, 0, 128, 128);
    const rnd = mulberry(lit ? 99 : 7);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      if (lit) {
        if (rnd() < 0.42) { g.fillStyle = rnd() < 0.8 ? '#ffd9a0' : '#cfe4ff'; g.fillRect(i * 16 + 3, j * 16 + 4, 10, 9); }
      } else {
        g.fillStyle = rnd() < 0.15 ? '#5d6670' : '#3d4651';
        g.fillRect(i * 16 + 3, j * 16 + 4, 10, 9);
      }
    }
    if (!lit) { g.fillStyle = '#d9d6cf'; g.fillRect(0, 124, 4, 4); } // 지붕용 단색 픽셀
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  return { day: make(false), night: make(true) };
}

interface Box { s: number; t: number; ls: number; lt: number; h: number; y0?: number; color: THREE.Color; windows?: boolean; taper?: number }

/** 창문 UV가 크기에 맞게 반복되는 상자 (지역 좌표: x=t, z=-s 방향은 호출 쪽에서 돌린다) */
function boxGeometry(w: number, h: number, d: number, windows: boolean, taper = 1): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position, uv = geo.attributes.uv, nor = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i);
    if (Math.abs(ny) > 0.5 || !windows) uv.setXY(i, 0.01, 0.01);
    else {
      const along = Math.abs(nx) > 0.5 ? z : x;
      uv.setXY(i, (along + 500) / 24, (y + h / 2) / 28);
    }
    if (taper !== 1 && y > 0) pos.setXYZ(i, x * taper, y, z * taper);
  }
  geo.translate(0, h / 2, 0);
  return geo;
}

export class NewYork {
  readonly group = new THREE.Group();
  readonly obstacles: WorldObstacle[] = [];
  readonly plane = new TangentPlane(NYC.lat, NYC.lon);
  readonly material: THREE.MeshLambertMaterial;
  private readonly people: { mesh: THREE.InstancedMesh; walkers: { s: number; t: number; ds: number; dt: number; len: number; phase: number; speed: number }[] };
  private readonly cars: { mesh: THREE.InstancedMesh; list: { t: number; s: number; dir: number; speed: number }[] };
  private readonly frame = new THREE.Matrix4();
  private readonly dummy = new THREE.Object3D();
  private readonly glow: THREE.MeshBasicMaterial;
  /** 카메라가 파고들지 않게 막는 건물 메시 */
  buildings: THREE.Mesh | null = null;

  constructor() {
    this.frame.makeBasis(this.plane.east, this.plane.up, this.plane.north.clone().negate());
    this.frame.setPosition(this.plane.up.clone().multiplyScalar(RADIUS));
    const tex = facadeTextures();
    this.material = new THREE.MeshLambertMaterial({ map: tex.day, vertexColors: true, emissiveMap: tex.night, emissive: '#ffffff', emissiveIntensity: 0 });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

    const boxes = this.layout();
    this.buildBoxes(boxes);
    this.buildLandmarks();
    this.buildPark();
    this.people = this.buildPeople();
    this.cars = this.buildCars();
  }

  /** 섬 좌표 (s, t, 높이) → 지역 좌표 (x=동, y, z=남) */
  private localXYZ(s: number, t: number, y: number, out: THREE.Vector3) {
    const p = en(s, t);
    // 접평면에서 구면으로: 가운데에서 멀수록 곡률만큼 내려간다
    const drop = (p.e * p.e + p.n * p.n) / (2 * RADIUS);
    return out.set(p.e, y - drop, -p.n);
  }

  /** 섬 좌표의 행성 위치 */
  worldAt(s: number, t: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    const p = en(s, t);
    return this.plane.dir(p.e, p.n, out).multiplyScalar(RADIUS + y);
  }

  private axisT(): THREE.Vector3 {
    return this.plane.east.clone().multiplyScalar(DT.e).addScaledVector(this.plane.north, DT.n).normalize();
  }

  private layout(): Box[] {
    const rnd = mulberry(4242);
    const out: Box[] = [];
    const palette = ['#c9c1b2', '#a5674f', '#8f9aa5', '#d8d2c4', '#6f7c88', '#b9a58a', '#5e6b74', '#a8b4bd'].map(c => new THREE.Color(c));
    const reserved = (s0: number, s1: number, t0: number, t1: number) =>
      (s1 > PARK.s0 && s0 < PARK.s1 && t1 > PARK.t0 && t0 < PARK.t1) ||
      (s1 > TIMES_SQ.s0 && s0 < TIMES_SQ.s1 && t1 > TIMES_SQ.t0 && t0 < TIMES_SQ.t1) ||
      (s0 >= -10 && s1 <= -5 && t0 >= 1 && t1 <= 5) || // 엠파이어 스테이트
      (s0 >= -5 && s1 <= 0 && t0 >= 7 && t1 <= 11) || // 크라이슬러
      (s0 >= -45 && s1 <= -35 && t0 >= -11 && t1 <= -7); // 원 월드 트레이드 센터
    // 맨해튼: 남북 거리 5칸, 애비뉴 6칸 간격
    for (let s0 = S_SOUTH + 1; s0 + ST_PITCH - ROAD <= S_NORTH - 1; s0 += ST_PITCH) {
      for (let t0 = -HALF_W + 1.5; t0 + AVE_PITCH - ROAD <= HALF_W - 0.5; t0 += AVE_PITCH) {
        const s1 = s0 + ST_PITCH - ROAD, t1 = t0 + AVE_PITCH - ROAD;
        if (manhattan(s0, t0) < 0.8 || manhattan(s1, t1) < 0.8 || manhattan(s0, t1) < 0.8 || manhattan(s1, t0) < 0.8) continue;
        if (reserved(s0, s1, t0, t1)) continue;
        const sm = (s0 + s1) / 2;
        const tall = 3 + 17 * Math.exp(-(((sm + 3) / 15) ** 2)) + 19 * Math.exp(-(((sm + 39) / 7) ** 2)) + 3 * smooth(40, 70, sm);
        // 한 블록을 건물 두 채로 나눈다
        const split = 1.6 + rnd() * 0.8;
        for (const [a, b] of [[t0, t0 + split], [t0 + split, t1]]) {
          const h = Math.max(1.6, tall * (0.45 + rnd() * 0.85));
          out.push({ s: sm, t: (a + b) / 2, ls: s1 - s0 - 0.1, lt: b - a - 0.1, h, color: palette[Math.floor(rnd() * palette.length)], windows: true });
          if (h > 10 && rnd() < 0.5) {
            // 꼭대기를 줄여 올린 셋백
            out.push({ s: sm, t: (a + b) / 2, ls: (s1 - s0) * 0.6, lt: (b - a) * 0.6, h: h * (0.25 + rnd() * 0.2), y0: h, color: out[out.length - 1].color, windows: true });
          }
        }
        // 블록 보도 (올라설 수 있는 낮은 단)
        out.push({ s: sm, t: (t0 + t1) / 2, ls: s1 - s0 + 0.5, lt: t1 - t0 + 0.5, h: 0.15 / V, color: new THREE.Color('#9d9a93') });
      }
    }
    // 브루클린·퀸스·뉴저지·브롱크스: 낮은 건물이 늘어선 동네
    for (let s = -95; s < 130; s += 6) {
      for (let t = -90; t < 90; t += 6) {
        const p = en(s, t);
        const d = Math.hypot(p.e, p.n);
        if (d > NYC_RADIUS - 25 * K || manhattan(s, t) > -3) continue;
        const land = Math.min(nycLand(s - 2, t - 2), nycLand(s + 2, t + 2), nycLand(s - 2, t + 2), nycLand(s + 2, t - 2));
        if (land < 1.2 || rnd() < 0.18) continue;
        const near = Math.min(Math.abs(t + 27), Math.abs(t - 20));
        const h = 1.2 + rnd() * 2.6 + (near < 12 && s < 10 && s > -50 ? rnd() * 9 : 0);
        out.push({ s, t, ls: 3.4 + rnd(), lt: 3.4 + rnd(), h, color: palette[Math.floor(rnd() * palette.length)], windows: true });
      }
    }
    return out;
  }

  private buildBoxes(boxes: Box[]) {
    const geos: THREE.BufferGeometry[] = [];
    const v = new THREE.Vector3();
    const rot = new THREE.Matrix4().makeRotationY(-(Math.PI / 2 - ANG)); // 상자 x축 → 가로(t) 방향
    const axis = this.axisT();
    for (const b of boxes) {
      const g = boxGeometry(b.lt * K, b.h * V, b.ls * K, !!b.windows, b.taper);
      g.applyMatrix4(rot);
      this.localXYZ(b.s, b.t, STREET_Y + (b.y0 ?? 0) * V, v);
      g.translate(v.x, v.y, v.z);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = b.color.r; col[i * 3 + 1] = b.color.g; col[i * 3 + 2] = b.color.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(g);
      if (!b.y0) {
        this.obstacles.push({
          p: this.worldAt(b.s, b.t, STREET_Y, new THREE.Vector3()), r: 0,
          box: { hx: b.lt / 2 * K, hz: b.ls / 2 * K, axis }, height: b.h * V, walkable: true,
        });
      }
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos), this.material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this.frame);
    this.group.add(mesh);
    this.buildings = mesh;
  }

  /** 카메라 위치가 도시 근처인가 */
  near(p: THREE.Vector3): boolean {
    return this.plane.local(p).d < NYC_RADIUS;
  }

  /** 섬 좌표 (s, t)에 지역 y-up 모델을 세운다. 모델의 -z가 섬의 북쪽(s)을 향한다 */
  private place(obj: THREE.Object3D, s: number, t: number, y = STREET_Y, turn = 0) {
    // 모델은 도시 좌표 단위로 만들었으므로 가로 K, 세로 V배로 키운다
    const scaler = new THREE.Group();
    this.localXYZ(s, t, y, scaler.position);
    scaler.rotation.y = -ANG + turn;
    scaler.scale.set(K, V, K);
    scaler.add(obj);
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(this.frame);
    holder.add(scaler);
    this.group.add(holder);
  }

  private solid(s: number, t: number, ls: number, lt: number, h: number, y = STREET_Y) {
    this.obstacles.push({ p: this.worldAt(s, t, y, new THREE.Vector3()), r: 0, box: { hx: lt / 2 * K, hz: ls / 2 * K, axis: this.axisT() }, height: h * V, walkable: true });
  }

  private buildLandmarks() {
    const lam = (c: string) => new THREE.MeshLambertMaterial({ color: c });
    const stone = lam('#cdc5b4'), steel = lam('#b8c0c8'), glass = lam('#6f8aa0'), copper = lam('#6fa58f'), granite = lam('#9a948a');
    const add = (g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); g.add(mesh); return mesh;
    };

    // 엠파이어 스테이트 빌딩: 34번가, 셋백과 첨탑 (443m ≈ 37칸)
    const esb = new THREE.Group();
    add(esb, new THREE.BoxGeometry(4.6, 6, 3.6), stone, 0, 3, 0);
    add(esb, new THREE.BoxGeometry(3.4, 20, 2.6), stone, 0, 16, 0);
    add(esb, new THREE.BoxGeometry(2.6, 5, 2), stone, 0, 28.5, 0);
    add(esb, new THREE.BoxGeometry(1.7, 2.2, 1.4), stone, 0, 32, 0);
    add(esb, new THREE.CylinderGeometry(0.45, 0.6, 2, 8), steel, 0, 34.1, 0);
    add(esb, new THREE.CylinderGeometry(0.06, 0.2, 3.6, 6), steel, 0, 36.9, 0);
    this.place(esb, -7.5, 3);
    this.solid(-7.5, 3, 3.6, 4.6, 33);

    // 크라이슬러 빌딩: 은빛 왕관
    const chrysler = new THREE.Group();
    add(chrysler, new THREE.BoxGeometry(3.2, 8, 3.2), lam('#bdb6a8'), 0, 4, 0);
    add(chrysler, new THREE.BoxGeometry(2.4, 13, 2.4), lam('#bdb6a8'), 0, 14.5, 0);
    for (let i = 0; i < 5; i++) {
      const r = 1.3 - i * 0.25;
      add(chrysler, new THREE.CylinderGeometry(r * 0.75, r, 1.2, 4, 1), steel, 0, 21.6 + i * 1.15, 0).rotation.y = Math.PI / 4;
    }
    add(chrysler, new THREE.ConeGeometry(0.2, 3.2, 6), steel, 0, 28.6, 0);
    this.place(chrysler, -2.5, 9);
    this.solid(-2.5, 9, 3.2, 3.2, 21);

    // 원 월드 트레이드 센터: 위로 갈수록 비틀려 가늘어지는 유리 탑 (541m ≈ 45칸)
    const wtc = new THREE.Group();
    add(wtc, new THREE.BoxGeometry(4.2, 4, 4.2), glass, 0, 2, 0);
    const shaft = new THREE.CylinderGeometry(1.45, 2.95, 30, 4, 1);
    shaft.rotateY(Math.PI / 4);
    const pos = shaft.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) { const x = pos.getX(i), z = pos.getZ(i); const a = Math.PI / 4; pos.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), pos.getY(i), x * Math.sin(a) + z * Math.cos(a)); }
    }
    shaft.computeVertexNormals();
    add(wtc, shaft, lam('#7e9bb3'), 0, 19, 0);
    add(wtc, new THREE.BoxGeometry(2.1, 1.2, 2.1), steel, 0, 34.6, 0).rotation.y = Math.PI / 4;
    add(wtc, new THREE.CylinderGeometry(0.06, 0.22, 10, 6), steel, 0, 40.2, 0);
    this.place(wtc, -40, -9);
    this.solid(-40, -9, 4.2, 4.2, 34);

    // 자유의 여신상: 별 모양 요새 위의 받침대와 구리빛 여신 (93m ≈ 8칸)
    const lady = new THREE.Group();
    const fort = new THREE.CylinderGeometry(2.3, 2.4, 0.7, 11);
    add(lady, fort, granite, 0, 0.35, 0);
    add(lady, new THREE.BoxGeometry(1.7, 2.6, 1.7), granite, 0, 2, 0);
    add(lady, new THREE.BoxGeometry(1.25, 0.5, 1.25), granite, 0, 3.55, 0);
    add(lady, new THREE.CylinderGeometry(0.32, 0.55, 2.6, 10), copper, 0, 5.1, 0);
    add(lady, new THREE.SphereGeometry(0.24, 12, 10), copper, 0, 6.6, 0);
    for (let i = 0; i < 7; i++) {
      const spike = add(lady, new THREE.ConeGeometry(0.04, 0.32, 4), copper, 0, 6.75, 0);
      const a = (i / 6 - 0.5) * Math.PI * 0.9;
      spike.position.set(Math.sin(a) * 0.24, 6.78, -Math.cos(a) * 0.24 + 0.05);
      spike.rotation.set(-Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
    }
    const arm = add(lady, new THREE.CylinderGeometry(0.07, 0.09, 1.3, 6), copper, 0.28, 6.7, 0);
    arm.rotation.z = -0.25;
    add(lady, new THREE.CylinderGeometry(0.1, 0.06, 0.25, 8), lam('#c9a54a'), 0.44, 7.45, 0);
    const flame = add(lady, new THREE.ConeGeometry(0.09, 0.28, 8), new THREE.MeshBasicMaterial({ color: '#ffcf6a' }), 0.44, 7.7, 0);
    flame.name = 'flame';
    add(lady, new THREE.BoxGeometry(0.16, 0.28, 0.06), copper, -0.3, 5.9, -0.18); // 독립선언서 서판
    this.place(lady, LIBERTY.s, LIBERTY.t, 0.5, Math.PI * 0.75);
    this.obstacles.push({ p: this.worldAt(LIBERTY.s, LIBERTY.t, 0.5, new THREE.Vector3()), r: 2.35 * K, height: 0.7 * V, walkable: true });
    this.obstacles.push({ p: this.worldAt(LIBERTY.s, LIBERTY.t, 0.5, new THREE.Vector3()), r: 1.1 * K, height: 3.8 * V, walkable: true });

    // 타임스스퀘어: 빛나는 전광판 (글자 없는 색면)
    const boards = new THREE.Group();
    const colors = ['#ff3d6e', '#3dd3ff', '#ffd23d', '#7dff6a', '#b86bff', '#ff8a3d'];
    const geos: THREE.BufferGeometry[] = [];
    const rnd = mulberry(55);
    for (let i = 0; i < 16; i++) {
      const g = new THREE.PlaneGeometry(1.2 + rnd() * 1.4, 0.9 + rnd() * 1.6);
      const side = i % 2 === 0 ? 1 : -1;
      g.rotateY(side > 0 ? -Math.PI / 2 : Math.PI / 2);
      g.translate(side * 2.15, 2.2 + rnd() * 5, -1.4 + (i >> 1) * 0.42);
      const c = new THREE.Color(colors[i % colors.length]);
      const col = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < col.length; k += 3) { col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(g);
    }
    boards.add(new THREE.Mesh(mergeGeometries(geos), this.glow));
    this.place(boards, (TIMES_SQ.s0 + TIMES_SQ.s1) / 2, (TIMES_SQ.t0 + TIMES_SQ.t1) / 2);
  }

  private buildPark() {
    const rnd = mulberry(77);
    const trunk = new THREE.CylinderGeometry(0.08, 0.12, 0.9, 5).translate(0, 0.45, 0).toNonIndexed();
    const crown = new THREE.IcosahedronGeometry(0.75, 0).translate(0, 1.35, 0);
    const pos = trunk.attributes.position.count, cpos = crown.attributes.position.count;
    const paint = (g: THREE.BufferGeometry, c: string, n: number) => {
      const col = new THREE.Color(c), arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    };
    paint(trunk, '#5a4632', pos); paint(crown, '#3f6b2e', cpos);
    const tree = mergeGeometries([trunk, crown]);
    const spots: { s: number; t: number }[] = [];
    for (let s = PARK.s0 + 0.8; s < PARK.s1 - 0.8; s += 1.6) {
      for (let t = PARK.t0 + 0.6; t < PARK.t1 - 0.6; t += 1.6) {
        const js = s + (rnd() - 0.5) * 1.1, jt = t + (rnd() - 0.5) * 1.1;
        const lake = Math.hypot((js - 30) / 4, (jt + 0.5) / 2.6) < 1; // 저수지 자리는 비워 둔다
        if (rnd() < 0.42 && !lake && Math.abs(jt) > 0.9) spots.push({ s: js, t: jt });
      }
    }
    const mesh = new THREE.InstancedMesh(tree, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length);
    const v = new THREE.Vector3();
    spots.forEach((p, i) => {
      this.localXYZ(p.s, p.t, STREET_Y, v);
      this.dummy.position.copy(v);
      this.dummy.rotation.set(0, rnd() * 6.28, 0);
      this.dummy.scale.setScalar((0.8 + rnd() * 0.6) * 8);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.obstacles.push({ p: this.worldAt(p.s, p.t, STREET_Y, new THREE.Vector3()), r: 1.2, height: 16, walkable: false });
    });
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this.frame);
    this.group.add(mesh);
    // 저수지
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshLambertMaterial({ color: '#2d5a74' }));
    pond.rotation.x = -Math.PI / 2;
    pond.scale.set(2.6, 4, 1);
    this.place(pond, 30, -0.5, STREET_Y + 0.03);
  }

  /** 보도를 오가는 큐브 사람들 */
  private buildPeople() {
    const rnd = mulberry(31);
    // 사람 = 주인공처럼 1m 큐브
    const body = new RoundedBoxGeometry(1, 1, 1, 2, 0.15).translate(0, 0.5, 0);
    const eye = new THREE.SphereGeometry(0.075, 6, 5);
    const eyes = mergeGeometries([eye.clone().translate(-0.2, 0.58, 0.502), eye.clone().translate(0.2, 0.58, 0.502)]).toNonIndexed();
    const col = new Float32Array(body.attributes.position.count * 3).fill(1);
    body.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const ecol = new Float32Array(eyes.attributes.position.count * 3).fill(-1);
    eyes.setAttribute('color', new THREE.BufferAttribute(ecol, 3));
    // 눈은 인스턴스 색과 상관없이 검게: 정점 색 -1을 셰이더에서 검정으로 바꾼다
    const geo = mergeGeometries([body, eyes]);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if (vColor.r < 0.0) diffuseColor.rgb = vec3(0.06, 0.06, 0.08);`);
      sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
        if (color.r < 0.0) vColor.rgb = vec3(-1.0);`);
    };
    const walkers: { s: number; t: number; ds: number; dt: number; len: number; phase: number; speed: number }[] = [];
    const shirt = ['#e8b48a', '#7fb3d5', '#e57373', '#9ccc65', '#ffd54f', '#ba68c8', '#4db6ac', '#f5f5f5', '#455a64', '#ff8a65'];
    const count = 320;
    while (walkers.length < count) {
      const alongAve = rnd() < 0.6;
      let s: number, t: number;
      if (alongAve) {
        const k = Math.floor(rnd() * 5);
        t = -HALF_W + 1.5 - ROAD / 2 + k * AVE_PITCH + (rnd() < 0.5 ? -0.75 : 0.75);
        s = S_SOUTH + 6 + rnd() * (S_NORTH - S_SOUTH - 12);
      } else {
        const k = Math.floor(rnd() * 28);
        s = S_SOUTH + 1 - ROAD / 2 + k * ST_PITCH + (rnd() < 0.5 ? -0.75 : 0.75);
        t = -10 + rnd() * 20;
      }
      if (manhattan(s, t) < 1.5) continue;
      if (s > PARK.s0 && s < PARK.s1 && Math.abs(t) < 5) continue;
      walkers.push({ s, t, ds: alongAve ? 1 : 0, dt: alongAve ? 0 : 1, len: 3 + rnd() * 9, phase: rnd() * 100, speed: (1.1 + rnd() * 0.6) / K });
    }
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const c = new THREE.Color();
    walkers.forEach((_, i) => mesh.setColorAt(i, c.set(shirt[i % shirt.length])));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this.frame);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, walkers };
  }

  /** 애비뉴를 달리는 노란 택시와 차들 */
  private buildCars() {
    const rnd = mulberry(91);
    // 실제 크기의 차 (길이 약 4.5m)
    const geo = new THREE.BoxGeometry(1.85, 1.0, 4.5).translate(0, 0.75, 0);
    const cabin = new THREE.BoxGeometry(1.7, 0.75, 2.3).translate(0, 1.6, 0.2);
    const car = mergeGeometries([geo, cabin]);
    const mesh = new THREE.InstancedMesh(car, new THREE.MeshLambertMaterial(), 90);
    const list: { t: number; s: number; dir: number; speed: number }[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < 90; i++) {
      const k = Math.floor(rnd() * 5);
      const dir = k % 2 === 0 ? 1 : -1; // 일방통행
      list.push({ t: -HALF_W + 1.5 - ROAD / 2 + k * AVE_PITCH + dir * 0.4, s: S_SOUTH + rnd() * (S_NORTH - S_SOUTH), dir, speed: (9 + rnd() * 6) / K });
      mesh.setColorAt(i, c.set(rnd() < 0.55 ? '#f4c20d' : ['#e0e0e0', '#2b2f36', '#8a1c1c', '#30475e'][Math.floor(rnd() * 4)]));
    }
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this.frame);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, list };
  }

  /** 섬 좌표로 지역 위치를 정하고 바라보는 방향(섬 기준)으로 돌린다 */
  private pose(s: number, t: number, y: number, heading: number, scale = 1) {
    this.localXYZ(s, t, y, this.dummy.position);
    this.dummy.rotation.set(0, -ANG + heading, 0);
    this.dummy.scale.setScalar(scale);
    this.dummy.updateMatrix();
    return this.dummy.matrix;
  }

  update(camera: THREE.Vector3, time: number, night: number) {
    const d = this.plane.local(camera).d;
    this.group.visible = d < 3000;
    this.material.emissiveIntensity = night * 0.9;
    if (d > 400) return;
    const { mesh, walkers } = this.people;
    walkers.forEach((w, i) => {
      // 왕복 걷기: 삼각파로 오가고 돌아설 때 방향을 바꾼다
      const u = (time * w.speed / w.len + w.phase) % 2;
      const k = u < 1 ? u : 2 - u;
      const off = (k - 0.5) * w.len;
      const s = w.s + w.ds * off, t = w.t + w.dt * off;
      const forward = u < 1 ? 1 : -1;
      const heading = w.ds ? (forward > 0 ? Math.PI : 0) : (forward > 0 ? -Math.PI / 2 : Math.PI / 2);
      const hop = Math.abs(Math.sin(time * 7 + w.phase)) * 0.08;
      mesh.setMatrixAt(i, this.pose(s, t, STREET_Y + hop, heading));
    });
    mesh.instanceMatrix.needsUpdate = true;
    const cars = this.cars;
    cars.list.forEach((c, i) => {
      const span = S_NORTH - S_SOUTH - 4;
      const s = S_SOUTH + 2 + ((((c.s - S_SOUTH) + time * c.speed * c.dir) % span) + span) % span;
      cars.mesh.setMatrixAt(i, this.pose(s, c.t, STREET_Y, c.dir > 0 ? Math.PI : 0));
    });
    cars.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 시작 지점: 타임스스퀘어 옆 교차로 */
  spawn(out = new THREE.Vector3()): THREE.Vector3 {
    const p = en(TIMES_SQ.s0 - 1, 0);
    return this.plane.dir(p.e, p.n, out);
  }

  shaper(): TerrainShaper {
    return {
      plane: this.plane,
      radius: BLEND_END,
      apply: (h, e, n, d) => nycHeight(e, n, h, d),
      color: (e, n, d, out) => nycColor(e, n, d, out),
    };
  }
}
