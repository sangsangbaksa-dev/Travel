import { BUILDING_OFFSETS, CITY_BUILDING_OFFSETS, inSettlement, SETTLEMENTS } from './settlement-layout';
import { biomeWeights, dominantBiome, type Climate } from '../terrain/biome';
import { noise2, surfaceNormal, type Terrain } from '../terrain/height';

// 청크별 나무/바위/선인장 배치. 좌표와 시드만으로 결정되므로
// 렌더링과 물리가 같은 결과를 공유하고, 어디서든 같은 월드가 나온다.
export const CHUNK = 32;

export type ObjKind = 'tree' | 'rock' | 'rune' | 'float';

/** 나무 모양/색 변형 */
export const VARIANT = {
  green: 0, pink: 1, orange: 2, pine: 3, palm: 4, cactus: 5,
  crystalViolet: 6, crystalCyan: 7, crystalPink: 8, mushroomRed: 9, mushroomBlue: 10,
} as const;
export const VARIANT_COUNT = 11;

/** 마법진 점프 패드의 발사 배율 (점프 속도의 몇 배인가) */
export const RUNE_LAUNCH = 1.75;
/** 시작 지점 가까이에 둔 첫 마법진 */
export const STARTER_RUNE: [number, number] = [12, -8];

export interface WorldObj {
  kind: ObjKind;
  x: number;
  z: number;
  /** 지면 높이 */
  y: number;
  scale: number;
  rot: number;
  /** 나무 변형 (VARIANT 참고). 바위는 0 */
  variant: number;
  /** 생태계 번호 (BIOMES 순서). 바위 색 등에 쓴다 */
  biome: number;
  /** 충돌 반지름 */
  r: number;
  /** 위에 설 수 있는 높이. 나무는 설 수 없어서 Infinity */
  top: number;
  collisionBottom?: number;
  collisionTop?: number;
  /** 마법진: 밟으면 위로 쏘아 올리는 배율 */
  launch?: number;
}

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export const SPAWN_CLEAR = 7;
const DEFAULT_CLIMATE: Climate = { temp: 0.1, moist: -0.25, magic: 0, kind: 0 };

// 생태계별 나무 밀도: 기본 + 숲 계수 * 숲 노이즈
const DENSITY: [number, number][] = [
  [0.05, 0.6], // meadow
  [0.1, 0.7], // blossom
  [0.1, 0.65], // autumn
  [0.03, 0.14], // desert (선인장은 드문드문)
  [0.08, 0.5], // tropical
  [0.08, 0.6], // snow
  [0.12, 0.6], // crystal
  [0.12, 0.65], // mushroom
];

function pickVariant(biome: number, roll: number): number {
  switch (biome) {
    case 0: return roll < 0.18 ? VARIANT.pink : VARIANT.green;
    case 1: return roll < 0.85 ? VARIANT.pink : VARIANT.green;
    case 2: return roll < 0.85 ? VARIANT.orange : VARIANT.green;
    case 3: return VARIANT.cactus;
    case 4: return VARIANT.palm;
    case 5: return VARIANT.pine;
    case 6: return roll < 0.4 ? VARIANT.crystalViolet : roll < 0.75 ? VARIANT.crystalCyan : VARIANT.crystalPink;
    default: return roll < 0.55 ? VARIANT.mushroomRed : VARIANT.mushroomBlue;
  }
}

