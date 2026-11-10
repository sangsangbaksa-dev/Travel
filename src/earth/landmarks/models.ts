import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Coarse solid footprint in the landmark's local frame (y-up, origin at ground, +z = south). */
export interface Collider {
  /** local center x, z of the footprint */
  x: number;
  z: number;
  /** box half extents (axis aligned in local frame before rot) — or r for cylinder */
  hx?: number;
  hz?: number;
  r?: number;
  /** rotation around y in radians */
  rot?: number;
  /** height of the solid part above ground; the player can stand on top */
  height: number;
}

export interface LandmarkModel {
  group: THREE.Group;
  colliders: Collider[];
}

type V3 = [number, number, number];
type Rot = V3 | THREE.Quaternion;

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// ---------------------------------------------------------------------------
// Materials (module-level cache, flat shading for the low-poly look)
// ---------------------------------------------------------------------------

const matCache = new Map<string, THREE.MeshLambertMaterial>();

function mat(color: string, double = false): THREE.MeshLambertMaterial {
  const key = `${color}|${double ? 2 : 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      side: double ? THREE.DoubleSide : THREE.FrontSide,
    });
    matCache.set(key, m);
  }
  return m;
}

const COL = {
  eiffel: '#6b5a45',
  sandstone: '#c9a66b',
  wall: '#8a8173',
  marble: '#f1ede4',
  pool: '#2f5c78',
  hedge: '#4e6e3a',
  travertine: '#c9b79c',
  travertineLight: '#d8c7a8',
  goldStone: '#c8a76a',
  spire: '#3b3a3a',
  podium: '#b8b4ab',
  shell: '#f4f2ec',
  soap: '#d9d4c7',
  glass: '#9fb3c4',
  steel: '#d6dde3',
  concrete: '#e8e6e1',
  concretePod: '#d9d5cc',
  concreteBase: '#cfc9bd',
  red: '#c8102e',
  white: '#f5f5f2',
  clockFace: '#f3ead2',
  clockHand: '#222222',
  hull: '#2c2a27',
  rust: '#6b3f2a',
  seabedDebris: '#4a4138',
} as const;

// ---------------------------------------------------------------------------
// Parts: collects transformed primitives per material and merges them
// ---------------------------------------------------------------------------

class Parts {
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** Adds a freshly created geometry, transformed into the local frame. */
  add(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    pos: V3 = [0, 0, 0],
    rot: Rot = [0, 0, 0],
    scale: V3 = [1, 1, 1],
  ): this {
    // Normalise to non-indexed, position + normal only, so all geometries can be merged.
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    const q =
      rot instanceof THREE.Quaternion
        ? rot.clone()
        : new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(pos[0], pos[1], pos[2]),
      q,
      new THREE.Vector3(scale[0], scale[1], scale[2]),
    );
    g.applyMatrix4(m);
    const list = this.buckets.get(material);
    if (list) list.push(g);
    else this.buckets.set(material, [g]);
    return this;
  }

  box(w: number, h: number, d: number, m: THREE.Material, pos: V3, rot?: Rot): this {
    return this.add(new THREE.BoxGeometry(w, h, d), m, pos, rot);
  }

  cyl(rt: number, rb: number, h: number, seg: number, m: THREE.Material, pos: V3, rot?: Rot): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), m, pos, rot);
  }

  /** Thin box stretched between two points. */
  beam(a: V3, b: V3, thick: number, m: THREE.Material): this {
    const A = new THREE.Vector3(a[0], a[1], a[2]);
    const B = new THREE.Vector3(b[0], b[1], b[2]);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize(),
    );
    const mid = A.clone().add(B).multiplyScalar(0.5);
    return this.add(new THREE.BoxGeometry(thick, len, thick), m, [mid.x, mid.y, mid.z], q);
  }

  build(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      if (merged) group.add(new THREE.Mesh(merged, material));
    }
    return group;
  }
}

/** Surface of revolution for onion domes and chhatris: r(t) bulges then closes to a point. */
function domeGeometry(R: number, H: number, radial: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(R * Math.sin(Math.PI * Math.pow(t, 0.6)), H * t));
  }
  return new THREE.LatheGeometry(pts, radial);
}

/** Thin curved sail: a patch of a sphere, lowered so its base sits on y = 0. */
function sailGeometry(height: number, thetaL: number, phiL: number, yaw: number, lean: number): THREE.BufferGeometry {
  const R = height / (1 - Math.cos(thetaL));
  const g = new THREE.SphereGeometry(R, 10, 8, 0, phiL, 0, thetaL);
  g.rotateZ(lean);
  g.rotateY(yaw);
  g.computeBoundingBox();
  const minY = g.boundingBox ? g.boundingBox.min.y : 0;
  g.translate(0, -minY, 0);
  return g;
}

/**
 * Ring-shaped wall between ellipse (a, b) outer and (ai, bi) inner, in the XZ plane,
 * with top height h(theta). Non-indexed, normals computed from winding.
 */
function ringWallGeometry(
  a: number,
  b: number,
  ai: number,
  bi: number,
  hAt: (theta: number) => number,
  segs: number,
): THREE.BufferGeometry {
  const v: number[] = [];
  const tri = (p0: V3, p1: V3, p2: V3): void => {
    v.push(...p0, ...p1, ...p2);
  };
  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * TAU;
    const t1 = ((i + 1) / segs) * TAU;
    const h0 = hAt(t0);
    const h1 = hAt(t1);
    const ob0: V3 = [a * Math.cos(t0), 0, b * Math.sin(t0)];
    const ot0: V3 = [a * Math.cos(t0), h0, b * Math.sin(t0)];
    const ob1: V3 = [a * Math.cos(t1), 0, b * Math.sin(t1)];
    const ot1: V3 = [a * Math.cos(t1), h1, b * Math.sin(t1)];
    const ib0: V3 = [ai * Math.cos(t0), 0, bi * Math.sin(t0)];
    const it0: V3 = [ai * Math.cos(t0), h0, bi * Math.sin(t0)];
    const ib1: V3 = [ai * Math.cos(t1), 0, bi * Math.sin(t1)];
    const it1: V3 = [ai * Math.cos(t1), h1, bi * Math.sin(t1)];
    // outer face
    tri(ob0, ot0, ot1);
    tri(ob0, ot1, ob1);
    // inner face (toward the arena)
    tri(ib0, ib1, it1);
    tri(ib0, it1, it0);
    // top
    tri(ot0, it0, it1);
    tri(ot0, it1, ot1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// 1. Eiffel Tower (27 tall)
// ---------------------------------------------------------------------------

// Half-width of the four legs as a function of height (piecewise linear, curved look).
const EIFFEL_HW: [number, number][] = [
  [0, 5.2],
  [4.8, 3.2],
  [9.6, 2.0],
  [15, 1.4],
  [23, 0.9],
];

function eiffelHW(y: number): number {
  for (let i = 0; i < EIFFEL_HW.length - 1; i++) {
    const [y0, h0] = EIFFEL_HW[i];
    const [y1, h1] = EIFFEL_HW[i + 1];
    if (y <= y1) return h0 + ((h1 - h0) * (y - y0)) / (y1 - y0);
  }
  return EIFFEL_HW[EIFFEL_HW.length - 1][1];
}

export function buildEiffelTower(): LandmarkModel {
  const p = new Parts();
  const iron = mat(COL.eiffel);
  const corners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  const levels = [0, 4.8, 9.6, 15, 23];

  // Legs: stacked segments following the curve.
  for (const [sx, sz] of corners) {
    for (let i = 0; i < levels.length - 1; i++) {
      const y0 = levels[i];
      const y1 = levels[i + 1];
      p.beam([sx * eiffelHW(y0), y0, sz * eiffelHW(y0)], [sx * eiffelHW(y1), y1, sz * eiffelHW(y1)], 0.5, iron);
    }
  }
  // Lattice X-bracing on each face.
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    for (let s = 0; s < levels.length - 1; s++) {
      const y0 = levels[s];
      const y1 = levels[s + 1];
      const hw0 = eiffelHW(y0);
      const hw1 = eiffelHW(y1);
      p.beam([ax * hw0, y0, az * hw0], [bx * hw1, y1, bz * hw1], 0.3, iron);
      p.beam([bx * hw0, y0, bz * hw0], [ax * hw1, y1, az * hw1], 0.3, iron);
    }
  }
  // Horizontal ring braces.
  for (const y of [4.8, 9.6, 15, 23]) {
    const hw = eiffelHW(y);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      p.beam([ax * hw, y, az * hw], [bx * hw, y, bz * hw], 0.3, iron);
    }
  }
  // Platforms.
  p.box(7.4, 0.4, 7.4, iron, [0, 4.8, 0]);
  p.box(4.4, 0.4, 4.4, iron, [0, 9.6, 0]);
  p.box(2.2, 0.4, 2.2, iron, [0, 23, 0]);
  // Tapering spire, 23 -> 27.
  p.cyl(0.05, 0.5, 4, 4, iron, [0, 25, 0], [0, Math.PI / 4, 0]);

  const colliders: Collider[] = [];
  for (const [sx, sz] of corners) colliders.push({ x: sx * 4.2, z: sz * 4.2, r: 0.9, height: 4.8 });
  colliders.push({ x: 0, z: 0, hx: 3.7, hz: 3.7, height: 4.8 });
  colliders.push({ x: 0, z: 0, hx: 2.2, hz: 2.2, height: 9.6 });
  colliders.push({ x: 0, z: 0, hx: 1.1, hz: 1.1, height: 23 });

  return { group: p.build('eiffelTower'), colliders };
}

// ---------------------------------------------------------------------------
// 2. Giza pyramids
// ---------------------------------------------------------------------------

/** Square pyramid built from a 4-sided cone; base side = 2 * half. */
function addPyramid(p: Parts, cx: number, cz: number, half: number, h: number, m: THREE.Material): void {
  const r = half * Math.SQRT2; // circumradius of a square with side 2*half
  p.add(new THREE.ConeGeometry(r, h, 4), m, [cx, h / 2, cz], [0, Math.PI / 4, 0]);
}

/** Four stacked steps approximating a pyramid's silhouette. */
function pyramidColliders(cx: number, cz: number, half: number, h: number): Collider[] {
  const out: Collider[] = [];
  for (let k = 0; k < 4; k++) {
    const hw = half * (1 - k / 4);
    out.push({ x: cx, z: cz, hx: hw, hz: hw, height: (h * (k + 1)) / 4 });
  }
  return out;
}

export function buildGizaPyramids(): LandmarkModel {
  const root = new THREE.Group();
  root.name = 'gizaPyramids';
  const sand = mat(COL.sandstone);
  const p = new Parts();

  addPyramid(p, 0, 0, 9.5, 11.5, sand); // Great Pyramid
  addPyramid(p, -18, 18, 9, 11, sand); // Khafre
  addPyramid(p, -30, 34, 4.5, 5.5, sand); // Menkaure
  root.add(p.build('pyramids'));

  // Sphinx, facing east (+x), centred at (14, 10).
  const s = new Parts();
  s.box(3.4, 1.2, 1.9, sand, [-1.5, 0.6, 0]); // haunches
  s.box(2.4, 1.2, 1.9, sand, [1.0, 0.6, 0]); // chest
  s.box(1.0, 1.4, 1.0, sand, [2.0, 1.0, 0]); // head and nemes
  s.box(1.2, 0.35, 0.8, sand, [1.9, 0.18, -0.6]); // paws
  s.box(1.2, 0.35, 0.8, sand, [1.9, 0.18, 0.6]);
  const sphinx = s.build('sphinx');
  sphinx.position.set(14, 0, 10);
  root.add(sphinx);

  const colliders: Collider[] = [
    ...pyramidColliders(0, 0, 9.5, 11.5),
    ...pyramidColliders(-18, 18, 9, 11),
    ...pyramidColliders(-30, 34, 4.5, 5.5),
    { x: 14, z: 10, hx: 2.9, hz: 0.95, height: 1.7 },
  ];
  return { group: root, colliders };
}

// ---------------------------------------------------------------------------
// 3. Great Wall
// ---------------------------------------------------------------------------

const GW_SEGMENTS = 12;

/**
 * 120-unit wall along x with a gentle zig-zag. heightAt(x, z) sets each piece's base height
 * (the piece uses the height at its midpoint); defaults to flat.
 */
export function buildGreatWall(heightAt: (x: number, z: number) => number = () => 0): LandmarkModel {
  const p = new Parts();
  const stone = mat(COL.wall);
  const colliders: Collider[] = [];

  // Waypoints every 10 units along x, from -60 to +60.
  const pts: [number, number][] = [];
  for (let k = 0; k <= GW_SEGMENTS; k++) {
    const x = -60 + k * 10;
    const z = 2.6 * Math.sin(k * 0.55) + 1.1 * Math.sin(k * 1.7 + 0.4);
    pts.push([x, z]);
  }

  for (let k = 0; k < GW_SEGMENTS; k++) {
    const [x0, z0] = pts[k];
    const [x1, z1] = pts[k + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const L = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const base = heightAt(mx, mz);

    // Wall body (slight overlap at joints).
    p.box(L + 0.1, 0.8, 0.55, stone, [mx, base + 0.4, mz], [0, yaw, 0]);
    colliders.push({ x: mx, z: mz, hx: L / 2 + 0.05, hz: 0.275, rot: yaw, height: base + 0.8 });

    // Crenellations: a merlon every unit along the top.
    for (let j = 0; j < 10; j++) {
      const s = (j + 0.5) / 10;
      p.box(0.45, 0.32, 0.62, stone, [x0 + dx * s, base + 0.96, z0 + dz * s], [0, yaw, 0]);
    }
  }

  // Watchtowers every 20 units (at even waypoints).
  for (let k = 0; k <= GW_SEGMENTS; k += 2) {
    const [x, z] = pts[k];
    const base = heightAt(x, z);
    p.box(2, 1.6, 2, stone, [x, base + 0.8, z]);
    colliders.push({ x, z, hx: 1, hz: 1, height: base + 1.6 });
  }

  return { group: p.build('greatWall'), colliders };
}

// ---------------------------------------------------------------------------
// 4. Taj Mahal
// ---------------------------------------------------------------------------

export function buildTajMahal(): LandmarkModel {
  const p = new Parts();
  const marble = mat(COL.marble);
  const colliders: Collider[] = [];

  // Square plinth 8 x 8 x 0.6.
  p.box(8, 0.6, 8, marble, [0, 0.3, 0]);
  colliders.push({ x: 0, z: 0, hx: 4, hz: 4, height: 0.6 });

  // Main octagonal body (across flats 4.8), y 0.6 -> 3.9.
  p.cyl(2.6, 2.6, 3.3, 8, marble, [0, 2.25, 0], [0, Math.PI / 8, 0]);
  colliders.push({ x: 0, z: 0, hx: 2.4, hz: 2.4, height: 3.9 });

  // Drum and main onion dome, 4.25 -> 6.0.
  p.cyl(1.4, 1.4, 0.35, 16, marble, [0, 4.075, 0]);
  p.add(domeGeometry(1.3, 1.75, 16), marble, [0, 4.25, 0]);
  p.cyl(0.05, 0.05, 0.4, 6, marble, [0, 6.2, 0]);
  p.add(new THREE.SphereGeometry(0.1, 8, 6), marble, [0, 6.4, 0]);

  // Four small domed chhatris at the inner corners.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 2.5;
      const z = sz * 2.5;
      p.cyl(0.42, 0.42, 0.6, 12, marble, [x, 0.9, z]);
      p.add(domeGeometry(0.45, 0.55, 10), marble, [x, 1.2, z]);
      p.cyl(0.02, 0.02, 0.2, 4, marble, [x, 1.85, z]);
      colliders.push({ x, z, r: 0.45, height: 1.2 });
    }
  }

  // Four minarets at the plinth corners, 3.6 tall shafts.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 3.4;
      const z = sz * 3.4;
      p.cyl(0.24, 0.36, 3.6, 10, marble, [x, 2.4, z]);
      p.cyl(0.46, 0.46, 0.14, 12, marble, [x, 2.2, z]);
      p.cyl(0.46, 0.46, 0.14, 12, marble, [x, 3.5, z]);
      p.add(new THREE.ConeGeometry(0.34, 0.6, 10), marble, [x, 4.5, z]);
      colliders.push({ x, z, r: 0.4, height: 4.2 });
    }
  }

  // Reflecting pool to the south (+z), flush with the ground.
  const pool = mat(COL.pool);
  p.box(3, 0.06, 18, pool, [0, 0.03, 14]);

  // Low garden hedges along the pool.
  const hedge = mat(COL.hedge);
  for (const sx of [-1, 1]) {
    p.box(1, 0.8, 18, hedge, [sx * 2.5, 0.4, 14]);
    colliders.push({ x: sx * 2.5, z: 14, hx: 0.5, hz: 9, height: 0.8 });
  }

  return { group: p.build('tajMahal'), colliders };
}

// ---------------------------------------------------------------------------
// 5. Colosseum
// ---------------------------------------------------------------------------

const COL_A = 7.9; // outer radius x
const COL_B = 6.5; // outer radius z
const COL_AI = 3.6; // arena radius x
const COL_BI = 2.3; // arena radius z
const COL_SEGS = 96;
const COL_PILLARS = 32;
const COL_TIERS: [number, number][] = [
  [0.2, 1.2],
  [1.5, 2.5],
  [2.8, 3.8],
];

/** Wall top height: 4 everywhere except a ruined, lower stretch on the south side. */
function colosseumHeight(theta: number): number {
  let d = Math.abs(theta - HALF_PI);
  if (d > Math.PI) d = TAU - d;
  const r = Math.min(1, Math.max(0, 1 - d / 0.9));
  const s = r * r * (3 - 2 * r); // smoothstep
  return 4 - 2.5 * s;
}

export function buildColosseum(): LandmarkModel {
  const p = new Parts();
  const travertine = mat(COL.travertine);
  const light = mat(COL.travertineLight);
  const colliders: Collider[] = [];

  p.add(ringWallGeometry(COL_A, COL_B, COL_AI, COL_BI, colosseumHeight, COL_SEGS), travertine);

  // Arches suggested by repeated engaged pillars on three tiers, only where the wall is tall enough.
  for (let k = 0; k < COL_PILLARS; k++) {
    const theta = ((k + 0.5) / COL_PILLARS) * TAU;
    const px = COL_A * Math.cos(theta);
    const pz = COL_B * Math.sin(theta);
    const nLen = Math.hypot(Math.cos(theta) / COL_A, Math.sin(theta) / COL_B);
    const nx = Math.cos(theta) / COL_A / nLen;
    const nz = Math.sin(theta) / COL_B / nLen;
    const yaw = Math.atan2(nx, nz);
    const h = colosseumHeight(theta);
    for (const [lo, hi] of COL_TIERS) {
      if (h < hi) continue;
      p.box(0.42, hi - lo, 0.26, light, [px + nx * 0.12, (lo + hi) / 2, pz + nz * 0.12], [0, yaw, 0]);
    }
  }

  // Approximate the ring with 12 boxes around the ellipse.
  const midA = (COL_A + COL_AI) / 2;
  const midB = (COL_B + COL_BI) / 2;
  const arc = (Math.PI * (3 * (midA + midB) - Math.sqrt((3 * midA + midB) * (midA + 3 * midB)))) / 12;
  for (let k = 0; k < 12; k++) {
    const theta = ((k + 0.5) / 12) * TAU;
    const cx = midA * Math.cos(theta);
    const cz = midB * Math.sin(theta);
    const tx = -midA * Math.sin(theta);
    const tz = midB * Math.cos(theta);
    colliders.push({
      x: cx,
      z: cz,
      hx: arc / 2,
      hz: (COL_A - COL_AI) / 2,
      rot: Math.atan2(-tz, tx),
      height: colosseumHeight(theta),
    });
  }

  return { group: p.build('colosseum'), colliders };
}

// ---------------------------------------------------------------------------
// 6. Big Ben (Elizabeth Tower) + Palace of Westminster wing
// ---------------------------------------------------------------------------

/** Clock face disc with two hands, on a face of the tower at distance 0.7 from the axis. */
function clockFace(p: Parts, cx: number, cy: number, cz: number, facing: 'x' | 'z', sign: number): void {
  const disc = mat(COL.clockFace);
  const hand = mat(COL.clockHand);
  const out = 0.7;
  const face: V3 = facing === 'z' ? [cx, cy, cz + sign * out] : [cx + sign * out, cy, cz];
  // Disc, slightly proud of the wall.
  if (facing === 'z') {
    p.cyl(0.5, 0.5, 0.06, 20, disc, [face[0], face[1], face[2] + sign * 0.03], [HALF_PI, 0, 0]);
  } else {
    p.cyl(0.5, 0.5, 0.06, 20, disc, [face[0] + sign * 0.03, face[1], face[2]], [0, 0, HALF_PI]);
  }
  // Hour and minute hands, pivoting at the centre.
  const hands: [number, number, number][] = [
    [0.9, 0.3, 0.05], // angle from 12 o'clock (clockwise), length, width
    [2.6, 0.45, 0.03],
  ];
  for (const [a, len, w] of hands) {
    const dU = Math.sin(a);
    const dV = Math.cos(a);
    if (facing === 'z') {
      p.box(w, len, 0.03, hand, [face[0] + dU * len / 2, face[1] + dV * len / 2, face[2] + sign * 0.06], [0, 0, -a]);
    } else {
      p.box(0.03, len, w, hand, [face[0] + sign * 0.06, face[1] + dV * len / 2, face[2] + dU * len / 2], [a, 0, 0]);
    }
  }
}

export function buildBigBen(): LandmarkModel {
  const p = new Parts();
  const stone = mat(COL.goldStone);
  const spire = mat(COL.spire);
  const colliders: Collider[] = [];

  // Tower shaft 1.4 x 1.4, y 0 -> 6.0.
  p.box(1.4, 6.0, 1.4, stone, [0, 3.0, 0]);
  // Belfry stage, y 6.0 -> 6.8.
  p.box(1.2, 0.8, 1.2, stone, [0, 6.4, 0]);
  // Dark spire, 6.8 -> 8.0.
  p.cyl(0.02, 0.75, 1.2, 4, spire, [0, 7.4, 0], [0, Math.PI / 4, 0]);

  // Clock faces on all four sides, near the top of the shaft.
  clockFace(p, 0, 5.2, 0, 'z', 1);
  clockFace(p, 0, 5.2, 0, 'z', -1);
  clockFace(p, 0, 5.2, 0, 'x', 1);
  clockFace(p, 0, 5.2, 0, 'x', -1);

  // Palace of Westminster wing, 20 x 2.5 x 2.2, to the south (+z), attached to the tower.
  p.box(20, 2.5, 2.2, stone, [0, 1.25, 1.8]);
  // Small roof pavilions on the wing.
  p.box(1.6, 0.7, 1.6, stone, [-6, 2.85, 1.8]);
  p.box(1.6, 0.7, 1.6, stone, [6, 2.85, 1.8]);

  colliders.push({ x: 0, z: 0, hx: 0.7, hz: 0.7, height: 6.8 });
  colliders.push({ x: 0, z: 1.8, hx: 10, hz: 1.1, height: 2.5 });
  colliders.push({ x: -6, z: 1.8, hx: 0.8, hz: 0.8, height: 3.2 });
  colliders.push({ x: 6, z: 1.8, hx: 0.8, hz: 0.8, height: 3.2 });

  return { group: p.build('bigBen'), colliders };
}

// ---------------------------------------------------------------------------
// 7. Sydney Opera House
// ---------------------------------------------------------------------------

export function buildSydneyOperaHouse(): LandmarkModel {
  const p = new Parts();
  const podium = mat(COL.podium);
  const shell = mat(COL.shell, true);
  const colliders: Collider[] = [];

  // Podium 15 x 9 x 0.6.
  p.box(15, 0.6, 9, podium, [0, 0.3, 0]);
  colliders.push({ x: 0, z: 0, hx: 7.5, hz: 4.5, height: 0.6 });

  // Three groups of sails. Each sail: [dx, dz, height, yaw, lean].
  const groups: { x: number; sails: [number, number, number, number, number][] }[] = [
    {
      x: -3.6,
      sails: [
        [0, -1.4, 5.5, 0.12, -0.12],
        [0, 0, 4.6, 0, 0],
        [0, 1.4, 3.6, -0.12, 0.12],
      ],
    },
    {
      x: 0.8,
      sails: [
        [0, -1.3, 5.3, 0.1, -0.12],
        [0, 0, 4.4, 0, 0],
        [0, 1.3, 3.2, -0.1, 0.12],
      ],
    },
    {
      x: 4.6,
      sails: [
        [0, -0.8, 3.8, 0.05, -0.1],
        [0, 0.8, 2.7, -0.05, 0.1],
      ],
    },
  ];

  for (const g of groups) {
    for (const [dx, dz, height, yaw, lean] of g.sails) {
      const geo = sailGeometry(height, 1.1, 0.35, yaw, lean);
      p.add(geo, shell, [g.x + dx, 0.6, dz]);
    }
    colliders.push({ x: g.x, z: 0, hx: 1.5, hz: 1.9, height: 1.2 });
  }

  return { group: p.build('operaHouse'), colliders };
}

// ---------------------------------------------------------------------------
// 8. Christ the Redeemer (statue only; the game places it on a hill)
// ---------------------------------------------------------------------------

export function buildChristRedeemer(): LandmarkModel {
  const p = new Parts();
  const soap = mat(COL.soap);

  // Pedestal 0.7 tall.
  p.box(1.8, 0.7, 1.4, soap, [0, 0.35, 0]);
  // Robe body, 0.7 -> 2.4.
  p.box(0.8, 1.7, 0.5, soap, [0, 1.55, 0]);
  // Outstretched arms: crossbar span 2.4 at shoulder height, plus hanging arms.
  p.box(2.4, 0.3, 0.42, soap, [0, 2.45, 0]);
  p.box(0.3, 0.6, 0.3, soap, [-1.2, 2.0, 0]);
  p.box(0.3, 0.6, 0.3, soap, [1.2, 2.0, 0]);
  // Neck and head; statue top at 3.2 (2.5 above the pedestal).
  p.box(0.22, 0.2, 0.22, soap, [0, 2.7, 0]);
  p.add(new THREE.SphereGeometry(0.24, 12, 8), soap, [0, 2.96, 0]);

  const colliders: Collider[] = [
    { x: 0, z: 0, hx: 0.9, hz: 0.7, height: 0.7 },
    { x: 0, z: 0, hx: 0.4, hz: 0.25, height: 2.6 },
  ];
  return { group: p.build('christRedeemer'), colliders };
}

// ---------------------------------------------------------------------------
// 9. Burj Khalifa (Y-plan, stepped)
// ---------------------------------------------------------------------------

const BURJ_STAGES = [
  { y0: 0, y1: 25, L: 4.4, w: 2.2, hub: 1.9 },
  { y0: 25, y1: 45, L: 3.6, w: 1.9, hub: 1.6 },
  { y0: 45, y1: 60, L: 2.8, w: 1.6, hub: 1.3 },
  { y0: 60, y1: 66, L: 2.0, w: 1.3, hub: 1.0 },
];

export function buildBurjKhalifa(): LandmarkModel {
  const p = new Parts();
  const glass = mat(COL.glass);
  const steel = mat(COL.steel);
  const colliders: Collider[] = [];
  const wingAngles = [0, TAU / 3, (2 * TAU) / 3];

  for (const st of BURJ_STAGES) {
    const h = st.y1 - st.y0;
    const yc = st.y0 + h / 2;
    p.cyl(st.hub, st.hub * 1.02, h, 6, glass, [0, yc, 0]);
    for (const th of wingAngles) {
      const dx = Math.cos(th);
      const dz = Math.sin(th);
      const mx = (dx * st.L) / 2;
      const mz = (dz * st.L) / 2;
      // Local x of the box runs along the wing: Ry(-th) maps x onto (cos th, 0, sin th).
      p.box(st.L, h, st.w, glass, [mx, yc, mz], [0, -th, 0]);
      colliders.push({ x: mx, z: mz, hx: st.L / 2, hz: st.w / 2, rot: -th, height: st.y1 });
    }
  }
  colliders.push({ x: 0, z: 0, r: BURJ_STAGES[0].hub, height: BURJ_STAGES[0].y1 });

  // Thin spire, 66 -> 69.
  p.cyl(0.02, 0.22, 3, 4, steel, [0, 67.5, 0], [0, Math.PI / 4, 0]);

  return { group: p.build('burjKhalifa'), colliders };
}

// ---------------------------------------------------------------------------
// 10. N Seoul Tower
// ---------------------------------------------------------------------------

export function buildNSeoulTower(): LandmarkModel {
  const p = new Parts();
  const concrete = mat(COL.concrete);
  const pod = mat(COL.concretePod);
  const base = mat(COL.concreteBase);
  const red = mat(COL.red);
  const white = mat(COL.white);
  const colliders: Collider[] = [];

  // Small base building.
  p.box(3.2, 1.2, 3.2, base, [0, 0.6, 0]);
  colliders.push({ x: 0, z: 0, hx: 1.6, hz: 1.6, height: 1.2 });

  // Concrete shaft, tapering, 1.2 -> 13.
  p.cyl(0.35, 0.6, 11.8, 16, concrete, [0, 7.1, 0]);
  colliders.push({ x: 0, z: 0, r: 0.5, height: 13 });

  // Observation pod: flange, pod body, top ring, roof.
  p.cyl(1.1, 1.1, 0.3, 20, pod, [0, 13.15, 0]);
  p.cyl(1.45, 1.45, 1.3, 24, pod, [0, 13.95, 0]);
  p.cyl(1.35, 1.35, 0.25, 24, pod, [0, 14.72, 0]);
  p.cyl(0.02, 1.6, 0.5, 24, pod, [0, 15.1, 0]);
  colliders.push({ x: 0, z: 0, r: 1.5, height: 15 });

  // Antenna: white lower section, red top.
  p.cyl(0.12, 0.2, 2.25, 8, white, [0, 16.475, 0]);
  p.cyl(0.04, 0.12, 2.0, 8, red, [0, 18.6, 0]);

  return { group: p.build('nSeoulTower'), colliders };
}

// ---------------------------------------------------------------------------
// 11. Titanic wreck (local origin = seabed)
// ---------------------------------------------------------------------------

/** Plan-view outline (x along length, y across beam) of the bow section. */
const TITANIC_BOW_OUTLINE: [number, number][] = [
  [0, -1.2],
  [16, -1.2],
  [20, -0.9],
  [22, 0],
  [20, 0.9],
  [16, 1.2],
  [0, 1.2],
];

/** Plan-view outline of the stern section; its broken end sits at x = 0. */
const TITANIC_STERN_OUTLINE: [number, number][] = [
  [0, -1.2],
  [-12, -1.2],
  [-16, -0.9],
  [-18, 0],
  [-16, 0.9],
  [-12, 1.2],
  [0, 1.2],
];

/** Extrudes a plan outline up to a height; the outline's y becomes world z (beam). */
function hullGeometry(outline: [number, number][], depth: number, scale = 1): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x * scale, y * scale)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(-HALF_PI); // shape y -> -z, extrusion -> +y
  return g;
}

/** Rotate a local point by yaw (three.js Ry convention). */
function rotYPoint(x: number, z: number, a: number): [number, number] {
  return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
}

export function buildTitanicWreck(): LandmarkModel {
  const p = new Parts();
  const hull = mat(COL.hull);
  const rust = mat(COL.rust);
  const debris = mat(COL.seabedDebris);
  const colliders: Collider[] = [];
  const HULL_H = 2.6;

  // Bow section: 22 long, 2.4 beam, half-buried and listing.
  const bowY = -0.5;
  const bowRoll = 0.07;
  p.add(hullGeometry(TITANIC_BOW_OUTLINE, HULL_H), hull, [0, bowY, 0], [0, 0, bowRoll]);
  // Rust-tinted deck plate on top.
  p.add(hullGeometry(TITANIC_BOW_OUTLINE, 0.08, 0.92), rust, [0, bowY + HULL_H, 0], [0, 0, bowRoll]);
  colliders.push({ x: 11, z: 0, hx: 11, hz: 1.2, rot: 0, height: bowY + HULL_H });

  // Stern section: broken end 6 units from the bow, rotated and tilted differently.
  const sternPos: V3 = [-6, -0.6, 0];
  const sternYaw = 0.35;
  const sternRot: V3 = [0.1, sternYaw, 0.16];
  p.add(hullGeometry(TITANIC_STERN_OUTLINE, HULL_H), hull, sternPos, sternRot);
  p.add(hullGeometry(TITANIC_STERN_OUTLINE, 0.08, 0.92), rust, [sternPos[0], sternPos[1] + HULL_H, sternPos[2]], sternRot);
  const [scx, scz] = rotYPoint(-9, 0, sternYaw);
  colliders.push({ x: sternPos[0] + scx, z: sternPos[2] + scz, hx: 9, hz: 1.2, rot: sternYaw, height: sternPos[1] + HULL_H });

  // Two fallen funnels lying on the seabed.
  p.cyl(0.33, 0.33, 1.6, 12, debris, [8.5, 0.33, 3.0], [0, 0.3, HALF_PI]);
  p.cyl(0.33, 0.33, 1.6, 12, debris, [-9.5, 0.33, -3.2], [0, -0.5, HALF_PI]);
  colliders.push({ x: 8.5, z: 3.0, r: 0.33, height: 0.66 });
  colliders.push({ x: -9.5, z: -3.2, r: 0.33, height: 0.66 });

  // Scattered debris, deterministic (Park-Miller PRNG).
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 12; i++) {
    const s = 0.2 + rnd() * 0.5;
    const x = -24 + rnd() * 48;
    const z = -6 + rnd() * 12;
    const m = i % 3 === 0 ? rust : debris;
    p.box(s, s * 0.6, s * 1.4, m, [x, (s * 0.6) / 2, z], [rnd() * 0.5, rnd() * TAU, rnd() * 0.5]);
  }

  return { group: p.build('titanicWreck'), colliders };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type LandmarkName =
  | 'eiffel'
  | 'pyramids'
  | 'greatWall'
  | 'tajMahal'
  | 'colosseum'
  | 'bigBen'
  | 'operaHouse'
  | 'christ'
  | 'burjKhalifa'
  | 'nSeoulTower'
  | 'titanic';

export const LANDMARK_BUILDERS: Record<LandmarkName, () => LandmarkModel> = {
  eiffel: buildEiffelTower,
  pyramids: buildGizaPyramids,
  greatWall: () => buildGreatWall(),
  tajMahal: buildTajMahal,
  colosseum: buildColosseum,
  bigBen: buildBigBen,
  operaHouse: buildSydneyOperaHouse,
  christ: buildChristRedeemer,
  burjKhalifa: buildBurjKhalifa,
  nSeoulTower: buildNSeoulTower,
  titanic: buildTitanicWreck,
};
