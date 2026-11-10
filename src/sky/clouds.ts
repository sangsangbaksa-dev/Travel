import * as THREE from 'three';
import type { SkyState } from './cycle';

// 카메라 주위에서 천천히 흘러가는 폭신한 구름. 카메라 기준으로 감아 돌려서 끝없이 이어진다.
const COUNT = 46;
const PUFFS = 5;
const RANGE = 420;
const PLANET_R = 5157;
const OFFSETS: [number, number, number, number][] = [
  [-1.2, 0, 0, 0.9], [0, 0.35, 0.2, 1.15], [1.3, 0, -0.1, 0.95], [0.4, -0.1, 0.9, 0.7], [-0.5, -0.05, -0.8, 0.75],
];

const wrap = (v: number) => ((((v + RANGE) % (2 * RANGE)) + 2 * RANGE) % (2 * RANGE)) - RANGE;

export class Clouds {
  readonly mesh: THREE.InstancedMesh;
  private readonly data: { x: number; z: number; y: number; s: number; speed: number }[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor() {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < COUNT; i++) {
      this.data.push({
        x: (rnd() * 2 - 1) * RANGE, z: (rnd() * 2 - 1) * RANGE,
        y: 30 + rnd() * 22, s: 8 + rnd() * 12, speed: 1.2 + rnd() * 1.6,
      });
    }
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.93, depthWrite: false, fog: true }),
      COUNT * PUFFS,
    );
    this.mesh.renderOrder = -7;
    this.mesh.frustumCulled = false;
  }

  /**
   * 구름은 지역 좌표계(플레이어 발밑이 원점)에 그린다. odoX/odoZ는 지금까지 걸어온 거리라서
   * 걸어가면 구름이 뒤로 지나간다. 멀어질수록 행성 곡률만큼 내려앉는다.
   */
  update(time: number, sky: SkyState, odoX: number, odoZ: number, altitude: number) {
    this.mesh.visible = altitude < 400;
    this.data.forEach((c, i) => {
      const x = wrap(c.x + time * c.speed - odoX);
      const z = wrap(c.z + time * c.speed * 0.35 - odoZ);
      const drop = (x * x + z * z) / (2 * PLANET_R);
      OFFSETS.forEach(([ox, oy, oz, os], j) => {
        this.p.set(x + ox * c.s, c.y + oy * c.s - drop, z + oz * c.s);
        this.sc.set(c.s * os, c.s * os * 0.5, c.s * os);
        this.mesh.setMatrixAt(i * PUFFS + j, this.m4.compose(this.p, this.q, this.sc));
      });
    });
    this.mesh.instanceMatrix.needsUpdate = true;

    // 낮에는 하얗게, 노을엔 분홍빛, 밤엔 어두운 푸른 회색
    const bright = Math.min(1, 0.3 + 0.7 * (sky.sunIntensity / 1.1));
    const [hr, hg, hb] = sky.horizon;
    this.color.setRGB(
      (hr * 0.45 + 0.55) * bright,
      (hg * 0.45 + 0.55) * bright,
      (hb * 0.45 + 0.55) * bright,
    );
    (this.mesh.material as THREE.MeshBasicMaterial).color.copy(this.color);
  }
}
