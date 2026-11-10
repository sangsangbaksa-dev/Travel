import * as THREE from 'three';
import type { WorldObstacle, WorldObstacleSource } from '../body';
import { RADIUS, TangentPlane } from '../geo';
import { NewYork, NYC, NYC_RADIUS } from '../nyc';
import type { Planet } from '../planet';
import { LANDMARK_BUILDERS, buildGreatWall, type LandmarkModel } from './models';

// 세계의 랜드마크: 실제 위경도에 모델을 세우고, 주변 땅을 평평하게 다듬고, 이름과 충돌체를 등록한다.

interface Site {
  name: string;
  lat: number;
  lon: number;
  /** 이 거리(칸) 안에서는 이 이름을 보여 준다 */
  radius: number;
  model?: keyof typeof LANDMARK_BUILDERS;
  /** 평평하게 다듬을 반경. 0이면 지형을 그대로 둔다 */
  pad?: number;
  /** 다듬은 땅의 최소 높이 (해안의 랜드마크가 물에 잠기지 않게) */
  minY?: number;
  /** 언덕을 쌓는다: 높이(칸)와 반경 */
  hill?: { height: number; radius: number };
  /** 모델을 돌린다 (라디안, 위에서 볼 때 반시계) */
  turn?: number;
}

/** 모델은 1칸 = 12m로 만들었다. 큐브(1m) 기준의 실제 크기로 키운다 */
const MODEL_SCALE = 12;

