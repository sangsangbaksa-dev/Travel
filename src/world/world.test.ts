import { describe, expect, it } from 'vitest';
import { BIOMES, climateAt, dominantBiome } from '../terrain/biome';
import { createTerrain, terrainInfo, WATER_LEVEL } from '../terrain/height';
import { CHUNK, generateChunkObjects, ObjectCache, RUNE_LAUNCH, RUNE_STAR_HEIGHT, SPAWN_CLEAR, STARTER_RUNE, VARIANT } from './scatter';
import {
  FLOAT_DEPTH, GRAVITY, HALF, JUMP_HEIGHT, JUMP_SPEED, MAX_SPEED, PhysicsWorld, WATER_SPEED, type Obstacle, type PhysicsInput,
} from '../physics/world';
import type { Terrain } from '../terrain/height';

const idle: PhysicsInput = { moveX: 0, moveZ: 0, jumpPressed: false, jumpHeld: false };
const flat: Terrain = { height: () => 0 };
const src = (list: Obstacle[]) => ({ near: () => list });

describe('월드 생성', () => {
  const t = createTerrain(1337);

  it('시작 지점 주변은 물 위의 땅이다', () => {
    for (let a = 0; a < 16; a++) {
      const x = Math.cos(a) * 12, z = Math.sin(a) * 12;
      expect(t.height(x, z)).toBeGreaterThan(WATER_LEVEL + 1);
    }
  });

  describe('넓은 범위의 통계 (3000x3000)', () => {
    let tot = 0, ocean = 0, land = 0, inland = 0, inlandWater = 0, riverCells = 0, steep = 0, minH = 0, maxH = -99;
    const biomeCount = new Array(BIOMES.length).fill(0);
    let riverTooHigh = 0;
    for (let x = -1500; x < 1500; x += 15) {
      for (let z = -1500; z < 1500; z += 15) {
        const i = terrainInfo(x, z);
        tot++;
        minH = Math.min(minH, i.height);
        maxH = Math.max(maxH, i.height);
        if (i.landness >= 0.6) inland++;
        if (i.height <= WATER_LEVEL) {
          if (i.landness < 0.6) ocean++;
          else inlandWater++;
        } else {
          land++;
          const dx = t.height(x + 1, z) - t.height(x - 1, z);
          const dz = t.height(x, z + 1) - t.height(x, z - 1);
          if (1 / Math.hypot(dx / 2, 1, dz / 2) < 0.62) steep++;
          biomeCount[dominantBiome(climateAt(x, z, 1337))]++;
        }
        if (i.river > 0.9) {
          riverCells++;
          if (i.height > WATER_LEVEL + 0.5) riverTooHigh++;
        }
      }
    }

    it('바다와 땅이 모두 넓게 있다', () => {
      expect(ocean / tot).toBeGreaterThan(0.15);
      expect(ocean / tot).toBeLessThan(0.5);
      expect(land / tot).toBeGreaterThan(0.4);
      expect(land / tot).toBeLessThan(0.75);
      expect(minH).toBeLessThan(-15); // 깊은 바다
    });

    it('내륙에 강과 호수가 있다', () => {
      expect(inlandWater / inland).toBeGreaterThan(0.01);
      expect(inlandWater / inland).toBeLessThan(0.25);
      expect(riverCells / tot).toBeGreaterThan(0.004);
    });

    it('강 한가운데는 물에 잠겨 있다', () => {
      expect(riverTooHigh / Math.max(1, riverCells)).toBeLessThan(0.05);
    });

    it('높은 산이 있지만 대부분의 땅은 걸어 다닐 수 있다', () => {
      expect(maxH).toBeGreaterThan(30);
      expect(steep / land).toBeLessThan(0.12);
    });

    it('여덟 생태계(마법 지대 포함)가 모두 충분히 나타난다', () => {
      BIOMES.forEach((_, k) => expect(biomeCount[k] / land).toBeGreaterThan(0.04));
    });
  });

  it('같은 청크는 언제나 같은 오브젝트를 만든다', () => {
    const a = generateChunkObjects(t, -1, 0);
    expect(a.length).toBeGreaterThan(0);
    expect(generateChunkObjects(t, -1, 0)).toEqual(a);
    expect(generateChunkObjects(t, 0, 0)).not.toEqual(a);
  });

  it('오브젝트는 물속, 시작 지점, 가파른 곳에 놓이지 않고 서로 겹치지 않는다', () => {
    let landChunks = 0, count = 0, rocks = 0;
    for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) {
      const list = generateChunkObjects(t, cx, cz);
      if (t.height((cx + 0.5) * CHUNK, (cz + 0.5) * CHUNK) > WATER_LEVEL + 1) landChunks++;
      for (const o of list) {
        count++;
        if (o.kind === 'rock') rocks++;
        expect(o.y).toBeGreaterThan(WATER_LEVEL + 0.7);
        expect(Math.hypot(o.x, o.z)).toBeGreaterThanOrEqual(SPAWN_CLEAR);
        expect(Math.floor(o.x / CHUNK)).toBe(cx);
        expect(Math.floor(o.z / CHUNK)).toBe(cz);
      }
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        expect(Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z)).toBeGreaterThan(list[i].r + list[j].r);
      }
    }
    expect(count / landChunks).toBeGreaterThan(2); // 땅 청크당 평균 오브젝트 수
    expect(count / landChunks).toBeLessThan(30);
    expect(rocks).toBeGreaterThan(20);
  });

  it('생태계마다 어울리는 나무가 자란다 (사막=선인장, 설원=소나무, 열대=야자수, 마법 지대=수정/버섯)', () => {
    const allowed: Record<number, number[]> = {
      0: [VARIANT.green, VARIANT.pink],
      1: [VARIANT.green, VARIANT.pink],
      2: [VARIANT.green, VARIANT.orange],
      3: [VARIANT.cactus],
      4: [VARIANT.palm],
      5: [VARIANT.pine],
      6: [VARIANT.crystalViolet, VARIANT.crystalCyan, VARIANT.crystalPink],
      7: [VARIANT.mushroomRed, VARIANT.mushroomBlue],
    };
    const seen = new Array(BIOMES.length).fill(0);
    for (let cx = -50; cx <= 50; cx += 2) for (let cz = -50; cz <= 50; cz += 2) {
      for (const o of generateChunkObjects(t, cx, cz)) {
        if (o.kind !== 'tree') continue;
        seen[o.biome]++;
        expect(allowed[o.biome]).toContain(o.variant);
      }
    }
    seen.forEach((n) => expect(n).toBeGreaterThan(20)); // 모든 생태계에 나무가 있다
  });

  it('마법진과 떠다니는 섬이 곳곳에 있고, 시작 지점 가까이에 첫 마법진이 있다', () => {
    const starter = generateChunkObjects(t, Math.floor(STARTER_RUNE[0] / CHUNK), Math.floor(STARTER_RUNE[1] / CHUNK))
      .find((o) => o.kind === 'rune' && o.x === STARTER_RUNE[0]);
    expect(starter).toBeDefined();
    expect(starter!.launch).toBe(RUNE_LAUNCH);

    let runes = 0, floats = 0, magicRunes = 0, magicLand = 0, plainRunes = 0, plainLand = 0;
    for (let cx = -40; cx <= 40; cx++) for (let cz = -40; cz <= 40; cz++) {
      const mx = (cx + 0.5) * CHUNK, mz = (cz + 0.5) * CHUNK;
      const land = t.height(mx, mz) > WATER_LEVEL + 1;
      const isMagic = t.climate!(mx, mz).magic > 0.8;
      if (land) (isMagic ? magicLand++ : plainLand++);
      for (const o of generateChunkObjects(t, cx, cz)) {
        if (o.kind === 'rune') {
          runes++;
          if (land) (isMagic ? magicRunes++ : plainRunes++);
          expect(o.y).toBeGreaterThan(WATER_LEVEL + 0.7);
        }
        if (o.kind === 'float') {
          floats++;
          expect(o.y - t.height(o.x, o.z)).toBeGreaterThanOrEqual(7); // 점프로는 못 닿는 높이에 떠 있다
        }
      }
    }
    expect(runes).toBeGreaterThan(100);
    expect(floats).toBeGreaterThan(100);
    const magicRate = magicRunes / Math.max(1, magicLand);
    const plainRate = plainRunes / Math.max(1, plainLand);
    expect(magicRate).toBeGreaterThan(0.1);
    expect(magicRate).toBeGreaterThan(plainRate * 2); // 마법 지대에 훨씬 많다
  });

  it('ObjectCache.near가 주변 청크의 오브젝트를 돌려준다', () => {
    const cache = new ObjectCache(t);
    const near = cache.near(10, 10);
    expect(near.length).toBeGreaterThan(0);
    expect(cache.near(11, 11)).toBe(near); // 같은 청크면 같은 배열
  });
});

