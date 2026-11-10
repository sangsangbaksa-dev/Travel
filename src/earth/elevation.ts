import * as THREE from 'three';
import { dirFromLatLon, METERS_PER_HEIGHT, RADIUS, TangentPlane } from './geo';
import { fbm3, noise3, ridged3 } from './noise3';

// 실제 지구 고도(NOAA ETOPO1, 10분 간격) + 그 사이를 메우는 3D 노이즈 + 랜드마크 지형.
// 높이 단위는 "칸"이고 0이 해수면이다. 물리와 렌더링이 모두 이 함수 하나를 쓴다.

export interface ElevationGrid {
  w: number;
  h: number;
  /** 남→북, 서→동 순서의 고도(m). 마지막 열은 첫 열(±180°)과 같다 */
  meters: Int16Array;
}

/** scripts/earth-data.py가 만든 elevation.bin을 해석한다. inflate는 zlib 압축을 푸는 함수 */
export async function decodeElevation(
  bytes: Uint8Array,
  inflate: (data: Uint8Array) => Promise<Uint8Array> | Uint8Array,
): Promise<ElevationGrid> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'ETP1') throw new Error('elevation.bin 형식이 아닙니다');
  const w = view.getUint16(4, true), h = view.getUint16(6, true);
  const qLand = view.getUint16(8, true), qSea = view.getUint16(10, true);
  const raw = await inflate(bytes.subarray(12));
  const resid = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + w * h * 2));
  const code = new Int32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let p = 0;
      if (i > 0 && j > 0) p = code[k - 1] + code[k - w] - code[k - w - 1];
      else if (i > 0) p = code[k - 1];
      else if (j > 0) p = code[k - w];
      code[k] = resid[k] + p;
    }
  }
  const meters = new Int16Array(w * h);
  for (let k = 0; k < w * h; k++) meters[k] = code[k] >= 0 ? code[k] * qLand : code[k] * qSea;
  return { w, h, meters };
}

/** 랜드마크 주변 지형을 고치는 함수. e, n은 중심의 접평면 좌표(칸) */
export interface TerrainShaper {
  plane: TangentPlane;
  /** 이 거리(칸) 밖에서는 영향이 없다 */
  radius: number;
  apply(h: number, e: number, n: number, d: number): number;
  /** 지면 색을 덮어쓴다 (선형 RGB). 손댔으면 true */
  color?(e: number, n: number, d: number, out: number[]): boolean;
}

interface Feature { lat: number; lon: number; meters: number; radius: number; cone?: boolean }

/** 10분 격자에서는 뭉개지는 유명한 봉우리와 해구를 실제 높이로 되살린다 */
export const FEATURES: Feature[] = [
  { lat: 27.9881, lon: 86.925, meters: 8849, radius: 9 }, // 에베레스트
  { lat: 27.9617, lon: 86.9333, meters: 8516, radius: 4 }, // 로체
  { lat: 27.8856, lon: 87.0886, meters: 8485, radius: 4 }, // 마칼루
  { lat: 35.8825, lon: 76.5133, meters: 8611, radius: 6 }, // K2
  { lat: 11.3733, lon: 142.5917, meters: -10935, radius: 10 }, // 챌린저 해연
  { lat: 35.3606, lon: 138.7274, meters: 3776, radius: 28, cone: true }, // 후지산. 높이 과장 아래에서도 약 32° 원뿔
  { lat: -3.0674, lon: 37.3556, meters: 5895, radius: 43, cone: true }, // 킬리만자로. 후지산과 같은 경사
  { lat: 45.8326, lon: 6.8652, meters: 4806, radius: 6 }, // 몽블랑
  { lat: 63.0695, lon: -151.007, meters: 6190, radius: 8 }, // 데날리
  { lat: -32.6532, lon: -70.0109, meters: 6961, radius: 8 }, // 아콩카과
];

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

function cubic(p0: number, p1: number, p2: number, p3: number, t: number) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

export class Elevation {
  private readonly shapers: TerrainShaper[] = [];
  private readonly features: { dir: THREE.Vector3; cos: number; target: number; radius: number; cone: boolean }[] = [];

  constructor(readonly grid: ElevationGrid) {
    for (const f of FEATURES) {
      const dir = dirFromLatLon(f.lat, f.lon);
      const reach = f.radius * 3;
      this.features.push({
        dir, cos: Math.cos(reach / RADIUS), target: f.meters / METERS_PER_HEIGHT, radius: f.radius, cone: !!f.cone,
      });
    }
  }

