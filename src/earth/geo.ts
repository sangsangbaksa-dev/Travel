import * as THREE from 'three';

// 지구 좌표계: 행성 중심이 원점, +Y가 북극, 위도 0·경도 0이 +X, 동쪽(경도 증가)은 -Z 방향이다.
// 이 모듈은 위경도 ↔ 방향 벡터 변환과 축척만 다루는 순수 함수 모음이다.

/** 걸어서 지구 한 바퀴가 약 1시간 (최고 속도 9 × 3600초 ≈ 둘레) */
export const RADIUS = 5157;
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** 실제 지구 반지름 (m) */
export const EARTH_RADIUS_M = 6_371_000;
/** 수평 1칸이 몇 미터인가 */
export const METERS_PER_UNIT = EARTH_RADIUS_M / RADIUS;
/** 높이 1칸이 몇 미터인가. 산과 바다가 걸어 다니며 느껴지도록 수평보다 과장한다 */
export const METERS_PER_HEIGHT = 100;

const D2R = Math.PI / 180;

export interface LatLon { lat: number; lon: number }

/** 위경도(도) → 단위 방향 벡터 */
export function dirFromLatLon(lat: number, lon: number, out = new THREE.Vector3()): THREE.Vector3 {
  const la = lat * D2R, lo = lon * D2R;
  const c = Math.cos(la);
  return out.set(c * Math.cos(lo), Math.sin(la), -c * Math.sin(lo));
}

/** 방향 벡터(길이 무관) → 위경도(도) */
export function latLonFromDir(x: number, y: number, z: number): LatLon {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / r))) / D2R, lon: Math.atan2(-z, x) / D2R };
}

/** 방향 벡터에서 동쪽/북쪽 단위 벡터. 극점에서는 임의의 직교축을 고른다 */
export function eastNorth(up: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3) {
  east.set(up.z, 0, -up.x); // 경도가 늘어나는 방향 = (0,1,0) × up
  if (east.lengthSq() < 1e-10) east.set(0, 0, -1);
  east.normalize();
  north.crossVectors(up, east).normalize();
}

/** 두 방향 사이의 지표면 거리 (칸) */
export function surfaceDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  const d = a.dot(b) / (a.length() * b.length());
  return Math.acos(Math.max(-1, Math.min(1, d))) * RADIUS;
}

/**
 * 어떤 지점의 접평면 좌표(동쪽 e, 북쪽 n, 칸 단위)를 행성 위의 방향으로 바꾼다.
 * 랜드마크처럼 한 지점 주변을 평면처럼 꾸밀 때 쓴다.
 */
export class TangentPlane {
  readonly up: THREE.Vector3;
  readonly east = new THREE.Vector3();
  readonly north = new THREE.Vector3();

  constructor(readonly lat: number, readonly lon: number) {
    this.up = dirFromLatLon(lat, lon);
    eastNorth(this.up, this.east, this.north);
  }

  /** 접평면 (e, n) → 단위 방향 */
  dir(e: number, n: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.up).multiplyScalar(RADIUS).addScaledVector(this.east, e).addScaledVector(this.north, n).normalize();
  }

  /** 방향(또는 위치) → 접평면 (e, n). 지점의 반대편 반구에서는 의미가 없다 */
  local(p: THREE.Vector3): { e: number; n: number; d: number } {
    const k = p.dot(this.up);
    if (k <= 0) return { e: Infinity, n: Infinity, d: Infinity };
    const s = RADIUS / k; // 접평면으로 투영
    const e = p.dot(this.east) * s, n = p.dot(this.north) * s;
    return { e, n, d: Math.hypot(e, n) };
  }
}
