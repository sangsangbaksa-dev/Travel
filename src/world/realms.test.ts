import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLOAT_DEPTH, HALF, PhysicsWorld, type PhysicsInput } from '../physics/world';
import type { Terrain } from '../terrain/height';
import { Realms } from './realms';

const idle: PhysicsInput = { moveX: 0, moveZ: 0, jumpPressed: false, jumpHeld: false };
const surface: Terrain = { height: (x) => x > 45 ? -10 : 2, waterLevel: 0 };

function setup() {
  const scene = new THREE.Scene();
  const realms = new Realms(scene, surface);
  const physics = new PhysicsWorld(realms.terrain);
  const chunks = new THREE.Group(), water = new THREE.Group();
  const place = (x: number, z: number) => {
    const s = physics.state;
    s.x = s.px = x; s.z = s.pz = z;
    s.y = s.py = realms.terrain.height(x, z) + HALF;
    s.vx = s.vy = s.vz = 0;
  };
  return { scene, realms, physics, chunks, water, place, update: () => realms.update(physics.state, chunks, water) };
}

function enter(game: ReturnType<typeof setup>, x: number) {
  game.place(x, -3); game.update();
  game.place(x, -4.2); return game.update();
}
function leave(game: ReturnType<typeof setup>) {
  game.place(0, -5); game.update();
  game.place(0, -3.8); return game.update();
}

describe('동굴 입구와 하늘 계단', () => {
  it.each([[-5, 'cave', '지하 동굴'], [5, 'sky', '하늘 정원']] as const)(
    '입구 %i에서 %s에 들어가고 같은 길로 돌아온다', (x, mode, label) => {
      const game = setup();
      expect(enter(game, x)).toBe(label);
      expect(game.realms.mode).toBe(mode);
      expect(game.chunks.visible).toBe(false);
      expect(game.water.visible).toBe(false);
      expect(game.physics.state.y).toBeCloseTo(game.realms.terrain.height(0, -4) + HALF);
      expect(game.update()).toBeNull();
      expect(leave(game)).toBe('지상');
      expect(game.realms.mode).toBe('surface');
      expect(game.physics.state.x).toBe(x);
      expect(game.chunks.visible).toBe(true);
      expect(game.water.visible).toBe(true);
      expect(game.update()).toBeNull();
    },
  );

  it('입구 옆이나 반대 방향에서 경계를 지나도 전환되지 않는다', () => {
    const game = setup();
    game.place(-8, -3); game.update();
    game.place(-8, -5); expect(game.update()).toBeNull();
    game.place(-5, -5); game.update();
    game.place(-5, -3); expect(game.update()).toBeNull();
    expect(game.realms.mode).toBe('surface');
  });

  it('하늘 계단은 걷는 캐릭터의 발을 실제로 높인다', () => {
    const game = setup();
    game.place(5, 1.5);
    const initialY = game.physics.state.y;
    for (let i = 0; i < 28; i++) game.physics.step({ ...idle, moveZ: -1 });
    expect(game.physics.state.z).toBeLessThan(0);
    expect(game.physics.state.y).toBeGreaterThan(initialY + 0.25);
    expect(game.physics.state.grounded).toBe(true);
  });

  it('각 계단의 물리 높이와 표시되는 돌의 윗면이 일치한다', () => {
    const game = setup();
    const steps = game.scene.children[0].children[1].children;
    for (const obj of steps) {
      const step = obj as THREE.Mesh<THREE.BoxGeometry>;
      const top = step.position.y + step.geometry.parameters.height / 2;
      expect(game.realms.terrain.height(5, step.position.z)).toBeCloseTo(top, 5);
    }
  });

  it.each([[-5, 'cave'], [5, 'sky']] as const)('실제 이동으로 %s 입구를 왕복한다', (x, mode) => {
    const game = setup();
    game.place(x, -2);
    game.update();
    const move = (z: number) => {
      game.physics.step({ ...idle, moveZ: z });
      game.update();
    };
    for (let i = 0; i < 150 && game.realms.mode === 'surface'; i++) move(-1);
    expect(game.realms.mode).toBe(mode);
    for (let i = 0; i < 25; i++) move(-1);
    for (let i = 0; i < 150 && game.realms.mode !== 'surface'; i++) move(1);
    expect(game.realms.mode).toBe('surface');
    expect(game.physics.state.x).toBe(x);
  });

  it('지하에서는 지상 수면이 사라지고 지상 복귀 후 다시 적용된다', () => {
    const game = setup();
    enter(game, -5);
    expect(game.realms.terrain.waterLevel).toBe(-Infinity);
    for (let i = 0; i < 20; i++) game.physics.step(idle);
    expect(game.physics.state.inWater).toBe(false);
    expect(game.physics.state.y).toBeLessThan(-40);
    leave(game);
    expect(game.realms.terrain.waterLevel).toBe(0);
    game.place(50, 0); game.physics.step(idle);
    expect(game.physics.state.inWater).toBe(true);
    expect(game.physics.state.y).toBeCloseTo(-FLOAT_DEPTH + HALF);
  });

  it('멀리 이동해도 불러온 지형 청크 수는 제한된다', () => {
    const game = setup();
    enter(game, 5);
    const realmGroup = game.scene.children[1];
    expect(realmGroup.children).toHaveLength(26);
    game.place(320, 320); game.update();
    expect(realmGroup.children).toHaveLength(26);
  });
});
