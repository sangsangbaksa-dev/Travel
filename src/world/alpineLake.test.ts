import { describe, expect, it } from 'vitest';
import { createTerrain, waterHeightAt, WATER_LEVEL } from '../terrain/height';
import { FLOAT_DEPTH, HALF, PhysicsWorld } from '../physics/world';
import { ALPINE_LAKE, createAlpineTerrain } from './alpineLake';

const lake = createAlpineTerrain(createTerrain(1337));
const idle = { moveX: 0, moveZ: 0, jumpPressed: false, jumpHeld: false };

describe('빙하호', () => {
  it('바다보다 높은 수면에서 뜨고, 잠수한 뒤 남쪽 호숫가로 걸어 나온다', () => {
    const { x, z, level } = ALPINE_LAKE;
    const player = new PhysicsWorld(lake, x, z);
    expect(player.state.inWater).toBe(true);
    expect(player.state.y).toBeCloseTo(level - FLOAT_DEPTH + HALF);
    for (let i = 0; i < 95; i++) player.step({ ...idle, diveHeld: true });
    expect(player.state.submerged).toBe(true);
    expect(player.state.y).toBeLessThan(level - 3);
    for (let i = 0; i < 450; i++) player.step({ ...idle, moveZ: 1, jumpHeld: true });
    expect(player.state.z).toBeGreaterThan(z + 34);
    expect(player.state.inWater).toBe(false);
    expect(player.state.submerged).toBe(false);
  });

  it('호숫가 밖의 바다 수면을 높이지 않는다', () => {
    expect(waterHeightAt(lake, 0, 0)).toBe(WATER_LEVEL);
    expect(lake.height(ALPINE_LAKE.x, ALPINE_LAKE.z)).toBeLessThan(ALPINE_LAKE.level - 6);
  });
});
