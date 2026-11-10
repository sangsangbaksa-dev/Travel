import { describe, expect, it } from 'vitest';
import data from './assets/countries.json';
import { type Country, CountryIndex } from './countries';
import { SITES } from './landmarks/index';
import { seaName } from './places';

const index = new CountryIndex(data as Country[]);

const site = (name: string) => {
  const s = SITES.find((x) => x.name === name);
  if (!s) throw new Error(`랜드마크를 찾을 수 없다: ${name}`);
  return s;
};

describe('바다 이름', () => {
  it('위경도에 맞는 바다 이름을 돌려준다', () => {
    expect(seaName(37, 124)).toBe('황해');
    expect(seaName(40, 133)).toBe('동해');
    expect(seaName(30, -40)).toBe('대서양');
    expect(seaName(0, -150)).toBe('태평양');
    expect(seaName(-20, 80)).toBe('인도양');
    expect(seaName(75, 0)).toBe('북극해');
    expect(seaName(-65, 0)).toBe('남극해');
    expect(seaName(35, 18)).toBe('지중해');
    expect(seaName(15, -75)).toBe('카리브해');
  });
});

describe('랜드마크 좌표', () => {
  const cases: [string, string][] = [
    ['에펠탑', '프랑스'],
    ['기자의 피라미드', '이집트'],
    ['타지마할', '인도'],
    ['콜로세움', '이탈리아'],
    ['빅벤', '영국'],
    ['부르즈 할리파', '아랍에미리트'],
    ['N서울타워', '대한민국'],
    ['코르코바두 예수상', '브라질'],
    ['만리장성', '중화인민공화국'],
  ];

  it.each(cases)('%s은(는) %s 땅 위에 있다', (name, country) => {
    const s = site(name);
    expect(index.nameAt(s.lat, s.lon)).toBe(country);
  });

  it('시드니 오페라 하우스는 해안이라 110m 해상도에서 국가가 없거나 오스트레일리아다', () => {
    const s = site('시드니 오페라 하우스');
    expect([null, '오스트레일리아']).toContain(index.nameAt(s.lat, s.lon));
  });
});

describe('바다 위의 랜드마크', () => {
  it('타이타닉 난파선은 바다 위에 있다', () => {
    const s = site('타이타닉 난파선');
    expect(index.nameAt(s.lat, s.lon)).toBeNull();
  });
});
