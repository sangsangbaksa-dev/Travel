import * as THREE from 'three';
import type { Terrain } from '../terrain/height';
import type { Obstacle } from '../physics/world';
export type Realm = 'surface' | 'cave' | 'sky';

export const CAVE = { x: -10, halfWidth: 8, front: 10, back: -160, roofFront: -24, roofBack: -143, endWall: -139 } as const;
const CAVE_X = CAVE.x;
const SKY_X = 12;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const blend = (distance: number, inner: number, outer: number) => {
  const t = clamp((distance - inner) / (outer - inner), 0, 1);
  return 1 - t * t * (3 - 2 * t);
};

/** 통로는 기존 지형 높이를 직접 바꾸므로 렌더링과 물리가 같은 길을 따른다. */
export function createPassageTerrain(base: Terrain): Terrain {
  const caveStart = base.height(CAVE_X, 0);
  const stairStart = base.height(SKY_X, 0);
  return {
    waterLevel: base.waterLevel,
    climate: base.climate,
    waterAt(x, z) { return isCaveCut(x, z) ? -Infinity : (base.waterAt?.(x, z) ?? base.waterLevel ?? -Infinity); },
    height(x, z) {
      let y = base.height(x, z);
      const depth = clamp((-z - 8) / 90, 0, 1) * 27;
      const end = blend(Math.abs(z + 75), 65, 85);
      const fromCave = Math.abs(x - CAVE_X);
      const rim = blend(fromCave, 8.25, 11) * end;
      // 주변이 바다여도 굴의 벽과 막다른 끝은 수면 위의 암반과 이어진다.
      y += Math.max(0, caveStart - y) * rim;
      const cave = blend(fromCave, 3.5, CAVE.halfWidth) * end;
      const closedEnd = blend(z - CAVE.back, 10, 27);
      const caveFloor = caveStart - depth * (1 - closedEnd);
      y += (caveFloor - y) * cave;
      const stairIndex = Math.floor(clamp(-z, 0, 200) / 1.49);
      const stairHeight = stairStart + stairIndex * (70 / 134);
      const along = z <= 0 && z >= -200 ? 1 : 0;
      const lane = blend(Math.abs(x - SKY_X), 2.3, 5) * along;
      const summit = blend(Math.hypot(x - SKY_X, z + 202), 10, 25);
      const weight = Math.max(lane, summit);
      return y + (stairHeight - y) * weight;
    },
  };
}

export function isCaveCut(x: number, z: number): boolean {
  return Math.abs(x - CAVE_X) < CAVE.halfWidth && z < CAVE.front && z > CAVE.back;
}

export function isCave(x: number, z: number): boolean {
  return isCaveCut(x, z) && z <= CAVE.roofFront && z >= CAVE.roofBack;
}

export function caveCeilingAt(terrain: Terrain, x: number, z: number): number {
  const offset = Math.abs(x - CAVE_X);
  const floor = terrain.height(CAVE_X, Math.max(z, -134));
  const crown = floor + 5.25 - 2.7 * (offset / CAVE.halfWidth) ** 2;
  const arch = crown + Math.sin(z * .61 + x * .42) * .18;
  return THREE.MathUtils.lerp(terrain.height(x, z) - .5, arch, blend(offset, 3.5, CAVE.halfWidth));
}

const endWall: readonly Obstacle[] = [-4.5, -2.25, 0, 2.25, 4.5].map(dx => ({
  x: CAVE.x + dx, z: CAVE.endWall, r: 2.45, top: Infinity,
}));

export function caveObstacles(x: number, z: number): readonly Obstacle[] {
  return isCaveCut(x, z) && z < -134 ? endWall : [];
}

function caveRoof(terrain: Terrain): THREE.Mesh {
  const across = 16, length = CAVE.roofFront - CAVE.roofBack, row = across + 1;
  const layer = row * (length + 1);
  const vertices = new Float32Array(layer * 2 * 3);
  const colors = new Float32Array(vertices.length);
  const underside = new THREE.Color('#655f57'), outside = new THREE.Color('#8a8173');
  const tint = new THREE.Color();
  const indices: number[] = [];
  for (let j = 0; j <= length; j++) {
    const z = CAVE.roofFront - j;
    for (let i = 0; i <= across; i++) {
      const x = CAVE_X + (i / across * 2 - 1) * CAVE.halfWidth;
      const y = caveCeilingAt(terrain, x, z);
      const v = j * row + i;
      vertices.set([x, y, z], v * 3);
      vertices.set([x, y + 1.3 + .3 * Math.sin(x * .6 + z * .33), z], (v + layer) * 3);
      const variation = .91 + .07 * Math.sin(z * .51 + x * .65) + .04 * Math.sin(x * 1.7 - z * 1.43);
      tint.copy(underside).multiplyScalar(variation).toArray(colors, v * 3);
      tint.copy(outside).multiplyScalar(variation).toArray(colors, (v + layer) * 3);
      if (i < across && j < length) {
        indices.push(v, v + row, v + 1, v + 1, v + row, v + row + 1);
        const top = v + layer;
        indices.push(top, top + 1, top + row, top + 1, top + row + 1, top + row);
      }
      // 두 표면을 이어 입구에서 암반의 두께가 보이게 한다.
      const edge = (a: number, b: number) => indices.push(a, b, a + layer, b, b + layer, a + layer);
      if (i < across && (j === 0 || j === length)) edge(v, v + 1);
      if (j < length && (i === 0 || i === across)) edge(v, v + row);
    }
  }
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  roof.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  roof.setIndex(indices);
  roof.computeVertexNormals();
  return new THREE.Mesh(roof, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }));
}

export function passageZone(x: number, z: number): Realm {
  if (isCave(x, z)) return 'cave';
  if (Math.abs(x - SKY_X) < 22 && z < -175 && z > -235) return 'sky';
  return 'surface';
}

export function inPassage(x: number, z: number): boolean {
  return (Math.abs(x - CAVE_X) < 10 && z < 4 && z > -160) || (Math.abs(x - SKY_X) < 9 && z < 4 && z > -210) || Math.hypot(x - SKY_X, z + 202) < 27;
}

export class Passages {
  readonly group = new THREE.Group();
  constructor(terrain: Terrain) {
    const stepGeo = new THREE.BoxGeometry(4.6, .18, 1.45);
    const steps = new THREE.InstancedMesh(stepGeo, new THREE.MeshLambertMaterial({ color: '#d5ccba' }), 134);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 134; i++) {
      const z = -0.75 - i * 1.49;
      dummy.position.set(SKY_X, terrain.height(SKY_X, z) + .09, z);
      dummy.updateMatrix(); steps.setMatrixAt(i, dummy.matrix);
    }
    this.group.add(caveRoof(terrain), steps);
    // 구름 위 전망대: 계단의 끝과 같은 지면에 놓인다.
    const summitY = terrain.height(SKY_X, -202);
    const columnGeo = new THREE.CylinderGeometry(.34, .4, 4, 10);
    const marble = new THREE.MeshLambertMaterial({ color: '#e8e1d0' });
    for (const dx of [-5, 5]) for (const dz of [-5, 5]) {
      const column = new THREE.Mesh(columnGeo, marble);
      column.position.set(SKY_X + dx, summitY + 2, -202 + dz);
      this.group.add(column);
    }
  }
}
