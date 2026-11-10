import * as THREE from 'three';
import { waterHeightAt, type Terrain } from '../terrain/height';
import { dominantBiome, type Biome, BIOMES } from '../terrain/biome';
import { CHUNK, mulberry32 } from './scatter';
import { inSettlement } from './settlement-layout';

type Animal = {
  group: THREE.Group;
  wings?: THREE.Group[];
  x: number;
  z: number;
  phase: number;
  bird: boolean;
  species: Species;
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
  fox: new THREE.MeshLambertMaterial({ color: '#d99b64' }),
  goat: new THREE.MeshLambertMaterial({ color: '#d7d5ca' }),
  horn: new THREE.MeshLambertMaterial({ color: '#81776c' }),
  parrot: new THREE.MeshLambertMaterial({ color: '#60a989' }),
};

export type Species = 'rabbit' | 'deer' | 'fox' | 'goat' | 'turtle' | 'bird' | 'parrot';

/** 고도가 높은 곳은 기후와 관계없이 고산 서식지로 취급한다. */
export function creatureSpecies(biome: Biome, height: number, roll: number): Species {
  if (height > 17 || biome === 'snow') return roll < 0.7 ? 'goat' : 'bird';
  switch (biome) {
    case 'desert': return roll < 0.75 ? 'fox' : 'bird';
    case 'tropical': return roll < 0.45 ? 'turtle' : 'parrot';
    case 'autumn': return roll < 0.65 ? 'deer' : 'bird';
    case 'blossom': return roll < 0.5 ? 'deer' : 'bird';
    case 'crystal': return roll < 0.55 ? 'goat' : 'bird';
    case 'mushroom': return roll < 0.55 ? 'deer' : 'bird';
    default: return roll < 0.48 ? 'rabbit' : roll < 0.72 ? 'deer' : 'bird';
  }
}

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

function bird(tropical = false): { group: THREE.Group; wings: THREE.Group[] } {
  const group = new THREE.Group();
  const plumage = tropical ? colors.parrot : colors.blue;
  part(group, plumage, 0, 0, 0, 0.3, 0.23, 0.42);
  part(group, colors.white, 0, -0.12, 0.16, 0.23, 0.12, 0.25);
  part(group, plumage, 0, 0.13, 0.34, 0.2, 0.2, 0.2);
  part(group, colors.beak, 0, 0.08, 0.54, 0.07, 0.05, 0.12);
  for (const x of [-0.16, 0.16]) part(group, colors.dark, x, 0.17, 0.47, 0.025, 0.03, 0.025);
  const wings = [-1, 1].map((side) => {
    const wing = new THREE.Group();
    wing.position.x = side * 0.2;
    part(wing, plumage, side * 0.32, 0, -0.02, 0.4, 0.06, 0.2);
    group.add(wing);
    return wing;
  });
  return { group, wings };
}

function quadruped(species: 'fox' | 'deer' | 'goat'): THREE.Group {
  const group = new THREE.Group();
  const fox = species === 'fox', goat = species === 'goat';
  const fur = fox ? colors.fox : goat ? colors.goat : colors.brown;
  const height = fox ? 0.45 : 0.75;
  part(group, fur, 0, height, 0, fox ? 0.25 : 0.29, 0.25, fox ? 0.46 : 0.51);
  part(group, fur, 0, height + 0.18, 0.48, 0.21, 0.23, 0.25);
  for (const side of [-1, 1]) {
    for (const z of [-0.3, 0.3]) part(group, fur, side * 0.18, height / 2, z, 0.065, height / 2, 0.07);
    const ear = part(group, fur, side * 0.16, height + 0.45, 0.43, 0.09, fox ? 0.23 : 0.14, 0.07);
    ear.rotation.z = -side * 0.3;
    part(group, colors.dark, side * 0.12, height + 0.2, 0.68, 0.025, 0.035, 0.022);
    if (goat) {
      const horn = part(group, colors.horn, side * 0.12, height + 0.48, 0.31, 0.05, 0.22, 0.06);
      horn.rotation.x = -0.5;
    }
  }
  if (fox) {
    const tail = part(group, fur, 0, height + 0.07, -0.65, 0.19, 0.18, 0.45);
    tail.rotation.x = -0.35;
    part(group, colors.cream, 0, height + 0.18, -0.98, 0.13, 0.12, 0.15);
  }
  return group;
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
        const t = time * (animal.bird ? 0.18 : animal.species === 'turtle' ? 0.035 : 0.08) + animal.phase;
        const radius = animal.bird ? 3.5 : 1.1;
        let x = animal.x + Math.cos(t) * radius;
        let z = animal.z + Math.sin(t) * radius;
        const hop = animal.species === 'rabbit' ? Math.abs(Math.sin(time * 2 + animal.phase)) * 0.05 : 0;
        // 새는 커진 수관(약 7~11) 위로 난다. 땅 동물은 발밑 지면을 매 프레임 따라 파고들거나 뜨지 않는다.
        const altitude = animal.bird ? 10.5 + Math.sin(time * 1.6 + animal.phase) * 0.45 : hop;
        if (animal.bird) {
          if (time >= animal.nextGroundSample) {
            animal.groundY = Math.max(this.terrain.height(x, z), waterHeightAt(this.terrain, x, z));
            animal.nextGroundSample = time + 0.15;
          }
        } else {
          const height = this.terrain.height(x, z);
          const water = waterHeightAt(this.terrain, x, z);
          animal.overWater = height < water + 0.15;
          if (animal.overWater) { x = animal.x; z = animal.z; }
          animal.groundY = animal.overWater ? this.terrain.height(animal.x, animal.z) : Math.max(height, water);
        }
        animal.group.position.set(x, animal.groundY + altitude, z);
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
      const roll = rnd();
      const height = this.terrain.height(x, z);
      const biome = this.terrain.climate ? BIOMES[dominantBiome(this.terrain.climate(x, z))] : 'meadow';
      const species = creatureSpecies(biome, height, roll);
      const isBird = species === 'bird' || species === 'parrot';
      if (!isBird && height < waterHeightAt(this.terrain, x, z) + 1.5) continue;
      if (!isBird && inSettlement(x, z)) continue;
      if (!isBird && species !== 'goat' && Math.max(Math.abs(this.terrain.height(x + 1, z) - height), Math.abs(this.terrain.height(x, z + 1) - height)) > 1) continue;
      const made = isBird ? bird(species === 'parrot') : { group: species === 'rabbit' ? rabbit(roll < 0.2) : species === 'turtle' ? turtle() : quadruped(species as 'fox' | 'deer' | 'goat'), wings: undefined };
      const animal: Animal = { ...made, x, z, phase, species, bird: isBird, groundY: 0, nextGroundSample: 0, overWater: false };
      animals.push(animal);
      this.group.add(animal.group);
    }
    this.chunks.set(key, animals);
  }
}
