import type { Terrain } from '../terrain/height';
import { CHUNK, generateChunkObjects, mulberry32 } from './scatter';

// 별 조각 배치. 청크 좌표와 시드만으로 정해지므로 어디서든 같은 별이 같은 자리에 있다.
export interface Pickup {
  id: string;
  x: number;
  y: number;
  z: number;
  value: number;
  big: boolean;
}

/** 시작 지점 가까이에 두는 별: 처음 몇 걸음 안에 첫 별을 먹게 한다 */
const STARTERS: [number, number][] = [[8, 3], [-6, 10], [4, -12]];

export function generateChunkPickups(t: Terrain, cx: number, cz: number, seed = 1337): Pickup[] {
  const rnd = mulberry32(Math.imul(cx, 2654435761) ^ Math.imul(cz, 40503) ^ Math.imul(seed, 1597334677));
  const water = t.waterLevel ?? -Infinity;
  const out: Pickup[] = [];

  STARTERS.forEach(([x, z], i) => {
    if (Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz) {
      out.push({ id: `s${i}`, x, z, y: Math.max(t.height(x, z), water + 0.2) + 1.1, value: 1, big: false });
    }
  });

  const trees = generateChunkObjects(t, cx, cz, seed).filter((o) => o.kind === 'tree');
  const n = 1 + (rnd() < 0.45 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const x = (cx + rnd()) * CHUNK;
    const z = (cz + rnd()) * CHUNK;
    const roll = rnd();
    const h = t.height(x, z);
    if (h < water - 1.5) continue; // 깊은 호수 한가운데는 건너뛴다
    if (Math.hypot(x, z) < 6) continue;
    if (trees.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 0.9)) continue;
    const base = Math.max(h, water);
    if (roll < 0.15 && h > water + 0.5) {
      out.push({ id: `${cx},${cz},${i}`, x, z, y: h + 1.7, value: 5, big: true }); // 큰 별: 5점
    } else if (roll < 0.5) {
      out.push({ id: `${cx},${cz},${i}`, x, z, y: base + 3.3, value: 1, big: false }); // 점프해야 닿는 별
    } else {
      out.push({ id: `${cx},${cz},${i}`, x, z, y: base + 1.1, value: 1, big: false });
    }
  }
  return out;
}

export class PickupField {
  private readonly cache = new Map<string, Pickup[]>();

  constructor(
    private readonly terrain: Terrain,
    readonly collected: Set<string>,
    private readonly seed = 1337,
  ) {}

  get(cx: number, cz: number): Pickup[] {
    const key = `${cx},${cz}`;
    let list = this.cache.get(key);
    if (!list) {
      list = generateChunkPickups(this.terrain, cx, cz, this.seed);
      this.cache.set(key, list);
    }
    return list;
  }

  /** (x, z) 주변 radius 청크 안의 아직 못 먹은 별 */
  forEachNear(x: number, z: number, radius: number, fn: (p: Pickup) => void) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (const p of this.get(cx + dx, cz + dz)) if (!this.collected.has(p.id)) fn(p);
      }
    }
  }

  /** 구 안에 들어온 별을 먹고 돌려준다 */
  collectNear(x: number, y: number, z: number, r: number): Pickup[] {
    const got: Pickup[] = [];
    this.forEachNear(x, z, 1, (p) => {
      if (Math.hypot(p.x - x, p.y - y, p.z - z) <= r) got.push(p);
    });
    for (const p of got) this.collected.add(p.id);
    return got;
  }

  nearest(x: number, z: number, radius = 3): { pickup: Pickup; dist: number } | null {
    let best: { pickup: Pickup; dist: number } | null = null;
    this.forEachNear(x, z, radius, (p) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (!best || d < best.dist) best = { pickup: p, dist: d };
    });
    return best;
  }

  prune(cx: number, cz: number, radius: number) {
    for (const key of this.cache.keys()) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) > radius) this.cache.delete(key);
    }
  }
}
