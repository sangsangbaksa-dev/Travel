import { describe, expect, it } from 'vitest';
import { dirFromLatLon } from './geo';
import { declination, sunDirection } from './sun';

describe('해의 위치', () => {
  it('하지에는 북회귀선, 동지에는 남회귀선 위에 해가 있다', () => {
    expect(declination(171)).toBeCloseTo(23.4, 0);
    expect(declination(354)).toBeCloseTo(-23.4, 0);
  });

  it('뉴욕(서경 74°)은 세계시 17시 무렵이 한낮이고 5시 무렵은 한밤이다', () => {
    const nyc = dirFromLatLon(40.7, -74);
    expect(sunDirection(80, 16.9).dot(nyc)).toBeGreaterThan(0.7);
    expect(sunDirection(80, 4.9).dot(nyc)).toBeLessThan(-0.7);
  });

  it('서울이 낮일 때 뉴욕은 밤이다', () => {
    const seoul = dirFromLatLon(37.55, 127), nyc = dirFromLatLon(40.7, -74);
    const s = sunDirection(80, 3.5);
    expect(s.dot(seoul)).toBeGreaterThan(0.5);
    expect(s.dot(nyc)).toBeLessThan(0);
  });
});
