import * as THREE from 'three';
import type { Terrain } from '../terrain/height';
export type Realm = 'surface' | 'cave' | 'sky';

const CAVE_X = -10;
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
    waterAt(x, z) { return isCave(x, z) ? -Infinity : (base.waterAt?.(x, z) ?? base.waterLevel ?? -Infinity); },
    height(x, z) {
      let y = base.height(x, z);
      const depth = clamp((-z - 8) / 90, 0, 1) * 27;
      const end = blend(Math.abs(z + 75), 65, 85);
      const cave = blend(Math.abs(x - CAVE_X), 3.5, 8) * end;
      const caveFloor = caveStart - depth;
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

export function isCave(x: number, z: number): boolean {
  return Math.abs(x - CAVE_X) < 8 && z < -22 && z > -145;
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
    const stone = new THREE.MeshLambertMaterial({ color: '#77746c', side: THREE.DoubleSide, flatShading: true });
    const roof = new THREE.BoxGeometry(10, 1.5, 2);
    const roofs = new THREE.InstancedMesh(roof, stone, 58);
    const stepGeo = new THREE.BoxGeometry(4.6, .18, 1.45);
    const steps = new THREE.InstancedMesh(stepGeo, new THREE.MeshLambertMaterial({ color: '#d5ccba' }), 134);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 58; i++) {
      const z = -25 - i * 2;
      dummy.position.set(CAVE_X, terrain.height(CAVE_X, z) + 5, z);
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); roofs.setMatrixAt(i, dummy.matrix);
    }
    for (let i = 0; i < 134; i++) {
      const z = -0.75 - i * 1.49;
      dummy.position.set(SKY_X, terrain.height(SKY_X, z) + .09, z);
      dummy.updateMatrix(); steps.setMatrixAt(i, dummy.matrix);
    }
    this.group.add(roofs, steps);
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