describe('충돌체', () => {
  it('나무는 뚫고 지나갈 수 없다', () => {
    const w = new PhysicsWorld(flat, 0, 0, src([{ x: 3, z: 0, r: 0.4, top: Infinity }]));
    for (let i = 0; i < 180; i++) w.step({ ...idle, moveX: 1 });
    expect(w.state.x).toBeLessThanOrEqual(3 - 0.4 - HALF * 0.9 + 1e-6);
    expect(w.state.x).toBeGreaterThan(1.5);
  });

  it('나무에 비스듬히 부딪히면 옆으로 미끄러진다', () => {
    const w = new PhysicsWorld(flat, 0, 0, src([{ x: 3, z: 0.3, r: 0.4, top: Infinity }]));
    for (let i = 0; i < 240; i++) w.step({ ...idle, moveX: 1, moveZ: -0.3 });
    expect(w.state.x).toBeGreaterThan(3.5); // 옆으로 미끄러져 지나갔다
  });

  it('낮은 바위의 옆면은 걸어서 오를 수 없다', () => {
    const w = new PhysicsWorld(flat, 0, 0, src([{ x: 3, z: 0, r: 0.8, top: 0.55 }]));
    for (let i = 0; i < 120; i++) w.step({ ...idle, moveX: 1 });
    expect(w.state.x).toBeLessThanOrEqual(3 - 0.8 - HALF * 0.9 + 1e-6);
    expect(w.state.y).toBeCloseTo(HALF, 3);
  });

  it('바위 위로 점프해서 올라설 수 있고, 가장자리를 벗어나면 내려온다', () => {
    const rock = { x: 2.6, z: 0, r: 0.9, top: 0.7 };
    const w = new PhysicsWorld(flat, 0, 0, src([rock]));
    for (let i = 0; i < 5; i++) w.step(idle);
    w.step({ moveX: 0.35, moveZ: 0, jumpPressed: true, jumpHeld: true });
    let steps = 0;
    while (!w.state.grounded && steps++ < 200) w.step({ moveX: 0.35, moveZ: 0, jumpPressed: false, jumpHeld: true });
    expect(w.state.grounded).toBe(true);
    expect(w.state.y).toBeCloseTo(0.7 + HALF, 5); // 바위 윗면에 착지
    // 계속 가면 반대쪽으로 내려온다
    for (let i = 0; i < 180; i++) w.step({ ...idle, moveX: 1 });
    expect(w.state.y).toBeCloseTo(HALF, 3);
    expect(w.state.x).toBeGreaterThan(rock.x + rock.r);
  });

  it('바위 위에 선 채로는 비탈로 취급하지 않는다', () => {
    const w = new PhysicsWorld(flat, 3, 0, src([{ x: 3, z: 0, r: 0.9, top: 0.7 }]));
    w.state.y = 3;
    for (let i = 0; i < 60; i++) w.step(idle);
    expect(w.state.grounded).toBe(true);
    expect(w.state.y).toBeCloseTo(0.7 + HALF, 5);
    expect(w.state.onSteep).toBe(false);
  });
});

