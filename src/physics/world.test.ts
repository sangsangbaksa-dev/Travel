import { describe, expect, it } from 'vitest';
import { FIXED_DT, FixedStepper } from './clock';
import {
  COYOTE_TIME, HALF, JUMP_HEIGHT, JUMP_BUFFER, PhysicsWorld, type PhysicsInput,
} from './world';
import { createTerrain, type Terrain } from '../terrain/height';

const flat: Terrain = { height: () => 0 };
const idle: PhysicsInput = { moveX: 0, moveZ: 0, jumpPressed: false, jumpHeld: false };
const press: PhysicsInput = { ...idle, jumpPressed: true, jumpHeld: true };
const hold: PhysicsInput = { ...idle, jumpHeld: true };

function settle(w: PhysicsWorld) {
  for (let i = 0; i < 5; i++) w.step(idle);
}

/** 점프를 시뮬레이션하고 (최고 높이, 체공 시간)을 돌려준다 */
function jump(w: PhysicsWorld, holdSteps: number) {
  settle(w);
  const base = w.state.y;
  let peak = 0;
  let steps = 0;
  w.step(press);
  steps++;
  peak = Math.max(peak, w.state.y - base);
  while (!w.state.grounded && steps < 600) {
    w.step(steps < holdSteps ? hold : idle);
    steps++;
    peak = Math.max(peak, w.state.y - base);
  }
  return { peak, time: steps * FIXED_DT };
}

describe('점프', () => {
  it('버튼을 끝까지 누르면 설계한 높이에 도달한다', () => {
    const { peak } = jump(new PhysicsWorld(flat), 999);
    expect(peak).toBeGreaterThan(JUMP_HEIGHT - 0.06);
    expect(peak).toBeLessThan(JUMP_HEIGHT + 0.06);
  });

  it('짧게 누르면 더 낮게 뛴다 (가변 점프)', () => {
    const tap = jump(new PhysicsWorld(flat), 2).peak;
    const full = jump(new PhysicsWorld(flat), 999).peak;
    expect(tap).toBeLessThan(full * 0.6);
    expect(tap).toBeGreaterThan(0.2);
  });

  it('지면에서는 중심 y가 지면+HALF에 놓인다', () => {
    const w = new PhysicsWorld(flat);
    settle(w);
    expect(w.state.y).toBeCloseTo(HALF, 5);
    expect(w.state.grounded).toBe(true);
  });

  it('공중에서는 다시 점프할 수 없다', () => {
    const w = new PhysicsWorld(flat);
    settle(w);
    w.step(press);
    for (let i = 0; i < 20; i++) w.step(hold);
    const vy = w.state.vy;
    w.step(press);
    expect(w.state.jumped).toBe(false);
    expect(w.state.vy).toBeLessThan(vy);
  });

  it('동일한 입력이면 항상 동일한 결과다 (결정성)', () => {
    const run = () => {
      const w = new PhysicsWorld(createTerrain(7), 3, 4);
      for (let i = 0; i < 300; i++) {
        w.step({ moveX: 1, moveZ: 0.3, jumpPressed: i % 70 === 0, jumpHeld: i % 70 < 25 });
      }
      return { ...w.state };
    };
    expect(run()).toEqual(run());
  });
});

describe('코요테 타임 / 점프 버퍼', () => {
  const ledge: Terrain = { height: (x) => (x < 5 ? 0 : -6) };

  function walkOffLedge() {
    const w = new PhysicsWorld(ledge, 0, 0);
    settle(w);
    w.state.vx = 6;
    let n = 0;
    while (w.state.x < 5.9 && n++ < 200) w.step({ ...idle, moveX: 1 }); // 큐브 전체가 턱을 벗어남
    return w;
  }

  it('발판을 벗어난 직후에도 점프가 된다', () => {
    const w = walkOffLedge();
    expect(w.state.grounded).toBe(false);
    w.step({ ...press, moveX: 1 });
    expect(w.state.jumped).toBe(true);
  });

  it('유예 시간이 지나면 점프가 안 된다', () => {
    const w = walkOffLedge();
    for (let i = 0; i < Math.ceil((COYOTE_TIME + 0.05) / FIXED_DT); i++) w.step({ ...idle, moveX: 1 });
    w.step({ ...press, moveX: 1 });
    expect(w.state.jumped).toBe(false);
  });

  it('착지 직전에 누른 점프가 착지 순간 실행된다', () => {
    const w = new PhysicsWorld(flat);
    settle(w);
    w.step(press);
    while (w.state.vy > 0 || w.state.y - HALF > 0.12) w.step(idle);
    // 지면 근처에서 점프를 누른다 → 버퍼에 저장
    w.step(press);
    expect(w.state.jumped).toBe(false);
    let jumped = false;
    for (let i = 0; i < Math.ceil(JUMP_BUFFER / FIXED_DT) + 2 && !jumped; i++) {
      w.step({ ...idle, jumpHeld: true });
      jumped = w.state.jumped;
    }
    expect(jumped).toBe(true);
  });
});