  addShaper(s: TerrainShaper) { this.shapers.push(s); }

  /** 격자 고도(m), 쌍삼차 보간 */
  baseMeters(lat: number, lon: number): number {
    const { w, h, meters } = this.grid;
    const fx = ((lon + 180) / 360) * (w - 1);
    const fy = ((lat + 90) / 180) * (h - 1);
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const cols = w - 1;
    const row = (j: number) => Math.min(h - 1, Math.max(0, j)) * w;
    const col = (i: number) => ((i % cols) + cols) % cols;
    const r = [0, 0, 0, 0];
    for (let m = -1; m <= 2; m++) {
      const o = row(iy + m);
      r[m + 1] = cubic(meters[o + col(ix - 1)], meters[o + col(ix)], meters[o + col(ix + 1)], meters[o + col(ix + 2)], tx);
    }
    return cubic(r[0], r[1], r[2], r[3], ty);
  }

  /** 단위 방향 (x, y, z)의 지면 높이(칸, 해수면 0) */
  height(x: number, y: number, z: number): number {
    const lat = Math.asin(Math.max(-1, Math.min(1, y))) * 57.29577951308232;
    const lon = Math.atan2(-z, x) * 57.29577951308232;
    let h = this.baseMeters(lat, lon) / METERS_PER_HEIGHT;

    // 격자 사이를 메우는 디테일. 해안선은 실제 데이터가 정하도록 해안 근처에서는 줄인다.
    const px = x * RADIUS, py = y * RADIUS, pz = z * RADIUS;
    const coast = smooth(0.15, 2.5, Math.abs(h));
    if (h > 0) {
      const mountain = smooth(4, 30, h);
      const ridge = ridged3(px / 16, py / 16, pz / 16, 3);
      h += (ridge - 0.45) * (1.2 + 13 * mountain) * coast;
      h += fbm3(px / 5, py / 5, pz / 5, 2) * (0.25 + 0.6 * mountain) * coast;
      h += noise3(px / 1.3, py / 1.3, pz / 1.3) * 0.06;
    } else {
      h += fbm3(px / 28, py / 28, pz / 28, 3) * 2.2 * coast;
      h += noise3(px / 4, py / 4, pz / 4) * 0.2 * coast;
    }

    // 이름난 봉우리/해구: 가까울수록 실제 높이로 끌어당긴다 (겹쳐도 더해지지 않는다)
    for (const f of this.features) {
      const c = f.dir.x * x + f.dir.y * y + f.dir.z * z;
      if (c < f.cos) continue;
      const d = Math.acos(Math.min(1, c)) * RADIUS;
      const g = f.cone ? Math.pow(Math.max(0, 1 - d / (f.radius * 2.2)), 1.7) : Math.exp(-(d * d) / (f.radius * f.radius));
      h += (f.target - h) * g;
    }

    for (const s of this.shapers) {
      const k = s.plane.up.x * x + s.plane.up.y * y + s.plane.up.z * z;
      if (k <= 0) continue;
      const sc = RADIUS / k;
      const e = (s.plane.east.x * x + s.plane.east.y * y + s.plane.east.z * z) * sc;
      const n = (s.plane.north.x * x + s.plane.north.y * y + s.plane.north.z * z) * sc;
      const d = Math.hypot(e, n);
      if (d < s.radius) h = s.apply(h, e, n, d);
    }
    return h;
  }

  /** 랜드마크가 정한 지면 색을 out에 섞는다 */
  shapeColor(x: number, y: number, z: number, out: number[]) {
    for (const s of this.shapers) {
      if (!s.color) continue;
      const k = s.plane.up.x * x + s.plane.up.y * y + s.plane.up.z * z;
      if (k <= 0) continue;
      const sc = RADIUS / k;
      const e = (s.plane.east.x * x + s.plane.east.y * y + s.plane.east.z * z) * sc;
      const n = (s.plane.north.x * x + s.plane.north.y * y + s.plane.north.z * z) * sc;
      const d = Math.hypot(e, n);
      if (d < s.radius) s.color(e, n, d, out);
    }
  }

  heightAt(v: THREE.Vector3): number {
    const l = v.length();
    return this.height(v.x / l, v.y / l, v.z / l);
  }
}