describe('마법진', () => {
  const pad = { x: 0, z: 0, r: 1.3, top: -Infinity, launch: RUNE_LAUNCH };

  it('마법진을 밟으면 점프보다 훨씬 높이 쏘아 올려진다', () => {
    const w = new PhysicsWorld(flat, 0, 0, src([pad]));
    w.step(idle);
    expect(w.state.launched).toBe(true);
    expect(w.state.grounded).toBe(false);
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      w.step(idle); // 버튼을 누르지 않아도 높이가 깎이지 않는다
      peak = Math.max(peak, w.state.y - HALF);
      if (w.state.grounded) break;
    }
    // 이론 높이 = v²/2g
    const expected = (JUMP_SPEED * RUNE_LAUNCH) ** 2 / (2 * GRAVITY);
    expect(peak).toBeGreaterThan(expected - 0.4);
    expect(peak).toBeLessThan(expected + 0.4);
    expect(peak).toBeGreaterThan(JUMP_HEIGHT * 2.5);
  });

  it('마법진 위의 큰 별에 닿을 수 있는 높이다', () => {
    const w = new PhysicsWorld(flat, 0, 0, src([pad]));
    w.step(idle);
    let best = Infinity;
    for (let i = 0; i < 200; i++) {
      w.step(idle);
      best = Math.min(best, Math.abs(w.state.y - (0 + RUNE_STAR_HEIGHT)));
      if (w.state.grounded) break;
    }
    expect(best).toBeLessThan(1.3); // 별을 먹는 반경
  });

  it('마법진 밖에서는 발사되지 않는다', () => {
    const w = new PhysicsWorld(flat, 3, 0, src([pad]));
    for (let i = 0; i < 30; i++) w.step(idle);
    expect(w.state.launched).toBe(false);
    expect(w.state.grounded).toBe(true);
  });

  it('물 위에서는 발사되지 않는다', () => {
    const lake2: Terrain = { height: () => -6, waterLevel: -2.5 };
    const w = new PhysicsWorld(lake2, 0, 0, src([pad]));
    for (let i = 0; i < 30; i++) w.step(idle);
    expect(w.state.launched).toBe(false);
  });
});