describe('지형', () => {
  it('내리막을 걸을 때 지면에 붙어 있다 (떨림/체공 없음)', () => {
    const slope: Terrain = { height: (x) => -0.35 * x };
    const w = new PhysicsWorld(slope, 0, 0);
    settle(w);
    for (let i = 0; i < 120; i++) {
      w.step({ ...idle, moveX: 1 });
      expect(w.state.grounded).toBe(true);
    }
  });

  it('언덕 위에서 지면을 파고들지 않는다', () => {
    const t = createTerrain(1337);
    const w = new PhysicsWorld(t, 30, 30);
    for (let i = 0; i < 600; i++) {
      w.step({ moveX: Math.cos(i / 40), moveZ: Math.sin(i / 40), jumpPressed: i % 90 === 0, jumpHeld: i % 90 < 20 });
      expect(w.state.y - HALF).toBeGreaterThanOrEqual(t.height(w.state.x, w.state.z) - 1e-6);
    }
  });

  it('가파른 절벽은 걸어 올라갈 수 없고 미끄러진다', () => {
    const wall: Terrain = { height: (x) => Math.max(0, x) * 3 }; // ~71°
    const w = new PhysicsWorld(wall, 4, 0);
    settle(w);
    expect(w.state.onSteep).toBe(true);
    w.step(press);
    expect(w.state.jumped).toBe(false);
  });
});

describe('잠수', () => {
  const sea: Terrain = { height: () => -8, waterLevel: 0 };

  it('잠수 후 바닥 아래로 내려가지 않고 스페이스로 수면에 돌아온다', () => {
    const w = new PhysicsWorld(sea);
    const surface = w.state.y;
    for (let i = 0; i < 240; i++) {
      w.step({ ...idle, diveHeld: true });
      expect(w.state.y - HALF).toBeGreaterThanOrEqual(-8);
    }
    expect(w.state.submerged).toBe(true);
    expect(w.state.y).toBeLessThan(surface - 1);
    for (let i = 0; i < 240 && w.state.submerged; i++) w.step(hold);
    expect(w.state.submerged).toBe(false);
    expect(w.state.y).toBeCloseTo(surface);
    w.step(press);
    expect(w.state.jumped).toBe(true);
  });

  it('잠수 중 얕은 물이나 해안으로 이동해도 지형 아래로 가지 않는다', () => {
    const shore: Terrain = { height: x => x < 1 ? -4 : 1, waterLevel: 0 };
    const w = new PhysicsWorld(shore);
    for (let i = 0; i < 50; i++) w.step({ ...idle, diveHeld: true });
    for (let i = 0; i < 100; i++) {
      w.step({ ...idle, moveX: 1, diveHeld: true });
      expect(w.state.y - HALF).toBeGreaterThanOrEqual(shore.height(w.state.x, w.state.z));
    }
    expect(w.state.submerged).toBe(false);
  });
});

describe('고정 스텝', () => {
  const stepsOver = (fps: number) => {
    const s = new FixedStepper();
    let total = 0;
    for (let i = 0; i < fps * 2; i++) total += s.advance(1 / fps).steps;
    return total;
  };

  it('주사율과 무관하게 같은 물리 시간이 흐른다', () => {
    for (const fps of [30, 60, 75, 120, 144, 240]) {
      expect(Math.abs(stepsOver(fps) - 120)).toBeLessThanOrEqual(1);
    }
  });

  it('주사율이 달라도 점프 궤적이 같다', () => {
    const apex = (fps: number) => {
      const w = new PhysicsWorld(flat);
      settle(w);
      const s = new FixedStepper();
      let peak = 0;
      let first = true;
      for (let f = 0; f < fps * 2; f++) {
        const { steps } = s.advance(1 / fps);
        for (let i = 0; i < steps; i++) {
          w.step(first ? press : hold);
          first = false;
          peak = Math.max(peak, w.state.y - HALF);
        }
      }
      return peak;
    };
    expect(apex(144)).toBeCloseTo(apex(60), 5);
    expect(apex(30)).toBeCloseTo(apex(60), 5);
  });
});