export const SITES: Site[] = [
  { name: '에펠탑', lat: 48.8584, lon: 2.2945, radius: 400, model: 'eiffel', pad: 160, minY: 0.5 },
  { name: '기자의 피라미드', lat: 29.9792, lon: 31.1342, radius: 700, model: 'pyramids', pad: 560, minY: 0.6 },
  { name: '만리장성', lat: 40.354, lon: 116.02, radius: 900, model: 'greatWall' },
  { name: '타지마할', lat: 27.1751, lon: 78.0421, radius: 400, model: 'tajMahal', pad: 220, minY: 0.6 },
  { name: '콜로세움', lat: 41.8902, lon: 12.4922, radius: 300, model: 'colosseum', pad: 140, minY: 0.5 },
  { name: '빅벤', lat: 51.5007, lon: -0.1246, radius: 400, model: 'bigBen', pad: 190, minY: 0.5 },
  { name: '시드니 오페라 하우스', lat: -33.8568, lon: 151.2153, radius: 300, model: 'operaHouse', pad: 130, minY: 0.45 },
  { name: '코르코바두 예수상', lat: -22.9519, lon: -43.2105, radius: 300, model: 'christ', hill: { height: 7, radius: 60 } },
  { name: '부르즈 할리파', lat: 25.1972, lon: 55.2744, radius: 600, model: 'burjKhalifa', pad: 120, minY: 0.5 },
  { name: 'N서울타워', lat: 37.5512, lon: 126.9882, radius: 300, model: 'nSeoulTower', hill: { height: 2.6, radius: 60 } },
  { name: '타이타닉 난파선', lat: 41.7325, lon: -49.9469, radius: 400, model: 'titanic', pad: 260 },
  { name: '에베레스트', lat: 27.9881, lon: 86.925, radius: 14 },
  { name: '마리아나 해구 · 챌린저 해연', lat: 11.3733, lon: 142.5917, radius: 30 },
  { name: '후지산', lat: 35.3606, lon: 138.7274, radius: 30 },
  { name: '킬리만자로', lat: -3.0674, lon: 37.3556, radius: 30 },
  { name: '그랜드캐니언', lat: 36.1, lon: -112.1, radius: 60 },
  { name: '사하라 사막', lat: 23.4, lon: 11.0, radius: 900 },
  { name: '아마존', lat: -3.5, lon: -62.0, radius: 700 },
];

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export class Landmarks implements WorldObstacleSource {
  readonly group = new THREE.Group();
  readonly nyc: NewYork;
  readonly spawn: THREE.Vector3;
  readonly marks: { lat: number; lon: number }[];
  private readonly obstacles: WorldObstacle[] = [];
  private readonly named: { name: string; dir: THREE.Vector3; cos: number }[] = [];
  private readonly blocks: { dir: THREE.Vector3; cos: number }[] = [];

  constructor(planet: Planet) {
    const el = planet.elevation;
    this.nyc = new NewYork();
    el.addShaper(this.nyc.shaper());
    this.group.add(this.nyc.group);
    this.obstacles.push(...this.nyc.obstacles);
    this.spawn = this.nyc.spawn();
    this.named.push({ name: NYC.name, dir: this.nyc.plane.up.clone(), cos: Math.cos(NYC_RADIUS / RADIUS) });
    this.blocks.push({ dir: this.nyc.plane.up.clone(), cos: Math.cos((NYC_RADIUS + 30) / RADIUS) });

    for (const site of SITES) {
      const plane = new TangentPlane(site.lat, site.lon);
      this.named.push({ name: site.name, dir: plane.up.clone(), cos: Math.cos(site.radius / RADIUS) });
      if (!site.model) continue;
      // 땅 다듬기 (모델보다 먼저 등록해야 지형과 충돌체가 같은 높이를 쓴다)
      let base = el.heightAt(plane.up);
      if (site.hill) {
        const { height, radius } = site.hill;
        base = Math.max(base, 0.5) + height;
        const top = base;
        el.addShaper({
          plane, radius: radius * 2.4,
          apply: (h, _e, _n, d) => Math.max(h, top - height * Math.pow(smooth(0, radius * 2.4, d), 0.7)),
        });
        // 꼭대기는 평평하게
        el.addShaper({ plane, radius: 24, apply: (h, _e, _n, d) => top + (h - top) * smooth(14, 24, d) });
      } else if (site.pad) {
        const pad = site.pad;
        base = Math.max(base, site.minY ?? -Infinity);
        const y = base;
        el.addShaper({ plane, radius: pad * 1.7, apply: (h, _e, _n, d) => y + (h - y) * smooth(pad, pad * 1.7, d) });
        this.blocks.push({ dir: plane.up.clone(), cos: Math.cos(pad * 1.2 / RADIUS) });
      }
      const model: LandmarkModel = site.model === 'greatWall'
        ? buildGreatWall((x, z) => (el.heightAt(plane.dir(x * MODEL_SCALE, -z * MODEL_SCALE)) - base) / MODEL_SCALE)
        : LANDMARK_BUILDERS[site.model]();
      this.mount(model, plane, base, site.turn ?? 0);
    }
    this.marks = [{ lat: NYC.lat, lon: NYC.lon }, ...SITES.filter(s => s.model).map(s => ({ lat: s.lat, lon: s.lon }))];
  }

  private mount(model: LandmarkModel, plane: TangentPlane, base: number, turn: number) {
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    const south = plane.north.clone().negate();
    holder.matrix.makeBasis(plane.east, plane.up, south).setPosition(plane.up.clone().multiplyScalar(RADIUS + base));
    model.group.rotation.y = turn;
    model.group.scale.setScalar(MODEL_SCALE);
    holder.add(model.group);
    this.group.add(holder);
    for (const c of model.colliders) {
      // 지역 (x, z) → 회전 → 접평면 (동, 북)
      const cos = Math.cos(turn), sin = Math.sin(turn);
      const k = MODEL_SCALE;
      const x = (c.x * cos + c.z * sin) * k, z = (-c.x * sin + c.z * cos) * k;
      const p = plane.dir(x, -z).multiplyScalar(RADIUS + base);
      const rot = (c.rot ?? 0) + turn;
      const axis = plane.east.clone().multiplyScalar(Math.cos(rot)).addScaledVector(plane.north, Math.sin(rot)).normalize();
      this.obstacles.push(c.r !== undefined && c.hx === undefined
        ? { p, r: c.r * k, height: c.height * k, walkable: true }
        : { p, r: 0, box: { hx: (c.hx ?? 0.5) * k, hz: (c.hz ?? 0.5) * k, axis }, height: c.height * k, walkable: true });
    }
  }

  collect(p: THREE.Vector3, radius: number, out: WorldObstacle[]) {
    for (const o of this.obstacles) {
      const reach = radius + Math.max(o.r, o.box ? Math.hypot(o.box.hx, o.box.hz) : 0);
      // 높은 건물 옥상에 있을 때도 걸리도록 높이만큼 넉넉히 거르고, 정확한 판정은 물리에 맡긴다
      if (o.p.distanceToSquared(p) < (reach + o.height + 2) ** 2) out.push(o);
    }
  }

  /** 가장 가까운 랜드마크 이름 */
  nameAt(dir: THREE.Vector3): string | null {
    let best: string | null = null, bestCos = -2;
    const l = dir.length();
    for (const n of this.named) {
      const c = n.dir.dot(dir) / l;
      if (c > n.cos && c > bestCos) { bestCos = c; best = n.name; }
    }
    return best;
  }

  /** 나무를 심지 않는 곳 (도시, 다듬은 땅) */
  blocksVegetation(dir: THREE.Vector3): boolean {
    for (const b of this.blocks) if (b.dir.dot(dir) > b.cos) return true;
    return false;
  }

  update(camera: THREE.Vector3, time: number, night: number) {
    this.nyc.update(camera, time, night);
  }
}