export function generateChunkObjects(t: Terrain, cx: number, cz: number, seed = 1337): WorldObj[] {
  const rnd = mulberry32(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ Math.imul(seed, 83492791));
  const water = t.waterLevel ?? -Infinity;
  const out: WorldObj[] = [];
  const n = { x: 0, y: 1, z: 0 };

  for (let i = 0; i < 48; i++) {
    // 난수는 항상 같은 순서로 소비해서 중간에 건너뛰어도 결과가 안정적이다
    const x = (cx + rnd()) * CHUNK;
    const z = (cz + rnd()) * CHUNK;
    const kindRoll = rnd();
    const scaleRoll = rnd();
    const rot = rnd() * Math.PI * 2;
    const variantRoll = rnd();
    const accept = rnd();

    if (Math.hypot(x, z) < SPAWN_CLEAR || inSettlement(x, z)) continue;
    const y = t.height(x, z);
    if (y < water + 0.8) continue;
    surfaceNormal(t, x, z, n);
    if (n.y < 0.88) continue;

    const biome = dominantBiome(t.climate ? t.climate(x, z) : DEFAULT_CLIMATE);

    let obj: WorldObj;
    if (kindRoll < 0.12) {
      if (accept > 0.4) continue;
      const scale = 0.7 + scaleRoll * 1.1;
      obj = { kind: 'rock', x, z, y, scale, rot, variant: 0, biome, r: 0.8 * scale, top: y + 0.55 * scale };
    } else {
      if (y > 16) continue; // 산꼭대기에는 나무가 없다
      const forest = smoothstep(-0.05, 0.35, noise2(x * 0.02, z * 0.02, seed + 9));
      const [base, k] = DENSITY[biome];
      if (accept > base + k * forest) continue;
      const variant = pickVariant(biome, variantRoll);
      const magical = variant >= VARIANT.crystalViolet;
      const scale = variant === VARIANT.pine ? 1.0 + scaleRoll * 0.7 : magical ? 0.9 + scaleRoll * 1.1 : 0.8 + scaleRoll * 0.8;
      const r =
        variant === VARIANT.cactus ? 0.35 * scale
        : variant === VARIANT.palm ? 0.28 * scale
        : variant <= VARIANT.crystalPink && variant >= VARIANT.crystalViolet ? 0.5 * scale
        : variant >= VARIANT.mushroomRed ? 0.3 * scale
        : 0.32 * scale;
      obj = { kind: 'tree', x, z, y, scale, rot, variant, biome, r, top: Infinity };
    }
    if (out.some((o) => Math.hypot(o.x - obj.x, o.z - obj.z) < o.r + obj.r + 0.8)) continue;
    out.push(obj);
  }

  return out;
}

export { biomeWeights };

export class ObjectCache {
  private readonly cache = new Map<string, WorldObj[]>();
  private near3: WorldObj[] = [];
  private nearKey = '';

  constructor(private readonly terrain: Terrain, private readonly seed = 1337) {}

  get(cx: number, cz: number): WorldObj[] {
    const key = `${cx},${cz}`;
    let list = this.cache.get(key);
    if (!list) {
      list = generateChunkObjects(this.terrain, cx, cz, this.seed);
      this.cache.set(key, list);
    }
    return list;
  }

  /** (x, z) 주변 3x3 청크의 오브젝트. 같은 청크 안에서는 같은 배열을 재사용한다. */
  near(x: number, z: number): readonly WorldObj[] {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const key = `${cx},${cz}`;
    if (key !== this.nearKey) {
      this.nearKey = key;
      this.near3 = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.near3.push(...this.get(cx + dx, cz + dz));
      // 건물은 렌더링 청크에 추가하지 않고 물리 충돌에만 제공한다.
      SETTLEMENTS.forEach((place, style) => {
        for (const [i, [dx, dz]] of (style === 2 ? CITY_BUILDING_OFFSETS : BUILDING_OFFSETS).entries()) {
          const bx = place.x + dx, bz = place.z + dz;
          if (Math.abs(bx - x) > CHUNK * 2 || Math.abs(bz - z) > CHUNK * 2) continue;
          const base = Math.max(this.terrain.height(bx, bz), this.terrain.waterLevel ?? -Infinity);
          const height = style === 2 ? (i >= 8 ? 9 + (i % 3) * 1.5 : 5 + (i % 3) * 1.3) : 2.7 + (i % 2) * .5;
          this.near3.push({ kind: 'tree', x: bx, z: bz, y: base, scale: 1, rot: 0, variant: 0, biome: 0, r: style === 2 ? 2.35 : 2.1, top: Infinity, collisionBottom: base - 0.5, collisionTop: base + height + 2.1 });
        }
      });
    }
    return this.near3;
  }

  prune(cx: number, cz: number, radius: number) {
    for (const key of this.cache.keys()) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) > radius) this.cache.delete(key);
    }
    this.nearKey = '';
  }
}