describe('물', () => {
  const lake: Terrain = { height: () => -6, waterLevel: -2.5 };

  it('깊은 물에서는 가라앉지 않고 수면에 뜬다', () => {
    const w = new PhysicsWorld(lake, 0, 0);
    for (let i = 0; i < 60; i++) w.step(idle);
    expect(w.state.inWater).toBe(true);
    expect(w.state.grounded).toBe(true);
    expect(w.state.y).toBeCloseTo(-2.5 - FLOAT_DEPTH + HALF, 5);
  });

  it('물에서는 이동이 느려진다', () => {
    const w = new PhysicsWorld(lake, 0, 0);
    for (let i = 0; i < 120; i++) w.step({ ...idle, moveX: 1 });
    const v = Math.hypot(w.state.vx, w.state.vz);
    expect(v).toBeCloseTo(MAX_SPEED * WATER_SPEED, 3);
  });

  it('물 위에서도 점프할 수 있다', () => {
    const w = new PhysicsWorld(lake, 0, 0);
    for (let i = 0; i < 10; i++) w.step(idle);
    w.step({ ...idle, jumpPressed: true, jumpHeld: true });
    expect(w.state.jumped).toBe(true);
    expect(w.state.grounded).toBe(false);
  });

  it('얕은 물가에서는 바닥을 밟고 물에서 걸어 나온다', () => {
    const shore: Terrain = { height: (x) => -1 + x * 0.1, waterLevel: -2.5 }; // x>-15 부터 수면 위
    const w = new PhysicsWorld(shore, 0, 0);
    for (let i = 0; i < 30; i++) w.step(idle);
    expect(w.state.inWater).toBe(false);
  });
});
