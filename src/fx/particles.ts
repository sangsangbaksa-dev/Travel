import * as THREE from 'three';

// 먼지, 물보라, 별 반짝임에 쓰는 작은 입자 풀. 한 번의 드로우콜로 그린다.
const POOL = 160;

interface Opts {
  color: string;
  speed?: number;
  up?: number;
  size?: number;
  life?: number;
  gravity?: number;
}

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly px = new Float32Array(POOL);
  private readonly py = new Float32Array(POOL);
  private readonly pz = new Float32Array(POOL);
  private readonly vx = new Float32Array(POOL);
  private readonly vy = new Float32Array(POOL);
  private readonly vz = new Float32Array(POOL);
  private readonly life = new Float32Array(POOL);
  private readonly maxLife = new Float32Array(POOL);
  private readonly size = new Float32Array(POOL);
  private readonly grav = new Float32Array(POOL);
  private cursor = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      POOL,
    );
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, this.col.set('#ffffff'));
    for (let i = 0; i < POOL; i++) {
      this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.col);
    }
  }

  emit(x: number, y: number, z: number, count: number, o: Opts) {
    const speed = o.speed ?? 2.5;
    const up = o.up ?? 3;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % POOL;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.6 + 0.4;
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.vx[i] = Math.cos(a) * speed * r;
      this.vz[i] = Math.sin(a) * speed * r;
      this.vy[i] = up * (0.5 + Math.random() * 0.8);
      this.maxLife[i] = this.life[i] = (o.life ?? 0.55) * (0.7 + Math.random() * 0.6);
      this.size[i] = (o.size ?? 0.12) * (0.7 + Math.random() * 0.6);
      this.grav[i] = o.gravity ?? 12;
      this.mesh.setColorAt(i, this.col.set(o.color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < POOL; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        continue;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      this.s.setScalar(this.size[i] * k);
      this.mesh.setMatrixAt(i, this.m4.compose(this.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
