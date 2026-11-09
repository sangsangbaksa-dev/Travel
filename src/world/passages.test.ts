import { describe, expect, it } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { HALF, PhysicsWorld } from '../physics/world';
import { createTerrain, waterHeightAt } from '../terrain/height';
import { CAVE, caveCeilingAt, caveObstacles, createPassageTerrain, Passages, passageZone } from './passages';

const terrain = createPassageTerrain({ height: () => 4, waterLevel: -2.5 });
const walk = (world: PhysicsWorld, direction: number, steps: number) => {
  for (let i = 0; i < steps; i++) world.step({ moveX: 0, moveZ: direction, jumpPressed: false, jumpHeld: false });
};

describe('지형에 이어진 동굴과 계단', () => {
  it('굴을 걸어 내려가고 순간 이동 없이 다시 올라온다', () => {
    const world = new PhysicsWorld(terrain, -10, 0);
    walk(world, -1, 550);
    expect(world.state.z).toBeLessThan(-50);
    expect(world.state.y).toBeLessThan(-5);
    expect(world.state.inWater).toBe(false);
    expect(passageZone(world.state.x, world.state.z)).toBe('cave');
    walk(world, 1, 550);
    expect(world.state.z).toBeGreaterThan(-6);
    expect(world.state.y).toBeCloseTo(4 + HALF, 0);
  });
  it('긴 계단을 따라 실제로 높이 올라가고 같은 길로 내려온다', () => {
    const world = new PhysicsWorld(terrain, 12, 0);
    walk(world, -1, 1450);
    expect(world.state.z).toBeLessThan(-190);
    expect(world.state.y).toBeGreaterThan(65);
    walk(world, 1, 1450);
    expect(world.state.z).toBeGreaterThan(-6);
    expect(world.state.y).toBeLessThan(8);
  });
  it('실제 생성 지형에서도 계단과 굴을 걸어갈 수 있다', () => {
    const actual = createPassageTerrain(createTerrain(1337));
    const cave = new PhysicsWorld(actual, -10, 0);
    walk(cave, -1, 550);
    expect(cave.state.z).toBeLessThan(-50);
    expect(cave.state.inWater).toBe(false);
    const stairs = new PhysicsWorld(actual, 12, 0);
    walk(stairs, -1, 1450);
    expect(stairs.state.z).toBeLessThan(-190);
    expect(stairs.state.y).toBeGreaterThan(65);
  });

  it('낮은 암반을 파낸 굴이 입구에서 막다른 끝까지 마른 상태를 유지한다', () => {
    const actual = createPassageTerrain(createTerrain(1337));
    const player = new PhysicsWorld(actual, CAVE.x, 0, { near: caveObstacles });
    for (let i = 0; i < 1080; i++) {
      walk(player, -1, 1);
      expect(player.state.inWater).toBe(false);
    }
    expect(player.state.z).toBeLessThan(-120);
    expect(player.state.z).toBeGreaterThan(-138);
    expect(waterHeightAt(actual, CAVE.x, -151)).toBe(-Infinity);
    expect(waterHeightAt(actual, CAVE.x - 12, -120)).toBe(actual.waterLevel);
    expect(caveCeilingAt(actual, CAVE.x, -100) - actual.height(CAVE.x, -100)).toBeGreaterThan(4);
    expect(actual.height(CAVE.x, -143)).toBeGreaterThan(caveCeilingAt(actual, CAVE.x, -143));
  });

  it('입구부터 깊은 곳까지 머리 위를 연속된 암반이 가린다', () => {
    const actual = createPassageTerrain(createTerrain(1337));
    const { group } = new Passages(actual);
    group.updateMatrixWorld(true);
    const ray = new Raycaster();
    for (const z of [-25, -61.5, -96.5, -125]) for (const dx of [-3, 0, 3]) {
      const x = CAVE.x + dx;
      ray.set(new Vector3(x, actual.height(x, z) + 1, z), new Vector3(0, 1, 0));
      const first = ray.intersectObject(group, true)[0];
      expect(first?.distance).toBeGreaterThan(2);
      expect(first?.distance).toBeLessThan(5);
    }
  });
});
