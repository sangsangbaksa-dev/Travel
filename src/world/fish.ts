import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from '../terrain/height';

const body = new THREE.SphereGeometry(1, 8, 6);
body.scale(.34, .15, .12);
const tail = new THREE.ConeGeometry(.15, .28, 5);
tail.rotateZ(-Math.PI / 2); tail.translate(-.36, 0, 0);
const fishGeometry = mergeGeometries([body, tail]);
body.dispose(); tail.dispose();
const material = new THREE.MeshLambertMaterial({ color: '#ffffff' });
const COUNT = 24;
const dummy = new THREE.Object3D();
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
interface School { x: number; z: number; y: number; active: boolean; phase: number }

/** 수심이 충분한 곳에 나타나는 작은 물고기 떼. 모든 물고기를 한 번에 그린다. */
export class FishSchools {
  readonly mesh = new THREE.InstancedMesh(fishGeometry, material, COUNT);
  private schools: School[] = [];
  private sampleTimer = 0;
  constructor(private readonly terrain: Terrain) {
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colors = ['#f5c89c', '#b8e2d2', '#d5d4f2', '#f0d98c'];
    for (let i = 0; i < COUNT; i++) this.mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
  }
  update(x: number, z: number, time: number, dt: number, visible: boolean) {
    this.mesh.visible = visible;
    if (!visible) return;
    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0 || !this.schools.length) {
      this.sampleTimer = .5;
      const cx = Math.floor(x / 12), cz = Math.floor(z / 12);
      this.schools = Array.from({ length: 6 }, (_, i) => {
        const angle = i * Math.PI * 2 / 6;
        const sx = cx * 12 + 6 + Math.cos(angle) * (7 + hash(cx * 13 + cz * 7 + i) * 7);
        const sz = cz * 12 + 6 + Math.sin(angle) * (7 + hash(cx * 3 + cz * 19 + i + 8) * 7);
        // 물고기의 움직임 범위와 지형 굴곡을 함께 고려한다.
        const floor = Math.max(...[[0,0],[-2,0],[2,0],[0,-2],[0,2]].map(([dx,dz]) => this.terrain.height(sx+dx, sz+dz)));
        const water = this.terrain.waterLevel ?? -Infinity;
        const active = water - floor > 1.5;
        return { x: sx, z: sz, y: active ? floor + Math.min((water - floor) * .45, 3) : 0, active, phase: hash(i + cx * 11 + cz * 23) * Math.PI * 2 };
      });
    }
    for (let i = 0; i < COUNT; i++) {
      const school = this.schools[Math.floor(i / 4)], member = i % 4;
      if (!school.active) { dummy.scale.setScalar(0); }
      else {
        const phase = time * .55 + school.phase + member * .7;
        dummy.position.set(school.x + Math.cos(phase) * .8 + (member - 1.5) * .32, school.y + Math.sin(phase * 1.3) * .12, school.z + Math.sin(phase) * .8 + (member % 2) * .35);
        dummy.rotation.set(0, -phase - Math.PI / 2, 0);
        dummy.scale.setScalar(1);
      }
      dummy.updateMatrix(); this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
