import { noise2, surfaceNormal, type Terrain } from '../terrain/height';

// 청크별 나무/바위 배치. 좌표와 시드만으로 결정되므로
// 렌더링과 물리가 같은 결과를 공유하고, 어디서든 같은 월드가 나온다.
export const CHUNK = 32;

export type ObjKind = 'tree' | 'rock';

export interface WorldObj {
  kind: ObjKind;
  x: number;
  z: number;
  /** 지면 높이 */
  y: number;
  scale: number;
  rot: number;
  /** 나무 색 변형 (0=초록, 1=분홍 벚꽃) */
  variant: number;
  /** 충돌 반지름 */
  r: number;
  /** 위에 설 수 있는 높이. 나무는 설 수 없어서 Infinity */
  top: number;
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

    if (Math.hypot(x, z) < SPAWN_CLEAR) continue;
    const y = t.height(x, z);
    if (y < water + 0.8) continue;
    surfaceNormal(t, x, z, n);
    if (n.y < 0.88) continue;

    let obj: WorldObj;
    if (kindRoll < 0.12) {
      if (accept > 0.4) continue;
      const scale = 0.7 + scaleRoll * 1.1;
      obj = { kind: 'rock', x, z, y, scale, rot, variant: 0, r: 0.8 * scale, top: y + 0.55 * scale };
    } else {
      const forest = smoothstep(-0.05, 0.35, noise2(x * 0.02, z * 0.02, seed + 9));
      if (accept > 0.05 + 0.6 * forest) continue;
      const scale = 0.8 + scaleRoll * 0.8;
      obj = {
        kind: 'tree', x, z, y, scale, rot,
        variant: variantRoll < 0.22 ? 1 : 0,
        r: 0.32 * scale, top: Infinity,
      };
    }
    if (out.some((o) => Math.hypot(o.x - obj.x, o.z - obj.z) < o.r + obj.r + 0.8)) continue;
    out.push(obj);
  }
  return out;
}

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
