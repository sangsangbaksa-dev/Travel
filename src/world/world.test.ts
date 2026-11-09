import { describe, expect, it } from 'vitest';
import { createTerrain, WATER_LEVEL } from '../terrain/height';
import { CHUNK, generateChunkObjects, ObjectCache, SPAWN_CLEAR } from './scatter';
import {
  FLOAT_DEPTH, HALF, MAX_SPEED, PhysicsWorld, WATER_SPEED, type Obstacle, type PhysicsInput,
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

  it('땅과 물이 적당히 섞여 있다 (땅 55~92%)', () => {
    let land = 0, total = 0;
    for (let x = -600; x < 600; x += 8) for (let z = -600; z < 600; z += 8) {
      total++;
      if (t.height(x, z) > WATER_LEVEL) land++;
    }
    const f = land / total;
    expect(f).toBeGreaterThan(0.55);
    expect(f).toBeLessThan(0.92);
  });

  it('같은 청크는 언제나 같은 오브젝트를 만든다', () => {
    expect(generateChunkObjects(t, 3, -2)).toEqual(generateChunkObjects(t, 3, -2));
    expect(generateChunkObjects(t, 3, -2)).not.toEqual(generateChunkObjects(t, 4, -2));
  });

  it('오브젝트는 물속, 시작 지점, 가파른 곳에 놓이지 않고 서로 겹치지 않는다', () => {
    let count = 0, trees = 0, rocks = 0;
    for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) {
      const list = generateChunkObjects(t, cx, cz);
      for (const o of list) {
        count++;
        o.kind === 'tree' ? trees++ : rocks++;
        expect(o.y).toBeGreaterThan(WATER_LEVEL + 0.7);
        expect(Math.hypot(o.x, o.z)).toBeGreaterThanOrEqual(SPAWN_CLEAR);
        expect(Math.floor(o.x / CHUNK)).toBe(cx);
        expect(Math.floor(o.z / CHUNK)).toBe(cz);
      }
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        expect(Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z)).toBeGreaterThan(list[i].r + list[j].r);
      }
    }
    expect(trees / 169).toBeGreaterThan(3); // 청크당 평균 나무 수
    expect(rocks).toBeGreaterThan(50);
    expect(count / 169).toBeLessThan(30);
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
