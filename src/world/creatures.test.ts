import { describe, expect, it } from 'vitest';
import { creatureSpecies } from './creatures';

describe('생물의 서식지', () => {
  it('설원과 높은 산에는 일반 토끼나 거북이가 나타나지 않는다', () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
      expect(['goat', 'bird']).toContain(creatureSpecies('snow', 3, roll));
      expect(['goat', 'bird']).toContain(creatureSpecies('meadow', 20, roll));
    }
  });
  it('기후에 맞는 생물이 나온다', () => {
    expect(creatureSpecies('desert', 4, 0.2)).toBe('fox');
    expect(creatureSpecies('tropical', 4, 0.8)).toBe('parrot');
    expect(creatureSpecies('autumn', 4, 0.2)).toBe('deer');
    expect(creatureSpecies('meadow', 4, 0.2)).toBe('rabbit');
  });
});
