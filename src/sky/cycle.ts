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

// 파스텔 톤 키프레임. 마지막은 첫 번째와 같아서 매끄럽게 이어진다.
const KEYS: Key[] = [
  k(0.0, '#0d1033', '#2a2d5a', '#6272c4', '#242a58', 0.6, 1),
  k(0.2, '#1c2050', '#413f73', '#6c7ac2', '#2c3260', 0.65, 0.9),
  k(0.27, '#7fa6e6', '#ffc7a6', '#ffe0cf', '#b7b28a', 1.3, 0.05),
  k(0.36, '#6eb4ef', '#cfe3f2', '#f4efe4', '#b7c49a', 1.65, 0),
  k(0.5, '#5aa6e8', '#d2e6f4', '#f4efe4', '#b7c49a', 1.75, 0),
  k(0.64, '#6bb0ec', '#d0e4f3', '#f3ece0', '#b7c49a', 1.65, 0),
  k(0.73, '#8084d8', '#ffb59a', '#ffd8c4', '#b8a884', 1.3, 0.05),
  k(0.8, '#2b2b68', '#5c4c7c', '#7c80c4', '#3a3a68', 0.75, 0.7),
  k(1.0, '#0d1033', '#2a2d5a', '#6272c4', '#242a58', 0.6, 1),
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
