import { surfaceNormal, type Terrain } from '../terrain/height';
import { FIXED_DT } from './clock';

// ---- 손맛 상수 (여기만 만지면 점프 느낌이 바뀐다) ----
export const HALF = 0.5; // 큐브 반 크기 (중심 y = 지면 + HALF)
export const GRAVITY = 36;
export const JUMP_HEIGHT = 2.4; // 버튼을 끝까지 누를 때의 높이
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
export const CUT_MULT = 2.6; // 상승 중 버튼을 떼면 중력 배수 (짧은 점프)
export const FALL_MULT = 1.35; // 하강은 살짝 묵직하게
export const TERMINAL_V = 38;
export const COYOTE_TIME = 0.1; // 발판을 벗어난 뒤에도 점프가 먹히는 유예
export const JUMP_BUFFER = 0.12; // 착지 직전에 누른 점프를 기억해 주는 시간
export const MAX_SPEED = 9;
export const GROUND_ACCEL = 70;
export const GROUND_FRICTION = 55;
export const AIR_ACCEL = 28;
export const SNAP_DISTANCE = 0.4; // 내리막에서 지면에 붙어 있게 하는 거리
export const WALKABLE_NORMAL_Y = 0.62; // 이보다 가파르면 미끄러진다 (~52°)
export const SLIDE_ACCEL = 30;

export const FLOAT_DEPTH = 0.25; // 물에서 큐브 밑면이 수면 아래로 잠기는 깊이
export const WATER_SPEED = 0.7; // 물에서의 이동 속도 배수

/** 나무/바위 같은 정적 충돌체 (원기둥). top이 Infinity면 올라설 수 없다. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
  top: number;
}
export interface ObstacleSource {
  near(x: number, z: number): readonly Obstacle[];
}

export interface PhysicsInput {
  /** 월드 좌표계의 이동 방향. 길이 0~1 */
  moveX: number;
  moveZ: number;
  /** 이번 스텝에서 점프 버튼이 새로 눌렸는가 */
  jumpPressed: boolean;
  /** 점프 버튼이 눌려 있는가 */
  jumpHeld: boolean;
}

export interface PhysicsState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  onSteep: boolean;
  /** 물 위에 떠 있는가 */
  inWater: boolean;
  /** 큐브 밑면 아래 지지면의 높이 */
  groundY: number;
  coyote: number;
  buffer: number;
  /** 직전 스텝의 위치 (렌더 보간용) */
  px: number;
  py: number;
  pz: number;
  /** 이번 스텝에 일어난 일 (연출용). 매 스텝 초기화된다. */
  jumped: boolean;
  landImpact: number;
}

export class PhysicsWorld {
  readonly state: PhysicsState;
  private readonly normal = { x: 0, y: 1, z: 0 };
  private readonly water: number;
  private sampledWater = false;
  private sampledRaised = false;

  constructor(
    private readonly terrain: Terrain,
    x = 0,
    z = 0,
    private readonly obstacles?: ObstacleSource,
  ) {
    this.water = terrain.waterLevel ?? -Infinity;
    const g = this.sample(x, z);
    const y = g + HALF;
    this.state = {
      x, y, z, vx: 0, vy: 0, vz: 0,
      grounded: true, onSteep: false, inWater: this.sampledWater, groundY: g,
      coyote: COYOTE_TIME, buffer: 0,
      px: x, py: y, pz: z,
      jumped: false, landImpact: 0,
    };
  }

  /**
   * 큐브 밑면 아래 지지면의 높이. 모서리까지 샘플링해 비탈에서 파고들지 않게 하고,
   * 올라설 수 있는 바위 윗면과 수면(물에 뜨는 높이)도 포함한다.
   */
  private sample(x: number, z: number): number {
    const t = this.terrain;
    const r = HALF * 0.85;
    let g = Math.max(t.height(x, z), t.height(x + r, z), t.height(x - r, z), t.height(x, z + r), t.height(x, z - r));
    this.sampledRaised = false;
    if (this.obstacles) {
      for (const o of this.obstacles.near(x, z)) {
        if (o.top === Infinity || o.top <= g) continue;
        if (Math.hypot(x - o.x, z - o.z) < o.r + HALF * 0.6) {
          g = o.top;
          this.sampledRaised = true;
        }
      }
    }
    const surface = this.water - FLOAT_DEPTH;
    this.sampledWater = surface > g;
    return this.sampledWater ? surface : g;
  }

