import { describe, expect, it } from 'vitest';
import { PhysicsWorld, type Obstacle } from '../physics/world';
import { BUILDING_OFFSETS, CITY_BUILDING_OFFSETS, inSettlement, settlementNameAt, settlementRadius, SETTLEMENTS } from './settlement-layout';
import { generateChunkObjects, CHUNK } from './scatter';
import { createTerrain } from '../terrain/height';

const building: Obstacle = { x: 3, z: 0, r: 2, top: Infinity, collisionBottom: -1, collisionTop: 6 };
const input = { moveX: 1, moveZ: 0, jumpPressed: false, jumpHeld: false };
function travelAtHeight(height: number) {
  const w = new PhysicsWorld({ height: () => height }, 0, 0, { near: () => [building] });
  for (let i = 0; i < 90; i++) w.step(input);
  return w.state.x;
}
describe('정착지', () => {
  it('정착지 범위 안에서 이름을 반환하고 범위 밖에서는 반환하지 않는다', () => {
    for (const place of SETTLEMENTS) {
      expect(settlementNameAt(place.x, place.z)).toBe(place.name);
      expect(settlementNameAt(place.x + 16, place.z)).toBe(place.name);
    }
    expect(settlementNameAt(0, 0)).toBeNull();
  });
  it('건물은 같은 높이에서는 막지만 위와 아래에서는 막지 않는다', () => {
    expect(travelAtHeight(0)).toBeLessThan(1);
    expect(travelAtHeight(10)).toBeGreaterThan(3);
    expect(travelAtHeight(-10)).toBeGreaterThan(3);
  });
  it('건물과 광장은 육지에 있고 자연 오브젝트가 정착지 안에 생기지 않는다', () => {
    const terrain = createTerrain(1337);
    for (const [index, place] of SETTLEMENTS.entries()) {
      const radius = settlementRadius(index);
      for (const [dx,dz] of (index === 2 ? CITY_BUILDING_OFFSETS : BUILDING_OFFSETS)) expect(terrain.height(place.x+dx,place.z+dz)).toBeGreaterThan(terrain.waterLevel!);
      for(let cx=Math.floor((place.x-radius)/CHUNK);cx<=Math.floor((place.x+radius)/CHUNK);cx++) {
        for(let cz=Math.floor((place.z-radius)/CHUNK);cz<=Math.floor((place.z+radius)/CHUNK);cz++) {
          expect(generateChunkObjects(terrain,cx,cz).filter(o => o.kind !== 'rune' && inSettlement(o.x,o.z))).toHaveLength(0);
        }
      }
    }
  });
});
