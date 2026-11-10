import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HALF, MAX_SPEED } from '../physics/world';
import { SphereBody, type WorldObstacle } from './body';
import { decodeElevation, Elevation } from './elevation';
import { dirFromLatLon, latLonFromDir, RADIUS } from './geo';
import { Planet } from './planet';

const bytes = new Uint8Array(readFileSync(new URL('./assets/elevation.bin', import.meta.url)));
const grid = await decodeElevation(bytes, (d) => new Uint8Array(inflateSync(d)));
const blank = { w: 1, h: 1, data: new Uint8Array(4) };
const planet = new Planet(new Elevation(grid), blank, blank);
const walk = { moveX: 0, moveZ: -1, jumpPressed: false, jumpHeld: false };

describe('구 위의 큐브', () => {
  it('미국 대평원을 걸으면 땅 위를 따라 걷고 속도는 걷기 속도다', () => {
    const body = new SphereBody(planet, dirFromLatLon(40, -100));
    for (let i = 0; i < 60; i++) body.step(walk);
    const start = body.pos.clone();
    for (let i = 0; i < 600; i++) {
      body.step(walk);
      const ground = planet.groundRadius(body.pos);
      expect(body.pos.length() - HALF).toBeGreaterThan(ground - 0.05);
    }
    const travelled = start.angleTo(body.pos) * RADIUS;
    expect(travelled).toBeGreaterThan(MAX_SPEED * 10 * 0.9);
    expect(travelled).toBeLessThan(MAX_SPEED * 10 * 1.1);
  });

  it('한 방향으로 계속 걸으면 대원을 따라 돌아 방향이 흐트러지지 않는다', () => {
    const body = new SphereBody(planet, dirFromLatLon(0, -30));
    const a = latLonFromDir(body.pos.x, body.pos.y, body.pos.z);
    for (let i = 0; i < 1200; i++) body.step({ ...walk, moveX: 0, moveZ: -1 });
    const b = latLonFromDir(body.pos.x, body.pos.y, body.pos.z);
    expect(Math.hypot(b.lat - a.lat, b.lon - a.lon)).toBeGreaterThan(0.5);
    expect(body.frame.up.dot(body.pos.clone().normalize())).toBeCloseTo(1, 6);
  });

  it('바다에서는 떠서 헤엄친다', () => {
    const body = new SphereBody(planet, dirFromLatLon(30, -40));
    for (let i = 0; i < 120; i++) body.step(walk);
    expect(body.physics.state.inWater).toBe(true);
    expect(Math.abs(body.pos.length() - RADIUS)).toBeLessThan(1);
  });

  it('건물(회전된 상자)은 뚫고 지나갈 수 없다', () => {
    const start = dirFromLatLon(40, -100);
    const body = new SphereBody(planet, start);
    for (let i = 0; i < 30; i++) body.step({ ...walk, moveZ: 0 });
    // 앞쪽 4칸에 높은 상자를 세운다
    const ahead = body.pos.clone().normalize().multiplyScalar(RADIUS).addScaledVector(body.frame.z, -4);
    const base = ahead.normalize().multiplyScalar(planet.groundRadius(ahead));
    const axis = body.frame.x.clone().applyAxisAngle(body.frame.up, 0.4);
    const wall: WorldObstacle = { p: base, r: 0, box: { hx: 30, hz: 1, axis }, height: 6, walkable: true };
    body.addObstacles({ collect: (_p: THREE.Vector3, _r: number, out: WorldObstacle[]) => { out.push(wall); } });
    const normal = new THREE.Vector3().crossVectors(body.frame.up, axis);
    const side = () => Math.sign(body.pos.clone().sub(base).dot(normal));
    const before = side();
    for (let i = 0; i < 180; i++) body.step(walk);
    expect(side()).toBe(before); // 벽을 따라 미끄러질 뿐, 반대편으로 넘어가지 않는다
    expect(body.physics.state.y).toBeLessThan(planet.groundRadius(body.pos) - RADIUS + 2);
  });
});
