import { describe, expect, it } from 'vitest';
import { createTerrain } from '../terrain/height';
import { createVolcanicTerrain, VOLCANO } from './volcano';

describe('화산 지형', () => {
  it('주변에서 높아지고 정상에는 낮은 분화구가 있다', () => {
    const base = createTerrain(1337), terrain = createVolcanicTerrain(base);
    const center = terrain.height(VOLCANO.x, VOLCANO.z);
    const rim = terrain.height(VOLCANO.x + 20, VOLCANO.z);
    expect(rim).toBeGreaterThan(center + 8);
    expect(rim).toBeGreaterThan(60);
    expect(terrain.height(0, 0)).toBe(base.height(0, 0));
  });
});
