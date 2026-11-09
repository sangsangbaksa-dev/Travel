// 시드 기반 2D 그래디언트 노이즈 + fBm. 물리와 렌더가 같은 함수를 공유한다.

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(ix: number, iz: number, fx: number, fz: number, seed: number): number {
  const a = hash2(ix, iz, seed) * Math.PI * 2;
  return Math.cos(a) * fx + Math.sin(a) * fz;
}

export function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const n00 = grad(ix, iz, fx, fz, seed);
  const n10 = grad(ix + 1, iz, fx - 1, fz, seed);
  const n01 = grad(ix, iz + 1, fx, fz - 1, seed);
  const n11 = grad(ix + 1, iz + 1, fx - 1, fz - 1, seed);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.41; // 대략 [-1, 1]
}

export const WATER_LEVEL = -2.5;

export interface Terrain {
  height(x: number, z: number): number;
  /** 수면 높이. 없으면 물이 없는 지형 */
  waterLevel?: number;
}

export function createTerrain(seed = 1337): Terrain {
  return {
    waterLevel: WATER_LEVEL,
    height(x: number, z: number): number {
      // 큰 언덕 + 중간 굴곡 + 잔잔한 결
      const big = noise2(x * 0.012, z * 0.012, seed) * 14;
      const mid = noise2(x * 0.045, z * 0.045, seed + 1) * 4;
      const fine = noise2(x * 0.15, z * 0.15, seed + 2) * 0.35;
      // 시작 지점 근처는 완만하게 (스폰 안전지대)
      const d = Math.hypot(x, z);
      const calm = Math.min(1, Math.max(0, (d - 4) / 30));
      const base = big + mid + fine;
      return base * (0.25 + 0.75 * calm);
    },
  };
}

export function surfaceNormal(
  t: Terrain,
  x: number,
  z: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 },
): { x: number; y: number; z: number } {
  const e = 0.3;
  const dx = t.height(x + e, z) - t.height(x - e, z);
  const dz = t.height(x, z + e) - t.height(x, z - e);
  const nx = -dx / (2 * e);
  const nz = -dz / (2 * e);
  const len = Math.hypot(nx, 1, nz);
  out.x = nx / len;
  out.y = 1 / len;
  out.z = nz / len;
  return out;
}
