import * as THREE from 'three';
import type { PickupField } from './pickups';

// 별 조각 렌더링: 큐브 주변의 아직 못 먹은 별을 빙글빙글 돌며 둥실 떠 있게 그린다.
const MAX = 200;

function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.23;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2,
  });
  g.translate(0, 0, -0.08);
  return g;
}

export class StarField {
  readonly mesh: THREE.InstancedMesh;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(private readonly field: PickupField) {
    this.mesh = new THREE.InstancedMesh(
      starGeometry(),
      new THREE.MeshLambertMaterial({ color: '#ffd45e', emissive: '#ffae00', emissiveIntensity: 0.6 }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(x: number, z: number, time: number) {
    let n = 0;
    this.field.forEachNear(x, z, 3, (p) => {
      if (n >= MAX) return;
      const phase = p.x * 0.7 + p.z * 1.3;
      const scale = p.big ? 1.9 : 1;
      this.e.set(0, time * 1.8 + phase, Math.sin(time * 1.3 + phase) * 0.15);
      this.q.setFromEuler(this.e);
      this.p.set(p.x, p.y + Math.sin(time * 2 + phase) * 0.18, p.z);
      this.s.setScalar(scale);
      this.mesh.setMatrixAt(n, this.m4.compose(this.p, this.q, this.s));
      this.mesh.setColorAt(n, p.big ? this.c.set('#ffd9f0') : this.c.set('#ffffff'));
      n++;
    });
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
