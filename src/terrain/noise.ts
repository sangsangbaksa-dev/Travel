// 시드 기반 2D 그래디언트 노이즈
function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(ix: number, iz: number, fx: number, fz: number, seed: number): number {
  const a = hash2(ix, iz, seed) * Math.PI * 2;
  return Math.cos(a) * fx + Math.sin(a) * fz;
}

export function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const n00 = grad(ix, iz, fx, fz, seed);
  const n10 = grad(ix + 1, iz, fx - 1, fz, seed);
  const n01 = grad(ix, iz + 1, fx, fz - 1, seed);
  const n11 = grad(ix + 1, iz + 1, fx - 1, fz - 1, seed);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.41; // 대략 [-1, 1]
}
