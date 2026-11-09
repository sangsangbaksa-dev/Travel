import * as THREE from 'three';
import type { Terrain } from '../terrain/height';
import { CHUNK, mulberry32 } from './scatter';

type Animal = {
  group: THREE.Group;
  wings?: THREE.Group[];
  x: number;
  z: number;
  phase: number;
  bird: boolean;
  groundY: number;
  nextGroundSample: number;
  overWater: boolean;
};

// 기하와 재료는 모든 생명체가 공유한다.
const sphere = new THREE.SphereGeometry(1, 10, 7);
const colors = {
  cream: new THREE.MeshLambertMaterial({ color: '#f5e6ce' }),
  brown: new THREE.MeshLambertMaterial({ color: '#bc8868' }),
  shell: new THREE.MeshLambertMaterial({ color: '#638e76' }),
  skin: new THREE.MeshLambertMaterial({ color: '#b4c98d' }),
  blue: new THREE.MeshLambertMaterial({ color: '#79baca' }),
  white: new THREE.MeshLambertMaterial({ color: '#f5f3e8' }),
  dark: new THREE.MeshLambertMaterial({ color: '#39464c' }),
  beak: new THREE.MeshLambertMaterial({ color: '#e8b66b' }),
};

function part(parent: THREE.Group, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const mesh = new THREE.Mesh(sphere, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  parent.add(mesh);
  return mesh;
}

function rabbit(tan: boolean): THREE.Group {
  const group = new THREE.Group();
  const fur = tan ? colors.brown : colors.cream;
  part(group, fur, 0, 0.35, 0, 0.36, 0.3, 0.48);
  part(group, fur, 0, 0.53, 0.38, 0.27, 0.26, 0.25);
  for (const x of [-0.13, 0.13]) {
    const ear = part(group, fur, x, 0.86, 0.36, 0.075, 0.3, 0.08);
    ear.rotation.z = x * -0.8;
    part(group, colors.dark, x * 1.25, 0.56, 0.58, 0.028, 0.035, 0.025);
    part(group, fur, x * 1.3, 0.11, 0.18, 0.11, 0.1, 0.16);
  }
  part(group, colors.white, 0, 0.35, -0.46, 0.13, 0.13, 0.13);
  return group;
}

function turtle(): THREE.Group {
  const group = new THREE.Group();
  part(group, colors.skin, 0, 0.19, 0, 0.35, 0.16, 0.43);
  part(group, colors.shell, 0, 0.29, -0.03, 0.4, 0.25, 0.45);
  part(group, colors.skin, 0, 0.2, 0.47, 0.18, 0.15, 0.22);
  for (const x of [-0.27, 0.27]) {
    for (const z of [-0.25, 0.25]) part(group, colors.skin, x, 0.09, z, 0.12, 0.09, 0.16);
    part(group, colors.dark, x * 0.43, 0.24, 0.64, 0.025, 0.03, 0.02);
  }
  return group;
}

function bird(): { group: THREE.Group; wings: THREE.Group[] } {
  const group = new THREE.Group();
  part(group, colors.blue, 0, 0, 0, 0.3, 0.23, 0.42);
  part(group, colors.white, 0, -0.12, 0.16, 0.23, 0.12, 0.25);
  part(group, colors.blue, 0, 0.13, 0.34, 0.2, 0.2, 0.2);
  part(group, colors.beak, 0, 0.08, 0.54, 0.07, 0.05, 0.12);
  for (const x of [-0.16, 0.16]) part(group, colors.dark, x, 0.17, 0.47, 0.025, 0.03, 0.025);
  const wings = [-1, 1].map((side) => {
    const wing = new THREE.Group();
    wing.position.x = side * 0.2;
    part(wing, colors.blue, side * 0.32, 0, -0.02, 0.4, 0.06, 0.2);
    group.add(wing);
    return wing;
  });
  return { group, wings };
}

/** 주변 청크의 작은 동물과 새. 이동하면 먼 개체는 제거하고 같은 위치에 다시 생성한다. */
export class CreatureField {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Animal[]>();

  constructor(private readonly terrain: Terrain) {}

  update(px: number, pz: number, time: number) {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.ensure(cx + dx, cz + dz);
    for (const [key, animals] of this.chunks) {
      const [x, z] = key.split(',').map(Number);
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) > 1) {
        for (const animal of animals) this.group.remove(animal.group);
        this.chunks.delete(key);
        continue;
      }
      for (const animal of animals) {
        const t = time * (animal.bird ? 0.25 : 0.14) + animal.phase;
        const radius = animal.bird ? 3.5 : 1.1;
        let x = animal.x + Math.cos(t) * radius;
        let z = animal.z + Math.sin(t) * radius;
        if (time >= animal.nextGroundSample) {
          const height = this.terrain.height(x, z);
          animal.overWater = !animal.bird && height < (this.terrain.waterLevel ?? -Infinity) + 0.15;
          animal.groundY = animal.overWater ? this.terrain.height(animal.x, animal.z) : Math.max(height, this.terrain.waterLevel ?? -Infinity);
          // 비싼 지형 샘플은 초당 약 7번이면 작은 동물의 느린 이동에 충분하다.
          animal.nextGroundSample = time + 0.15;
        }
        if (animal.overWater) { x = animal.x; z = animal.z; }
        animal.group.position.set(x, animal.groundY + (animal.bird ? 4.5 + Math.sin(time * 1.6 + animal.phase) * 0.3 : Math.abs(Math.sin(time * 2 + animal.phase)) * 0.05), z);
        animal.group.rotation.y = -t;
        if (animal.wings) animal.wings.forEach((wing, i) => { wing.rotation.z = (i === 0 ? 1 : -1) * Math.sin(time * 8 + animal.phase) * 0.55; });
      }
    }
  }

  private ensure(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const rnd = mulberry32(Math.imul(cx, 92837111) ^ Math.imul(cz, 689287499) ^ 4921);
    const animals: Animal[] = [];
    for (let i = 0; i < 3; i++) {
      const x = (cx + 0.12 + rnd() * 0.76) * CHUNK;
      const z = (cz + 0.12 + rnd() * 0.76) * CHUNK;
      const phase = rnd() * Math.PI * 2;
      const kind = rnd();
      const isBird = kind > 0.7;
      if (!isBird && this.terrain.height(x, z) < (this.terrain.waterLevel ?? -Infinity) + 1.5) continue;
      const made = isBird ? bird() : { group: kind < 0.45 ? rabbit(kind < 0.2) : turtle(), wings: undefined };
      const animal: Animal = { ...made, x, z, phase, bird: isBird, groundY: 0, nextGroundSample: 0, overWater: false };
      animals.push(animal);
      this.group.add(animal.group);
    }
    this.chunks.set(key, animals);
  }
}
