import { describe, expect, it } from 'vitest';
import { sampleSky, sampleSkyForSun, type RGB } from './cycle';

const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('낮과 밤 순환', () => {
  it('정오에는 해가 높이 떠 있고 자정에는 지평선 아래다', () => {
    expect(sampleSky(0.5).elevation).toBeCloseTo(1, 5);
    expect(sampleSky(0).elevation).toBeCloseTo(-1, 5);
    expect(sampleSky(0.25).elevation).toBeCloseTo(0, 5);
  });

  it('낮 하늘이 밤 하늘보다 훨씬 밝다', () => {
    expect(lum(sampleSky(0.5).top)).toBeGreaterThan(lum(sampleSky(0).top) * 4);
    expect(sampleSky(0.5).hemiIntensity).toBeGreaterThan(sampleSky(0).hemiIntensity);
  });

  it('별은 밤에만, 햇빛은 낮에만, 달빛은 밤에만 나온다', () => {
    expect(sampleSky(0.5).stars).toBe(0);
    expect(sampleSky(0).stars).toBe(1);
    expect(sampleSky(0.5).sunIntensity).toBeGreaterThan(1);
    expect(sampleSky(0).sunIntensity).toBe(0);
    expect(sampleSky(0).moonIntensity).toBeGreaterThan(0.3);
    expect(sampleSky(0.5).moonIntensity).toBe(0);
  });

  it('해돋이와 해넘이 지평선은 따뜻한 색이다', () => {
    for (const t of [0.27, 0.73]) {
      const h = sampleSky(t).horizon;
      expect(h[0]).toBeGreaterThan(h[2]); // 붉은 기가 파란 기보다 많다
    }
  });

  it('하루가 끝나면 처음으로 매끄럽게 이어진다 (순환)', () => {
    const a = sampleSky(0);
    const b = sampleSky(1);
    const c = sampleSky(1.5);
    expect(b.top).toEqual(a.top);
    expect(c.top).toEqual(sampleSky(0.5).top);
    expect(sampleSky(-0.25).elevation).toBeCloseTo(sampleSky(0.75).elevation, 5);
  });

  it('시간이 흐르는 동안 색과 밝기가 갑자기 튀지 않는다', () => {
    let prev = sampleSky(0);
    for (let i = 1; i <= 4000; i++) {
      const s = sampleSky(i / 4000);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(s.top[c] - prev.top[c])).toBeLessThan(0.02);
        expect(Math.abs(s.horizon[c] - prev.horizon[c])).toBeLessThan(0.02);
        expect(Math.abs(s.hemiSky[c] - prev.hemiSky[c])).toBeLessThan(0.02);
      }
      expect(Math.abs(s.hemiIntensity - prev.hemiIntensity)).toBeLessThan(0.02);
      expect(Math.abs(s.sunIntensity - prev.sunIntensity)).toBeLessThan(0.02);
      prev = s;
    }
  });

  it('모든 색 값이 0~1 범위다', () => {
    for (let i = 0; i < 200; i++) {
      const s = sampleSky(i / 200);
      for (const c of [s.top, s.horizon, s.sunColor, s.hemiSky, s.hemiGround]) {
        for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      }
    }
  });

  it('실제 해 높이에서 고른 하늘이 같은 높이의 시각과 일치한다', () => {
    for (const e of [-0.9, -0.2, 0, 0.3, 0.95]) {
      expect(sampleSkyForSun(e, true).elevation).toBeCloseTo(e, 5);
      expect(sampleSkyForSun(e, false).elevation).toBeCloseTo(e, 5);
    }
    expect(sampleSkyForSun(0.05, false).horizon[0]).toBeGreaterThan(sampleSkyForSun(0.05, false).horizon[2]);
  });
});
