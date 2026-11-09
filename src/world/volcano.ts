import * as THREE from 'three';
import type { Terrain } from '../terrain/height';

export const VOLCANO = { x: 240, z: 160 } as const;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const innerFloor = 9 + 78 * (1 - 8 / 110) - 20;

/** 화산 원뿔과 분화구를 실제 지형 높이에 통합한다. */
export function createVolcanicTerrain(base: Terrain): Terrain {
  return {
    ...base,
    height(x, z) {
      const h = base.height(x, z);
      const r = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
      if (r >= 125) return h;
      const influence = 1 - smooth((r - 95) / 30);
      const cone = 9 + 78 * (1 - Math.max(8, r) / 110);
      const crater = 20 * (1 - smooth((r - 8) / 12));
      return h + (cone - crater - h) * influence;
    },
  };
}

export class Volcano {
  readonly group = new THREE.Group();
  private readonly smoke: THREE.Mesh[] = [];
  constructor() {
    const lava = new THREE.Mesh(
      new THREE.CircleGeometry(7.3, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#d85925' }),
    );
    lava.position.set(VOLCANO.x, innerFloor + .12, VOLCANO.z);
    this.group.add(lava);
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    const material = new THREE.MeshLambertMaterial({ color: '#a7a49d', transparent: true, opacity: .3, depthWrite: false });
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(geometry, material);
      this.smoke.push(puff); this.group.add(puff);
    }
  }
  update(time: number) {
    this.smoke.forEach((puff, i) => {
      const age = (time * .35 + i * 1.7) % 10;
      puff.position.set(VOLCANO.x + Math.sin(age * .4 + i) * age * .25, innerFloor + 5 + age * 1.6, VOLCANO.z + Math.cos(i * 2) * age * .15);
      puff.scale.setScalar(1.3 + age * .3);
    });
  }
}
