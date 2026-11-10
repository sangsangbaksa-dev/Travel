import * as THREE from 'three';
import type { Terrain } from '../terrain/height';

export type WreckSite = { x: number; z: number; y: number };

/** 육지에서 가장 가까운 깊고 완만한 해저를 찾는다. */
export function findWreckSite(terrain: Terrain): WreckSite | null {
  const water = terrain.waterLevel;
  if (water === undefined || !Number.isFinite(water)) return null;
  for (let radius = 96; radius <= 1536; radius += 32) {
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI * 2 / 32;
      const x = Math.round(Math.cos(angle) * radius), z = Math.round(Math.sin(angle) * radius);
      const heights = [[0, 0], [-4, -2], [4, -2], [-4, 2], [4, 2]].map(([dx, dz]) => terrain.height(x + dx, z + dz));
      const high = Math.max(...heights), low = Math.min(...heights);
      if (water - high >= 14 && high - low < 1.5) return { x, z, y: high };
    }
  }
  return null;
}

/** 해저에 가라앉은 작은 선박과 흩어진 암석. */
export class DeepSea {
  readonly group = new THREE.Group();
  readonly site: WreckSite | null;

  constructor(terrain: Terrain) {
    this.site = findWreckSite(terrain);
    this.group.visible = false;
    if (!this.site) return;
    const { x, z, y } = this.site;
    const bed: number[] = [];
    for (const ix of [-3, 0, 3]) for (const iz of [-1.2, 0, 1.2]) bed.push(terrain.height(x + ix, z + iz));
    const low = Math.min(...bed), high = Math.max(y, ...bed);
    const sink = Math.max(0, high - low);
    this.group.position.set(x, high, z);
    const wood = new THREE.MeshLambertMaterial({ color: '#625a4a' });
    const dark = new THREE.MeshLambertMaterial({ color: '#484b42' });
    const stone = new THREE.MeshLambertMaterial({ color: '#6f7d78', flatShading: true });
    const plank = new THREE.BoxGeometry(1, 1, 1);
    const add = (px: number, py: number, pz: number, sx: number, sy: number, sz: number, material = wood) => {
      const part = new THREE.Mesh(plank, material);
      part.position.set(px, py, pz); part.scale.set(sx, sy, sz);
      this.group.add(part); return part;
    };
    add(0, .35 - sink / 2, 0, 8, .7 + sink, 3.3);
    add(0, 1.15, -1.5, 8, 1.4, .3);
    add(-1.8, 1, 1.5, 4.3, 1.1, .3);
    add(-3.8, 1.05, 0, .35, 1.2, 3);
    const mast = add(-1.1, 2.2, 0, .25, 4.2, .25, dark);
    mast.rotation.z = -.35;
    add(1.8, .9, .4, 1.1, .9, 1, dark);
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, stone, 16);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 16; i++) {
      const a = i * 2.4, r = 7 + (i % 4) * 2.5;
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      const floor = terrain.height(x + dx, z + dz);
      const size = .4 + (i % 3) * .25;
      dummy.position.set(dx, floor - high + size * .6, dz);
      dummy.scale.set(size, size * .6, size * 1.2); dummy.rotation.y = a;
      dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    }
    this.group.add(rocks);
  }

  update(x: number, z: number, underwater: boolean) {
    this.group.visible = !!this.site && underwater && Math.hypot(x - this.site.x, z - this.site.z) < 100;
  }
}
