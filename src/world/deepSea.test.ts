import { describe, expect, it } from 'vitest';
import { createTerrain } from '../terrain/height';
import { findWreckSite } from './deepSea';

describe('심해 난파선', () => {
  it('실제 월드에서 수심이 충분한 해저에 놓인다', () => {
    const terrain = createTerrain(1337);
    const site = findWreckSite(terrain);
    expect(site).not.toBeNull();
    expect(terrain.waterLevel! - site!.y).toBeGreaterThanOrEqual(14);
    expect(findWreckSite(terrain)).toEqual(site);
  });
  it('깊은 바다가 없으면 난파선을 배치하지 않는다', () => {
    expect(findWreckSite({ height: () => 0, waterLevel: 0 })).toBeNull();
  });
});
