import { noise2 } from './noise';

// 기후(온도, 습도) → 생태계. 경계에서는 부드럽게 섞이도록 가중치로 다룬다.
export const BIOMES = ['meadow', 'blossom', 'autumn', 'desert', 'tropical', 'snow', 'crystal', 'mushroom'] as const;
/** 기후로 정해지는 일반 생태계 수 (나머지는 마법 지대) */
export const BASE_BIOMES = 6;
export type Biome = (typeof BIOMES)[number];

export const BIOME_NAMES: Record<Biome, string> = {
  meadow: '초원',
  blossom: '벚꽃 숲',
  autumn: '단풍 숲',
  desert: '사막',
  tropical: '열대 숲',
  snow: '설원',
  crystal: '크리스탈 평원',
  mushroom: '버섯 숲',
};

export interface Climate {
  /** -1(추움) ~ 1(더움) */
  temp: number;
  /** -1(건조) ~ 1(습함) */
  moist: number;
  /** 마법 지대 정도 0~1 */
  magic: number;
  /** 마법 지대의 종류: 0=크리스탈, 1=버섯 */
  kind: number;
}

// (온도, 습도) 평면에서 각 생태계의 중심
const CENTERS: [number, number][] = [
  [0.1, -0.25], // meadow
  [0.1, 0.5], // blossom
  [-0.35, 0.2], // autumn
  [0.78, -0.5], // desert
  [0.78, 0.45], // tropical
  [-0.75, 0], // snow
];
const SIGMA2 = 2 * 0.25 * 0.25; // 작을수록 생태계 경계가 또렷하다

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

export function climateAt(x: number, z: number, seed: number): Climate {
  let temp = noise2(x * 0.0021, z * 0.0021, seed + 50) * 1.9 + noise2(x * 0.006, z * 0.006, seed + 52) * 0.35;
  let moist = noise2(x * 0.0026, z * 0.0026, seed + 51) * 1.9 + noise2(x * 0.007, z * 0.007, seed + 53) * 0.35;
  // 시작 지점 주변은 포근한 초원
  const k = clamp(1 - Math.hypot(x, z) / 150, 0, 1);
  const s = k * k * (3 - 2 * k);
  temp = lerp(temp, 0.1, s);
  moist = lerp(moist, -0.25, s);
  // 마법 지대: 시작 지점에서 조금 떨어진 곳에 덩어리로 나타난다
  const mn = noise2(x * 0.0019, z * 0.0019, seed + 60) * 1.7 + noise2(x * 0.005, z * 0.005, seed + 62) * 0.3;
  const magic = smooth(0.3, 0.6, mn) * smooth(110, 230, Math.hypot(x, z));
  const kind = smooth(0.4, 0.6, noise2(x * 0.003, z * 0.003, seed + 61) * 0.9 + 0.5);
  return { temp: clamp(temp, -1.1, 1.1), moist: clamp(moist, -1.1, 1.1), magic, kind };
}

/** 각 생태계의 가중치 (합이 1) */
export function biomeWeights(c: Climate, out: number[] = new Array(BIOMES.length).fill(0)): number[] {
  let sum = 0;
  for (let i = 0; i < CENTERS.length; i++) {
    const dt = c.temp - CENTERS[i][0];
    const dm = c.moist - CENTERS[i][1];
    out[i] = Math.exp(-(dt * dt + dm * dm) / SIGMA2);
    sum += out[i];
  }
  const keep = (1 - c.magic) / sum;
  for (let i = 0; i < CENTERS.length; i++) out[i] *= keep;
  out[6] = c.magic * (1 - c.kind);
  out[7] = c.magic * c.kind;
  return out;
}

export function dominantBiome(c: Climate): number {
  const w = biomeWeights(c);
  let best = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
  return best;
}