  step(input: PhysicsInput, dt = FIXED_DT): void {
    const s = this.state;
    s.px = s.x; s.py = s.y; s.pz = s.z;
    s.jumped = false;
    s.landImpact = 0;

    // 1) 수평 이동: 목표 속도를 향해 가속/마찰
    const inLen = Math.hypot(input.moveX, input.moveZ);
    const hasInput = inLen > 0.001;
    const scale = hasInput ? Math.min(1, inLen) / inLen : 0;
    const speed = MAX_SPEED * (s.inWater && s.grounded ? WATER_SPEED : 1);
    const tvx = input.moveX * scale * speed;
    const tvz = input.moveZ * scale * speed;
    const accel = s.grounded ? (hasInput ? GROUND_ACCEL : GROUND_FRICTION) : AIR_ACCEL;
    const dvx = tvx - s.vx;
    const dvz = tvz - s.vz;
    const dlen = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dlen <= maxDv) {
      s.vx = tvx; s.vz = tvz;
    } else {
      s.vx += (dvx / dlen) * maxDv;
      s.vz += (dvz / dlen) * maxDv;
    }

    // 2) 타이머: 코요테 / 점프 버퍼
    if (s.onSteep) s.coyote = 0; // 가파른 비탈에서는 점프 불가
    else s.coyote = s.grounded ? COYOTE_TIME : Math.max(0, s.coyote - dt);
    s.buffer = input.jumpPressed ? JUMP_BUFFER : Math.max(0, s.buffer - dt);

    // 3) 점프
    if (s.buffer > 0 && s.coyote > 0) {
      s.vy = JUMP_SPEED;
      s.grounded = false;
      s.coyote = 0;
      s.buffer = 0;
      s.jumped = true;
    }

    // 4) 중력 (상승 중 버튼을 떼면 더 강하게 → 가변 점프 높이)
    let g = GRAVITY;
    if (s.vy > 0 && !input.jumpHeld) g *= CUT_MULT;
    else if (s.vy < 0) g *= FALL_MULT;
    const vyOld = s.vy;
    s.vy = Math.max(-TERMINAL_V, s.vy - g * dt);

    // 5) 적분 (수직은 평균 속도 → 일정 중력에서 정확)
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    s.y += ((vyOld + s.vy) / 2) * dt;

    // 5.5) 나무/바위 옆면: 밑면이 윗면보다 낮으면 밀어낸다
    if (this.obstacles) {
      const feetPrev = s.py - HALF;
      for (const o of this.obstacles.near(s.x, s.z)) {
        if (feetPrev >= o.top - 0.1) continue;
        let dx = s.x - o.x;
        let dz = s.z - o.z;
        let d = Math.hypot(dx, dz);
        const min = o.r + HALF * 0.9;
        if (d >= min) continue;
        if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        const nx = dx / d;
        const nz = dz / d;
        s.x = o.x + nx * min;
        s.z = o.z + nz * min;
        const vn = s.vx * nx + s.vz * nz;
        if (vn < 0) { s.vx -= vn * nx; s.vz -= vn * nz; }
      }
    }

    // 6) 지면 처리
    const ground = this.sample(s.x, s.z) + HALF;
    s.inWater = this.sampledWater;
    s.groundY = ground - HALF;
    const wasGrounded = s.grounded;
    s.onSteep = false;
    if (s.y <= ground && s.vy <= 0) {
      if (!wasGrounded) s.landImpact = -s.vy;
      s.y = ground;
      s.vy = 0;
      s.grounded = true;
    } else if (s.y < ground) {
      s.y = ground; // 상승 중 언덕 옆면에 닿음: 위로 밀어 올릴 뿐 속도는 유지
    } else if (wasGrounded && !s.jumped && s.y - ground <= SNAP_DISTANCE) {
      s.y = ground; // 내리막에서 둥둥 뜨지 않게 지면에 붙인다
      s.vy = 0;
      s.grounded = true;
    } else {
      s.grounded = false;
    }

    // 7) 너무 가파른 비탈은 미끄러진다 (점프도 못 함)
    if (s.grounded && !s.inWater && !this.sampledRaised) {
      const n = surfaceNormal(this.terrain, s.x, s.z, this.normal);
      if (n.y < WALKABLE_NORMAL_Y) {
        s.onSteep = true;
        const k = SLIDE_ACCEL * dt / Math.max(0.0001, Math.hypot(n.x, n.z));
        s.vx += n.x * k;
        s.vz += n.z * k;
      }
    }
  }
}
