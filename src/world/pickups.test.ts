import { describe, expect, it } from 'vitest';
import { createTerrain, WATER_LEVEL } from '../terrain/height';
import { generateChunkPickups, PickupField } from './pickups';
import { CHUNK, RUNE_STAR_HEIGHT, STARTER_RUNE } from './scatter';
import { nextDegree, noteFreq } from '../audio/notes';

const t = createTerrain(1337);

describe('별 조각', () => {
  it('같은 청크는 언제나 같은 별을 만든다', () => {
    expect(generateChunkPickups(t, 2, -3)).toEqual(generateChunkPickups(t, 2, -3));
  });

  it('시작 지점 가까이에 첫 별이 있다', () => {
    const f = new PickupField(t, new Set());
    const n = f.nearest(0, 0, 1);
    expect(n).not.toBeNull();
    expect(n!.dist).toBeLessThan(16);
  });

  it('별은 청크 안에 있고 점프로 닿는 높이다', () => {
    let count = 0, big = 0;
    for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) {
      for (const p of generateChunkPickups(t, cx, cz)) {
        count++;
        if (p.big) big++;
        if (!p.id.startsWith('s')) {
          expect(Math.floor(p.x / CHUNK)).toBe(cx);
          expect(Math.floor(p.z / CHUNK)).toBe(cz);
        }
        const ground = Math.max(t.height(p.x, p.z), WATER_LEVEL);
        expect(p.y - ground).toBeGreaterThan(0.9);
        // 점프 최고점(중심 +2.9)에서 닿는다. 마법진 위의 별은 발사되어야 닿는다.
        if (!p.id.startsWith('r')) expect(p.y - ground).toBeLessThanOrEqual(3.4);
      }
    }
    expect(count / 289).toBeGreaterThan(0.5); // 바다 청크는 드물어서 평균은 조금 낮다
    expect(big).toBeGreaterThan(5);
  });

  it('시작 지점의 마법진 위에 큰 별이 떠 있다', () => {
    const f = new PickupField(t, new Set());
    const [rx, rz] = STARTER_RUNE;
    let found: { y: number; value: number } | null = null;
    f.forEachNear(rx, rz, 1, (p) => {
      if (p.id.startsWith('r') && Math.hypot(p.x - rx, p.z - rz) < 0.01) found = p;
    });
    expect(found).not.toBeNull();
    expect(found!.value).toBe(3);
    expect(found!.y - t.height(rx, rz)).toBeCloseTo(RUNE_STAR_HEIGHT, 5);
  });

  it('먹은 별은 한 번만 먹히고 다시 나오지 않는다', () => {
    const f = new PickupField(t, new Set());
    const p = f.nearest(0, 0, 1)!.pickup;
    expect(f.collectNear(p.x, p.y, p.z, 1.2).map((q) => q.id)).toContain(p.id);
    expect(f.collectNear(p.x, p.y, p.z, 1.2)).toHaveLength(0);
    expect(f.collected.has(p.id)).toBe(true);
    expect(f.nearest(p.x, p.z, 0)?.pickup.id).not.toBe(p.id);
  });

  it('멀리 있는 별은 먹히지 않는다', () => {
    const f = new PickupField(t, new Set());
    const p = f.nearest(0, 0, 1)!.pickup;
    expect(f.collectNear(p.x + 5, p.y, p.z, 1.2)).toHaveLength(0);
  });

  it('가장 가까운 별을 찾는다', () => {
    const f = new PickupField(t, new Set());
    const n = f.nearest(30, 30, 2)!;
    f.forEachNear(30, 30, 2, (p) => expect(Math.hypot(p.x - 30, p.z - 30)).toBeGreaterThanOrEqual(n.dist - 1e-9));
  });
});

describe('음계', () => {
  it('옥타브가 올라가면 주파수가 두 배다', () => {
    expect(noteFreq(220, 0)).toBeCloseTo(220);
    expect(noteFreq(220, 5)).toBeCloseTo(440);
    expect(noteFreq(220, -5)).toBeCloseTo(110);
  });

  it('5음 음계의 음정이다 (도 레 미 솔 라)', () => {
    const r = (d: number) => noteFreq(100, d) / 100;
    expect(r(2)).toBeCloseTo(2 ** (4 / 12));
    expect(r(3)).toBeCloseTo(2 ** (7 / 12));
  });

  it('멜로디는 범위 안에서 움직이고 같은 음에 머무르지 않는다', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let d = 2;
    for (let i = 0; i < 500; i++) {
      const n = nextDegree(d, rnd);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(9);
      expect(n).not.toBe(d);
      d = n;
    }
  });
});
