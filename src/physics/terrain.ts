// 물리가 쓰는 지형 인터페이스. 지역 좌표 (x, z)의 지면 높이와 수면 높이를 돌려준다.
export interface Terrain {
  height(x: number, z: number): number;
  /** 수면 높이. 없으면 물이 없는 지형 */
  waterLevel?: number;
  waterAt?(x: number, z: number): number;
}

export function waterHeightAt(terrain: Terrain, x: number, z: number): number {
  return terrain.waterAt?.(x, z) ?? terrain.waterLevel ?? -Infinity;
}

export function surfaceNormal(
  t: Terrain,
  x: number,
  z: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 },
): { x: number; y: number; z: number } {
  const e = 0.3;
  const dx = t.height(x + e, z) - t.height(x - e, z);
  const dz = t.height(x, z + e) - t.height(x, z - e);
  const nx = -dx / (2 * e);
  const nz = -dz / (2 * e);
  const len = Math.hypot(nx, 1, nz);
  out.x = nx / len;
  out.y = 1 / len;
  out.z = nz / len;
  return out;
}
