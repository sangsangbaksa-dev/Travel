import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Terrain } from '../terrain/height';
import { SETTLEMENTS } from './settlement-layout';

const bodyGeo = new RoundedBoxGeometry(0.9, 0.9, 0.9, 3, 0.13);
const eyeGeo = new THREE.SphereGeometry(0.055, 8, 6);
const eyeMat = new THREE.MeshBasicMaterial({ color: '#35404a' });
const bodyMats = ['#f2c58e', '#a5d8ce', '#bcafe3', '#f2a7ac', '#c6d98d', '#9fc3e5'].map(
  color => new THREE.MeshLambertMaterial({ color }),
);

/** 광장 주변을 느긋하게 걷는 큐브 주민들. */
export class Residents {
  readonly group = new THREE.Group();
  private readonly residents: { mesh: THREE.Group; x: number; z: number; radius: number; phase: number; groundY: number; nextGroundSample: number }[] = [];

  constructor(private readonly terrain: Terrain) {
    for (const [index, { x, z }] of SETTLEMENTS.entries()) {
      const count = [4, 3, 6][index];
      for (let i = 0; i < count; i++) {
        const mesh = new THREE.Group();
        const body = new THREE.Mesh(bodyGeo, bodyMats[(i + count) % bodyMats.length]);
        body.position.y = 0.45;
        mesh.add(body);
        for (const side of [-1, 1]) {
          const eye = new THREE.Mesh(eyeGeo, eyeMat);
          eye.scale.set(1, 1.25, 0.55);
          eye.position.set(side * 0.17, 0.53, 0.451);
          mesh.add(eye);
        }
        this.group.add(mesh);
        // 광장 안에서만 걸으며 가운데 나무와 탑을 피해 돈다.
        this.residents.push({ mesh, x, z, radius: 2.6 + (i % 3) * 0.25, phase: i * Math.PI * 2 / count, groundY: 0, nextGroundSample: 0 });
      }
    }
  }

  update(time: number) {
    for (const resident of this.residents) {
      const t = time * 0.12 + resident.phase;
      const x = resident.x + Math.cos(t) * resident.radius;
      const z = resident.z + Math.sin(t) * resident.radius;
      if (time >= resident.nextGroundSample) {
        // 포석은 각 타일 중심의 지면 또는 수면 위에 놓인다.
        const tileX = resident.x + Math.round((x - resident.x) / 1.25) * 1.25;
        const tileZ = resident.z + Math.round((z - resident.z) / 1.25) * 1.25;
        resident.groundY = Math.max(this.terrain.height(tileX, tileZ), this.terrain.waterLevel ?? -Infinity) + 0.07;
        resident.nextGroundSample = time + 0.2;
      }
      resident.mesh.position.set(x, resident.groundY + Math.abs(Math.sin(time * 3 + resident.phase)) * 0.08, z);
      resident.mesh.rotation.y = -t;
    }
  }
}
