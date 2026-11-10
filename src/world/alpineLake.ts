import * as THREE from 'three';
import { noise2, waterHeightAt, type Terrain } from '../terrain/height';
import { Water } from './water';

export const ALPINE_LAKE = { x: -144, z: -102, level: 13 } as const;
const RADIUS_X = 24, RADIUS_Z = 31;
const clamp = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const outline = (a: number) => 1 + .085 * Math.sin(a * 3 + .5) + .06 * Math.cos(a * 5 - .8) + .035 * Math.sin(a * 7);

/** 불규칙한 빙하호의 해안선을 수면 메시와 지형이 함께 사용한다. */
export function alpineDistance(x: number, z: number): number {
  const dx = (x - ALPINE_LAKE.x) / RADIUS_X, dz = (z - ALPINE_LAKE.z) / RADIUS_Z;
  const r = Math.hypot(dx, dz);
  return r > 2.3 ? r : r / outline(Math.atan2(dz, dx));
}

export function createAlpineTerrain(base: Terrain): Terrain {
  return {
    ...base,
    height(x, z) {
      const h = base.height(x, z);
      const r = alpineDistance(x, z);
      if (r >= 1.96) return h;
      if (r <= 1) return ALPINE_LAKE.level - (1 - r * r) * (7.8 + .65 * noise2(x * .1, z * .1, 719));
      const north = smooth((ALPINE_LAKE.z - z + 7) / 29);
      const hillside = 3.3 + north * (21 + noise2(x * .09, z * .09, 727) * 12);
      const slope = ALPINE_LAKE.level + hillside * smooth((r - 1) / .44);
      return THREE.MathUtils.lerp(slope, h, smooth((r - 1.28) / .68));
    },
    waterAt(x, z) {
      return alpineDistance(x, z) <= 1.025 ? ALPINE_LAKE.level : waterHeightAt(base, x, z);
    },
  };
}

export function makeAlpineLake(): Water {
  const segments = 96;
  const points = [0, 0, 0];
  const triangles: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i * Math.PI * 2 / segments, radius = outline(a) * 1.018;
    points.push(Math.cos(a) * RADIUS_X * radius, 0, Math.sin(a) * RADIUS_Z * radius);
    triangles.push(0, 1 + (i + 1) % segments, i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return new Water(ALPINE_LAKE.level, { geometry, x: ALPINE_LAKE.x, z: ALPINE_LAKE.z, color: '#3f9088' });
}
