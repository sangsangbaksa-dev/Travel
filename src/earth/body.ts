import * as THREE from 'three';
import { PhysicsWorld, type Obstacle, type PhysicsInput } from '../physics/world';
import type { Terrain } from '../physics/terrain';
import { RADIUS } from './geo';
import type { Planet } from './planet';

// 구 위의 큐브. 매 물리 스텝마다 지금 서 있는 곳의 접평면을 평평한 월드로 삼아
// 기존 물리(점프, 비탈, 수영, 충돌)를 그대로 돌리고, 결과를 다시 행성 좌표로 옮긴다.

/** 행성 좌표의 정적 충돌체 */
export interface WorldObstacle {
  /** 밑면 중심 (행성 좌표) */
  p: THREE.Vector3;
  /** 원기둥 반지름. box가 있으면 무시 */
  r: number;
  /** 상자: 반 너비와, 상자 x축의 행성 좌표 방향(접선) */
  box?: { hx: number; hz: number; axis: THREE.Vector3 };
  /** 밑면에서 윗면까지 높이 */
  height: number;
  /** 윗면에 올라설 수 있는가 */
  walkable: boolean;
}

export interface WorldObstacleSource {
  /** p 근처(반경 radius)의 충돌체를 out에 더한다 */
  collect(p: THREE.Vector3, radius: number, out: WorldObstacle[]): void;
}

/** 접평면 좌표계: 원점 A = up × RADIUS, 축 X(접선), up, Z(접선) */
export class Frame {
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly x = new THREE.Vector3(1, 0, 0);
  readonly z = new THREE.Vector3(0, 0, 1);
  readonly origin = new THREE.Vector3(0, RADIUS, 0);
  readonly matrix = new THREE.Matrix4();

  /** up을 새 방향으로 옮기고 X/Z를 평행 이동시켜 다시 직교화한다 */
  moveTo(dir: THREE.Vector3) {
    this.up.copy(dir).normalize();
    this.z.addScaledVector(this.up, -this.z.dot(this.up));
    if (this.z.lengthSq() < 1e-8) this.z.set(0, 0, 1).addScaledVector(this.up, -this.up.z);
    this.z.normalize();
    this.x.crossVectors(this.up, this.z).normalize();
    this.origin.copy(this.up).multiplyScalar(RADIUS);
    this.matrix.makeBasis(this.x, this.up, this.z).setPosition(this.origin);
  }

  toWorld(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.origin).addScaledVector(this.x, lx).addScaledVector(this.up, ly).addScaledVector(this.z, lz);
  }

  toLocal(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const dx = p.x - this.origin.x, dy = p.y - this.origin.y, dz = p.z - this.origin.z;
    return out.set(
      dx * this.x.x + dy * this.x.y + dz * this.x.z,
      dx * this.up.x + dy * this.up.y + dz * this.up.z,
      dx * this.z.x + dy * this.z.y + dz * this.z.z,
    );
  }

  /** 행성 방향 벡터를 지역 방향으로 */
  dirToLocal(v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(v.dot(this.x), v.dot(this.up), v.dot(this.z));
  }
}

/** 접평면 위의 평평한 지형처럼 보이게 하는 어댑터 */
export class LocalTerrain implements Terrain {
  private readonly p = new THREE.Vector3();
  constructor(private readonly planet: Planet, private readonly frame: Frame) {}

  private project(x: number, z: number): number {
    const f = this.frame;
    this.p.copy(f.origin).addScaledVector(f.x, x).addScaledVector(f.z, z);
    const l = this.p.length();
    this.p.divideScalar(l);
    return l;
  }

  height(x: number, z: number): number {
    const l = this.project(x, z);
    const ground = RADIUS + this.planet.height(this.p.x, this.p.y, this.p.z);
    return ground * RADIUS / l - RADIUS;
  }

  waterAt(x: number, z: number): number {
    const l = this.project(x, z);
    return RADIUS * RADIUS / l - RADIUS;
  }
}

export class SphereBody {
  /** 지금 스텝과 직전 스텝의 위치 (행성 좌표, 큐브 중심) */
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** 물리 스텝에 쓰는 좌표계 */
  readonly frame = new Frame();
  readonly terrain: LocalTerrain;
  readonly physics: PhysicsWorld;
  private readonly sources: WorldObstacleSource[] = [];
  private readonly found: WorldObstacle[] = [];
  private readonly local: Obstacle[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();

  constructor(planet: Planet, start: THREE.Vector3) {
    this.frame.moveTo(start);
    this.terrain = new LocalTerrain(planet, this.frame);
    this.physics = new PhysicsWorld(this.terrain, 0, 0, { near: () => this.local });
    this.syncFromState();
    this.prev.copy(this.pos);
  }

  addObstacles(source: WorldObstacleSource) { this.sources.push(source); }

  /** 큐브를 다른 곳으로 옮긴다 (dir: 방향, 높이는 지면 위) */
  teleport(dir: THREE.Vector3, lift = 3) {
    this.frame.moveTo(dir);
    const s = this.physics.state;
    const ground = Math.max(this.terrain.height(0, 0), this.terrain.waterAt(0, 0));
    s.x = s.z = s.px = s.pz = 0;
    s.y = s.py = ground + 0.5 + lift;
    s.vx = s.vy = s.vz = 0;
    s.grounded = false;
    s.submerged = false;
    this.syncFromState();
    this.prev.copy(this.pos);
    this.vel.set(0, 0, 0);
  }

  /** moveX/moveZ는 frame의 X/Z축 기준 */
  step(input: PhysicsInput) {
    const f = this.frame;
    const oldUp = this.t1.copy(f.up);
    const newUp = this.t2.copy(this.pos).normalize();
    // 속도와 기준축을 새 지점으로 평행 이동
    this.q.setFromUnitVectors(oldUp, newUp);
    this.vel.applyQuaternion(this.q);
    f.z.applyQuaternion(this.q);
    f.moveTo(newUp);

    const s = this.physics.state;
    s.x = 0; s.z = 0;
    s.y = this.pos.length() - RADIUS;
    s.vx = this.vel.dot(f.x); s.vy = this.vel.dot(f.up); s.vz = this.vel.dot(f.z);
    this.gather();

    this.prev.copy(this.pos);
    this.physics.step(input);
    this.syncFromState();
  }

  private syncFromState() {
    const s = this.physics.state, f = this.frame;
    f.toWorld(s.x, s.y, s.z, this.pos);
    this.vel.set(0, 0, 0).addScaledVector(f.x, s.vx).addScaledVector(f.up, s.vy).addScaledVector(f.z, s.vz);
  }

  /** 근처 충돌체를 지역 좌표로 바꿔 둔다 */
  private gather() {
    const f = this.frame;
    this.found.length = 0;
    for (const src of this.sources) src.collect(this.pos, 8, this.found);
    this.local.length = 0;
    const l = this.t1;
    for (const o of this.found) {
      f.toLocal(o.p, l);
      const top = l.y + o.height;
      const ob: Obstacle = {
        x: l.x, z: l.z, r: o.r,
        top: o.walkable ? top : Infinity,
        collisionTop: top,
        collisionBottom: l.y - 0.3,
      };
      if (o.box) ob.box = { hx: o.box.hx, hz: o.box.hz, c: o.box.axis.dot(f.x), s: o.box.axis.dot(f.z) };
      this.local.push(ob);
    }
  }

  /** 렌더링용 보간 위치 */
  lerp(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.prev).lerp(this.pos, alpha);
  }
}
