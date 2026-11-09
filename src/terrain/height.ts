import { climateAt, type Climate } from './biome';
import { noise2 } from './noise';

export { noise2 };

// 월드 지형: 대륙/섬/바다 → 언덕 → 산악 지대 → 강. 모두 (x, z)와 시드만으로 정해진다.
export const WATER_LEVEL = -2.5;
export const OCEAN_FLOOR = -24;

export interface Terrain {
  height(x: number, z: number): number;
  /** 수면 높이. 없으면 물이 없는 지형 */
  waterLevel?: number;
  waterAt?(x: number, z: number): number;
  /** 기후. 없으면 초원으로 취급한다 */
  climate?(x: number, z: number): Climate;
}

export interface TerrainInfo {
  height: number;
  /** 0(바다) ~ 1(내륙) */
  landness: number;
  /** 강이 깎인 정도 0~1 */
  river: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

export function terrainInfo(x: number, z: number, seed = 1337): TerrainInfo {
  const d = Math.hypot(x, z);

  // 1) 대륙과 섬: 낮은 주파수 노이즈 + 시작 지점 주변의 섬
  let cont =
    noise2(x * 0.0022, z * 0.0022, seed + 20) * 1.1 +
    noise2(x * 0.0055, z * 0.0055, seed + 21) * 0.5 +
    noise2(x * 0.014, z * 0.014, seed + 22) * 0.15;
  cont += 0.9 * Math.max(0, 1 - d / 170);
  const landness = smooth(-0.4, 0.0, cont);

  // 2) 언덕 (사막은 부드러운 모래언덕)
  const c = climateAt(x, z, seed);
  const desert = smooth(0.3, 0.8, c.temp) * smooth(0.1, -0.4, c.moist);
  const hillAmp = 1 - 0.55 * desert;
  const big = noise2(x * 0.012, z * 0.012, seed) * 14 * hillAmp;
  const mid = noise2(x * 0.045, z * 0.045, seed + 1) * 4 * (1 - 0.4 * desert);
  const fine = noise2(x * 0.15, z * 0.15, seed + 2) * 0.35;
  const dunes = desert * noise2(x * 0.03 + z * 0.01, z * 0.03, seed + 3) * 2.2;
  const calm = 0.25 + 0.75 * clamp01((d - 4) / 30); // 시작 지점은 완만하게
  // 마법 지대의 독특한 지형: 크리스탈은 뾰족한 둔덕, 버섯 숲은 둥글게 솟은 언덕
  const crystal = c.magic * (1 - c.kind);
  const mush = c.magic * c.kind;
  const ridgeC = clamp01(1 - Math.abs(noise2(x * 0.03, z * 0.03, seed + 70) * 1.4));
  const magical = crystal * ridgeC * ridgeC * 7 + mush * noise2(x * 0.05, z * 0.05, seed + 71) * 3;
  const rolling = (big + mid + fine + dunes + magical) * calm;

  // 3) 산악 지대: 능선이 뾰족하게 솟는다
  const mm = noise2(x * 0.0042, z * 0.0042, seed + 30);
  const mountain = smooth(0.1, 0.5, mm) * smooth(-0.05, 0.3, cont) * smooth(30, 120, d);
  const ridge = clamp01(1 - Math.abs(noise2(x * 0.011, z * 0.011, seed + 31) * 1.4));
  const peaks = mountain * (ridge * ridge * 75 + 4);

  const floor = OCEAN_FLOOR + noise2(x * 0.02, z * 0.02, seed + 23) * 3;
  const land = rolling + peaks + 3.4;
  let h = floor + (land - floor) * landness;

  // 4) 강: 저지대에서만 물길을 깎는다 (수면이 하나라서 높은 곳에는 강이 없다)
  const rv = Math.abs(noise2(x * 0.0065, z * 0.0065, seed + 40) * 1.4);
  const w = 0.06 + 0.045 * (noise2(x * 0.003, z * 0.003, seed + 41) * 0.5 + 0.5);
  const core = 1 - smooth(0, w, rv);
  const mask = core * (1 - smooth(3.5, 10, h)) * smooth(0.45, 0.8, landness) * smooth(22, 55, d);
  const bed = WATER_LEVEL - 1.3 + noise2(x * 0.05, z * 0.05, seed + 42) * 0.25;
  h += (bed - h) * (mask * mask * (3 - 2 * mask));

  return { height: h, landness, river: mask };
}

export function createTerrain(seed = 1337): Terrain {
  return {
    waterLevel: WATER_LEVEL,
    height: (x, z) => terrainInfo(x, z, seed).height,
    climate: (x, z) => climateAt(x, z, seed),
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
