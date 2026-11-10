// 3차원 그래디언트 노이즈. 구 표면 위의 점에 바로 쓸 수 있어서 이음매나 극점 왜곡이 없다.
const PERM = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 2463534242;
  for (let i = 255; i > 0; i--) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const j = (s >>> 0) % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

const G = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1],
  [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
];

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h: number, x: number, y: number, z: number) {
  const g = G[h & 15];
  return g[0] * x + g[1] * y + g[2] * z;
}

/** 대략 -1~1 */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  x -= xi; y -= yi; z -= zi;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return 1.4 * l(
    l(l(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      l(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
    l(l(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      l(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
}

/** 여러 옥타브를 겹친 노이즈 */
export function fbm3(x: number, y: number, z: number, octaves: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * f + i * 17.3, y * f - i * 9.1, z * f + i * 5.7) * amp;
    norm += amp; amp *= gain; f *= 2.03;
  }
  return sum / norm;
}

/** 뾰족한 능선 노이즈 0~1 */
export function ridged3(x: number, y: number, z: number, octaves: number): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise3(x * f + i * 31.7, y * f + i * 7.9, z * f - i * 13.1));
    sum += n * n * amp;
    norm += amp; amp *= 0.5; f *= 2.1;
  }
  return sum / norm;
}
