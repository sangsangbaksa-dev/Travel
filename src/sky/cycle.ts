// 낮과 밤의 순환. 시간 t는 0~1 (0=자정, 0.25=해돋이, 0.5=정오, 0.75=해넘이).
// 렌더링과 분리된 순수 함수라서 테스트할 수 있다.
export type RGB = [number, number, number];

export interface SkyState {
  top: RGB;
  horizon: RGB;
  sunDir: [number, number, number];
  /** 해 높이 (-1~1). 0 위면 해가 떠 있다 */
  elevation: number;
  sunColor: RGB;
  sunIntensity: number;
  moonIntensity: number;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
  /** 별이 보이는 정도 0~1 */
  stars: number;
}

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

interface Key {
  t: number;
  top: RGB;
  horizon: RGB;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
  stars: number;
}

const k = (t: number, top: string, horizon: string, hs: string, hg: string, hi: number, stars: number): Key => ({
  t, top: hex(top), horizon: hex(horizon), hemiSky: hex(hs), hemiGround: hex(hg), hemiIntensity: hi, stars,
});

// 실제 하늘에 가까운 키프레임. 마지막은 첫 번째와 같아서 매끄럽게 이어진다.
const KEYS: Key[] = [
  k(0.0, '#04070f', '#0d1424', '#3a4a78', '#141a2a', 0.35, 1),
  k(0.2, '#060b18', '#1a2238', '#45557f', '#1c2234', 0.4, 0.9),
  k(0.27, '#4a6fa5', '#f0a374', '#ffd7b8', '#7a7a66', 1.1, 0.05),
  k(0.36, '#3f7fd0', '#a9cbe8', '#fff4e6', '#8a9a7a', 1.4, 0),
  k(0.5, '#2f74d0', '#b4d2ee', '#fffaf0', '#8a9a7a', 1.5, 0),
  k(0.64, '#3a7bcf', '#adcdea', '#fff4e6', '#8a9a7a', 1.4, 0),
  k(0.73, '#56609e', '#f29a6b', '#ffcfb0', '#7a7060', 1.1, 0.05),
  k(0.8, '#0d1230', '#2a2440', '#4a5584', '#1c2030', 0.45, 0.7),
  k(1.0, '#04070f', '#0d1424', '#3a4a78', '#141a2a', 0.35, 1),
];

const WARM = hex('#ffb27a');
const NOON = hex('#fff0d8');

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const mix = (a: RGB, b: RGB, u: number): RGB => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export function sampleSky(timeOfDay: number): SkyState {
  const t = ((timeOfDay % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && t >= KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const u = smooth(0, 1, (t - a.t) / (b.t - a.t));

  const angle = (t - 0.25) * Math.PI * 2;
  const elevation = Math.sin(angle);
  const dx = Math.cos(angle), dy = Math.sin(angle), dz = 0.4;
  const len = Math.hypot(dx, dy, dz);

  return {
    top: mix(a.top, b.top, u),
    horizon: mix(a.horizon, b.horizon, u),
    sunDir: [dx / len, dy / len, dz / len],
    elevation,
    sunColor: mix(WARM, NOON, smooth(0, 0.5, elevation)),
    sunIntensity: smooth(-0.02, 0.22, elevation) * 1.25,
    moonIntensity: smooth(-0.02, 0.22, -elevation) * 0.5,
    hemiSky: mix(a.hemiSky, b.hemiSky, u),
    hemiGround: mix(a.hemiGround, b.hemiGround, u),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, u),
    stars: lerp(a.stars, b.stars, u),
  };
}

/**
 * 실제 해 높이(-1~1)로 하늘을 고른다. morning이면 해가 떠오르는 중, 아니면 지는 중.
 * sunDir은 호출한 쪽이 실제 방향으로 바꿔 쓴다.
 */
export function sampleSkyForSun(elevation: number, morning: boolean): SkyState {
  const e = Math.max(-1, Math.min(1, elevation));
  // 해가 15°쯤만 떠도 한낮 하늘이 되도록 시각 축을 늘린다
  const a = Math.max(-0.25, Math.min(0.25, (Math.asin(e) / (Math.PI * 2)) * 2.2));
  const s = sampleSky(morning ? 0.25 + a : 0.75 - a);
  s.elevation = e;
  s.sunColor = mix(WARM, NOON, smooth(0, 0.35, e));
  s.sunIntensity = smooth(-0.02, 0.18, e) * 1.25;
  s.moonIntensity = smooth(-0.02, 0.22, -e) * 0.5;
  return s;
}
