import { METERS_PER_HEIGHT, RADIUS } from './geo';
import { noise3 } from './noise3';

// 지면 색: NASA 블루 마블 위성사진을 바탕으로 해저, 모래사장, 바위 비탈, 만년설을 덧칠한다.
// 나무 종류와 밀도도 같은 사진(초록빛)과 위도·고도로 정한다.

export interface Picture { w: number; h: number; data: Uint8ClampedArray | Uint8Array }

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 등장방형 사진에서 위경도의 색을 이중선형으로 읽는다 (선형 RGB) */
export function samplePicture(p: Picture, lat: number, lon: number, out: number[]): number[] {
  const fx = ((lon + 180) / 360) * p.w - 0.5;
  const fy = ((90 - lat) / 180) * p.h - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const x0 = ((ix % p.w) + p.w) % p.w, x1 = (x0 + 1) % p.w;
  const y0 = Math.max(0, Math.min(p.h - 1, iy)), y1 = Math.max(0, Math.min(p.h - 1, iy + 1));
  const d = p.data;
  for (let c = 0; c < 3; c++) {
    const a = LIN[d[(y0 * p.w + x0) * 4 + c]], b = LIN[d[(y0 * p.w + x1) * 4 + c]];
    const e = LIN[d[(y1 * p.w + x0) * 4 + c]], f = LIN[d[(y1 * p.w + x1) * 4 + c]];
    out[c] = (a + (b - a) * tx) * (1 - ty) + (e + (f - e) * tx) * ty;
  }
  return out;
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const mix = (o: number[], r: number, g: number, b: number, t: number) => {
  o[0] += (r - o[0]) * t; o[1] += (g - o[1]) * t; o[2] += (b - o[2]) * t;
};

/** 위도별 만년설 고도(칸) */
export function snowLine(lat: number): number {
  const a = Math.abs(lat);
  const m = a < 25 ? 5000 : Math.max(0, 5000 - (a - 25) * 105);
  return m / METERS_PER_HEIGHT;
}

/**
 * 지면 색 (선형 RGB). slope는 0(평지)~1(절벽).
 * x, y, z는 단위 방향, h는 높이(칸).
 */
export function groundColor(
  earth: Picture, x: number, y: number, z: number, lat: number, lon: number, h: number, slope: number, out: number[],
): number[] {
  const px = x * RADIUS, py = y * RADIUS, pz = z * RADIUS;
  if (h < 0) {
    // 해저: 얕은 곳은 모래, 깊어질수록 진흙빛으로 어두워진다
    const depth = smooth(0, 45, -h);
    out[0] = 0.42 - 0.36 * depth; out[1] = 0.36 - 0.29 * depth; out[2] = 0.24 - 0.17 * depth;
    const reef = Math.abs(lat) < 28 ? smooth(-1.6, -0.3, h) * (1 - smooth(-0.3, 0, h)) : 0;
    mix(out, 0.55, 0.5, 0.36, reef * 0.5);
  } else {
    samplePicture(earth, lat, lon, out);
    // 사진은 하늘에서 본 색이라 어둡다. 땅에서 보는 밝기로 끌어올린다.
    const boost = 1.35;
    out[0] *= boost; out[1] *= boost; out[2] *= boost;
    // 해안의 모래사장
    const beach = 1 - smooth(0.1, 0.55, h);
    if (Math.abs(lat) < 62) mix(out, 0.62, 0.55, 0.38, beach * 0.7);
    // 가파른 비탈은 바위가 드러난다
    mix(out, 0.2, 0.18, 0.16, smooth(0.45, 0.85, slope) * 0.85);
    // 만년설
    const line = snowLine(lat) + noise3(px / 9, py / 9, pz / 9) * 2.5;
    const snow = smooth(line - 1.5, line + 2, h) * (1 - smooth(0.75, 0.95, slope) * 0.6);
    mix(out, 0.86, 0.89, 0.93, snow);
  }
  // 가까이서 단조롭지 않게 밝기를 조금씩 흔든다
  const v = 1 + noise3(px / 3.1, py / 3.1, pz / 3.1) * 0.09 + noise3(px / 0.9, py / 0.9, pz / 0.9) * 0.04;
  out[0] = Math.min(1, out[0] * v); out[1] = Math.min(1, out[1] * v); out[2] = Math.min(1, out[2] * v);
  return out;
}

export const TREE = { none: 0, broadleaf: 1, conifer: 2, palm: 3, birch: 4, shrub: 5 } as const;
export type TreeKind = (typeof TREE)[keyof typeof TREE];

/**
 * 나무 밀도 0~1과 종류. 사진의 초록빛(숲), 위도(기후대), 고도(수목한계선)로 정한다.
 * color는 groundColor의 결과를 넘긴다.
 */
export function vegetation(color: number[], lat: number, h: number, slope: number): { density: number; kind: TreeKind } {
  const a = Math.abs(lat);
  if (h < 0.35 || slope > 0.7 || a > 70) return { density: 0, kind: TREE.none };
  const [r, g, b] = color;
  const sum = r + g + b + 1e-4;
  const green = g / sum;
  const dark = 1 - smooth(0.12, 0.45, sum / 3);
  let density = smooth(0.36, 0.46, green) * (0.35 + 0.65 * dark);
  const treeLine = snowLine(lat) - 9;
  density *= 1 - smooth(treeLine - 6, treeLine, h);
  if (density < 0.02) {
    // 메마른 땅에도 드문드문 덤불
    const shrub = smooth(0.33, 0.37, green) * 0.12;
    return { density: shrub, kind: shrub > 0 ? TREE.shrub : TREE.none };
  }
  let kind: TreeKind;
  if (a < 23) kind = h < 1.2 && green < 0.42 ? TREE.palm : TREE.broadleaf;
  else if (a < 47) kind = h > treeLine - 14 ? TREE.conifer : TREE.broadleaf;
  else if (a < 62) kind = TREE.conifer;
  else kind = TREE.birch;
  return { density, kind };
}
