import { describe, expect, it } from 'vitest';
import data from './assets/countries.json';
import { type Country, CountryIndex } from './countries';

const index = new CountryIndex(data as Country[]);

describe('국가 찾기', () => {
  it('주요 도시의 국가를 한국어 이름으로 찾는다', () => {
    expect(index.nameAt(40.78, -73.97)).toBe('미국');
    expect(index.nameAt(48.85, 2.35)).toBe('프랑스');
    expect(index.nameAt(37.55, 127.0)).toBe('대한민국');
    expect(index.nameAt(35.68, 139.76)).toBe('일본');
    expect(index.nameAt(-33.86, 151.2)).toBe('오스트레일리아');
    // 110m 해상도라 에베레스트 정상(27.99, 86.93)은 중국 쪽으로 잡힌다. 카트만두로 확인한다.
    expect(index.nameAt(27.72, 85.32)).toBe('네팔');
  });

  it('바다 위에서는 null을 돌려준다', () => {
    expect(index.nameAt(30, -40)).toBeNull();
  });

  it('날짜변경선을 가로지르는 국가(러시아, 피지)를 찾는다', () => {
    expect(index.nameAt(66, 179.5)).toBe('러시아');
    expect(index.nameAt(66, -179.5)).toBe('러시아');
    expect(index.nameAt(-17.7, 178.0)).toBe('피지');
    expect(index.nameAt(-16.3, -179.9)).toBe('피지');
  });

  it('구멍(hole)과 외곽 밖의 점은 국가로 판정하지 않는다', () => {
    const square: Country[] = [
      {
        n: '테스트',
        // 외곽 0..10, 구멍 4..6 (0.01도 단위 정수)
        polys: [[[0, 0, 1000, 0, 1000, 1000, 0, 1000, 0, 0], [400, 400, 600, 400, 600, 600, 400, 600, 400, 400]]],
      },
    ];
    const t = new CountryIndex(square);
    expect(t.nameAt(2, 2)).toBe('테스트');
    expect(t.nameAt(5, 5)).toBeNull(); // 구멍 안
    expect(t.nameAt(11, 5)).toBeNull(); // 외곽 밖
  });
});
