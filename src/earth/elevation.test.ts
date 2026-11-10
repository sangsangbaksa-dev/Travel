import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeElevation, Elevation } from './elevation';
import { dirFromLatLon, latLonFromDir, METERS_PER_HEIGHT } from './geo';

const bytes = new Uint8Array(readFileSync(new URL('./assets/elevation.bin', import.meta.url)));
const grid = await decodeElevation(bytes, (d) => new Uint8Array(inflateSync(d)));
const earth = new Elevation(grid);
const at = (lat: number, lon: number) => {
  const d = dirFromLatLon(lat, lon);
  return earth.height(d.x, d.y, d.z);
};

describe('실제 지구 지형', () => {
  it('위경도와 방향 벡터가 서로 되돌아온다', () => {
    for (const [lat, lon] of [[40.7, -74], [-33.9, 151.2], [0, 0], [27.98, 86.92]]) {
      const d = dirFromLatLon(lat, lon);
      const back = latLonFromDir(d.x, d.y, d.z);
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });

  it('대륙은 육지이고 대양은 바다다', () => {
    expect(at(40.0, -100)).toBeGreaterThan(3); // 미국 대평원
    expect(at(48.85, 2.35)).toBeGreaterThan(0); // 파리
    expect(at(37.55, 127.0)).toBeGreaterThan(0); // 서울
    expect(at(30, -40)).toBeLessThan(-20); // 대서양
    expect(at(0, -150)).toBeLessThan(-20); // 태평양
    expect(at(-20, 80)).toBeLessThan(-20); // 인도양
  });

  it('에베레스트가 가장 높고 챌린저 해연이 가장 깊다', () => {
    const everest = at(27.9881, 86.925);
    expect(everest * METERS_PER_HEIGHT).toBeGreaterThan(8300);
    expect(everest * METERS_PER_HEIGHT).toBeLessThan(9400);
    expect(at(11.3733, 142.5917) * METERS_PER_HEIGHT).toBeLessThan(-10300);
    expect(at(46.5, 8.0)).toBeLessThan(everest); // 알프스
  });

  it('경도 ±180°에서 지형이 끊기지 않는다', () => {
    expect(Math.abs(at(-17, 179.999) - at(-17, -179.999))).toBeLessThan(0.3);
    expect(Math.abs(at(66, 179.999) - at(66, -179.999))).toBeLessThan(0.3);
  });
});
