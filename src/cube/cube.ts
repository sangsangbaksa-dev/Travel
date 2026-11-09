import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { HALF } from '../physics/world';

// 귀여운 큐브: 둥근 몸체 + 얼굴 + 블롭 그림자 + 스쿼시/스트레치(스프링).
export class Cube {
  readonly group = new THREE.Group();
  readonly shadow: THREE.Mesh;
  private readonly body: THREE.Group = new THREE.Group();
  private squash = 0; // +면 납작, -면 길쭉
  private squashV = 0;
  private yaw = 0;

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ color: '#ff9eb5', emissive: '#ff7d9f', emissiveIntensity: 0.22 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(HALF * 2, HALF * 2, HALF * 2, 5, 0.16), mat);
    body.castShadow = false;

    const eyeGeo = new THREE.SphereGeometry(0.075, 16, 12);
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#2b2438' });
    const shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.scale.set(1, 1.35, 0.5);
      eye.position.set(sx * 0.2, 0.08, HALF + 0.005);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), shineMat);
      shine.position.set(0.025, 0.04, 0.05);
      eye.add(shine);
      this.body.add(eye);
    }
    const cheekMat = new THREE.MeshBasicMaterial({ color: '#ff6f93', transparent: true, opacity: 0.55 });
    for (const sx of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), cheekMat);
      cheek.scale.set(1.3, 0.8, 1);
      cheek.position.set(sx * 0.33, -0.08, HALF + 0.006);
      this.body.add(cheek);
    }
    const mouth = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.012, 6, 16, Math.PI),
      new THREE.MeshBasicMaterial({ color: '#2b2438' }),
    );
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -0.06, HALF + 0.006);
    this.body.add(mouth);

    this.body.add(body);
    this.group.add(this.body);

    // 블롭 그림자 (지면 위에 올려놓는 둥근 어두운 원)
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 24),
      new THREE.MeshBasicMaterial({ color: '#2b2438', transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
  }

  /** 점프/착지 충격으로 스프링을 친다 */
  kickJump() { this.squashV -= 7; }
  kickLand(impact: number) { this.squashV += Math.min(impact, 30) * 0.55; }

  /**
   * @param pos 보간된 위치(중심)
   * @param vy 수직 속도 (공중에서 길쭉해지는 연출)
   * @param groundY 큐브 바로 아래 지면 높이 (그림자용)
   * @param faceDir 바라볼 수평 방향
   */
  update(
    dt: number, pos: THREE.Vector3, vy: number, grounded: boolean,
    groundY: number, faceX: number, faceZ: number, normal: THREE.Vector3,
  ) {
    // 임계 감쇠에 가까운 스프링
    const k = 260, c = 17;
    const target = grounded ? 0 : THREE.MathUtils.clamp(-Math.abs(vy) * 0.012, -0.22, 0);
    this.squashV += (-k * (this.squash - target) - c * this.squashV) * dt;
    this.squash += this.squashV * dt;
    this.squash = THREE.MathUtils.clamp(this.squash, -0.4, 0.45);

    const sy = 1 - this.squash;
    const sxz = 1 + this.squash * 0.5;
    this.body.scale.set(sxz, sy, sxz);
    // 납작해져도 바닥에 붙어 있도록 몸체를 내린다
    this.body.position.y = -HALF * (1 - sy);

    if (faceX * faceX + faceZ * faceZ > 0.01) {
      const want = Math.atan2(faceX, faceZ);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 14);
    }
    this.group.position.copy(pos);
    this.group.rotation.y = this.yaw;

    // 그림자: 높이에 따라 작아지고 옅어진다
    const h = Math.max(0, pos.y - HALF - groundY);
    const s = THREE.MathUtils.clamp(1 - h * 0.12, 0.35, 1);
    this.shadow.scale.setScalar(s * (1 + this.squash * 0.4));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * s;
    this.shadow.position.set(pos.x, groundY + 0.04, pos.z);
    // 비탈에 맞춰 눕힌다
    this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }
}
