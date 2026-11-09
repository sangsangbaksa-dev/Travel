import * as THREE from 'three';
import type { Terrain } from '../terrain/height';
import { CHUNK, mulberry32 } from './scatter';
import type { Realm } from './passages';

const orb = new THREE.SphereGeometry(1, 10, 7);
const caveBody = new THREE.MeshLambertMaterial({ color: '#9b90b8' });
const caveWing = new THREE.MeshLambertMaterial({ color: '#716b97', side: THREE.DoubleSide });
const skyBody = new THREE.MeshLambertMaterial({ color: '#e2e2d8' });
const skyAccent = new THREE.MeshLambertMaterial({ color: '#bda373' });
const eye = new THREE.MeshBasicMaterial({ color: '#354250' });
const wingGeo = new THREE.BufferGeometry();
wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.85, 0.13, -0.12, 0.62, -0.25, -0.2, 0, 0, 0, 0.62, -0.25, -0.2, 0.25, -0.12, -0.1], 3));
wingGeo.computeVertexNormals();

function ball(group: THREE.Group, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const mesh = new THREE.Mesh(orb, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  group.add(mesh);
}

type Creature = { group: THREE.Group; x: number; z: number; phase: number; wings?: THREE.Group[]; groundY: number; nextGroundSample: number };

function bat(): { group: THREE.Group; wings: THREE.Group[] } {
  const group = new THREE.Group();
  ball(group, caveBody, 0, 0, 0, 0.27, 0.28, 0.3);
  for (const side of [-1, 1]) {
    ball(group, caveBody, side * 0.17, 0.27, 0, 0.09, 0.2, 0.08);
    ball(group, eye, side * 0.1, 0.04, 0.27, 0.032, 0.04, 0.025);
  }
  const wings = [-1, 1].map(side => {
    const wing = new THREE.Group();
    wing.position.x = side * 0.2;
    const mesh = new THREE.Mesh(wingGeo, caveWing);
    mesh.scale.x = side;
    wing.add(mesh);
    group.add(wing);
    return wing;
  });
  return { group, wings };
}

function skyBird(): { group: THREE.Group; wings: THREE.Group[] } {
  const group = new THREE.Group();
  ball(group, skyBody, 0, 0, 0, 0.26, 0.2, 0.48);
  ball(group, skyBody, 0, 0.12, 0.4, 0.18, 0.18, 0.2);
  ball(group, skyAccent, 0, 0.08, 0.62, 0.07, 0.05, 0.14);
  for (const side of [-1, 1]) {
    ball(group, eye, side * 0.14, 0.15, 0.52, 0.025, 0.03, 0.025);
  }
  const wings = [-1, 1].map(side => {
    const wing = new THREE.Group();
    wing.position.x = side * 0.2;
    ball(wing, skyBody, side * 0.48, 0, 0, 0.55, 0.06, 0.2);
    group.add(wing);
    return wing;
  });
  return { group, wings };
}

/** 지하 박쥐와 하늘을 유영하는 작은 생명체. terrain은 현재 영역의 높이를 제공한다. */
export class RealmCreatures {
  readonly group = new THREE.Group();
  private mode: Realm = 'surface';
  private readonly chunks = new Map<string, Creature[]>();

  constructor(private readonly terrain: Terrain) {}

  update(mode: Realm, px: number, pz: number, time: number) {
    if (mode !== this.mode) {
      this.group.clear();
      this.chunks.clear();
      this.mode = mode;
    }
    this.group.visible = mode !== 'surface';
    if (mode === 'surface') return;
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.ensure(cx + dx, cz + dz);
    for (const [key, creatures] of this.chunks) {
      const [x, z] = key.split(',').map(Number);
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) > 1) {
        for (const creature of creatures) this.group.remove(creature.group);
        this.chunks.delete(key);
        continue;
      }
      for (const creature of creatures) {
        const t = time * 0.22 + creature.phase;
        const x = creature.x + Math.cos(t) * 1.8;
        const z = creature.z + Math.sin(t) * 1.8;
        if (time >= creature.nextGroundSample) {
          creature.groundY = this.terrain.height(x, z);
          creature.nextGroundSample = time + 0.2;
        }
        creature.group.position.set(x, creature.groundY + (mode === 'cave' ? 3.3 : 2.5) + Math.sin(time * 1.7 + creature.phase) * 0.35, z);
        creature.group.rotation.y = -t;
        creature.wings?.forEach((wing, i) => { wing.rotation.z = (i ? -1 : 1) * Math.sin(time * 9 + creature.phase) * 0.7; });
      }
    }
  }

  private ensure(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const rnd = mulberry32(Math.imul(cx, 6736387) ^ Math.imul(cz, 83492791) ^ 1432);
    const creatures: Creature[] = [];
    for (let i = 0; i < 3; i++) {
      const x = (cx + 0.15 + rnd() * 0.7) * CHUNK;
      const z = (cz + 0.15 + rnd() * 0.7) * CHUNK;
      const phase = rnd() * Math.PI * 2;
      const creature: Creature = { ...(this.mode === 'cave' ? bat() : skyBird()), x, z, phase, groundY: 0, nextGroundSample: 0 };
      creatures.push(creature);
      this.group.add(creature.group);
    }
    this.chunks.set(key, creatures);
  }
}
