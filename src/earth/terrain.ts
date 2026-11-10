import * as THREE from 'three';
import { RADIUS } from './geo';
import type { Planet } from './planet';
import { groundColor, samplePicture } from './surface';

// 정육면체를 부풀린 구(큐브 스피어) 위의 쿼드트리 지형. 카메라에 가까운 곳은 잘게, 먼 곳은 굵게 나눈다.
// 노드마다 32×32칸 격자이고, 이웃 노드와의 틈은 아래로 늘어뜨린 "치마"로 가린다.

const S = 32;
const N = S + 1;
const G = N + 2; // 법선 계산용으로 한 칸씩 더 샘플링한다
export const MAX_LEVEL = 9;
const SPLIT = 1.9;
const BUILD_BUDGET_MS = 7;

/** 면 번호와 면 좌표 (a, b ∈ [-1, 1]) → 단위 방향 */
export function faceDir(face: number, a: number, b: number, out: THREE.Vector3): THREE.Vector3 {
  // 각도를 고르게 만드는 탄젠트 보정
  const u = Math.tan(a * Math.PI / 4), v = Math.tan(b * Math.PI / 4);
  switch (face) {
    case 0: out.set(1, v, -u); break;
    case 1: out.set(-1, v, u); break;
    case 2: out.set(u, 1, -v); break;
    case 3: out.set(u, -1, v); break;
    case 4: out.set(u, v, 1); break;
    default: out.set(-u, v, -1); break;
  }
  return out.normalize();
}

/** 단위 방향 → 면 번호와 면 좌표 */
export function dirFace(d: THREE.Vector3): { face: number; a: number; b: number } {
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  let face: number, u: number, v: number;
  if (ax >= ay && ax >= az) {
    if (d.x > 0) { face = 0; u = -d.z / ax; v = d.y / ax; } else { face = 1; u = d.z / ax; v = d.y / ax; }
  } else if (ay >= az) {
    if (d.y > 0) { face = 2; u = d.x / ay; v = -d.z / ay; } else { face = 3; u = d.x / ay; v = d.z / ay; }
  } else if (d.z > 0) { face = 4; u = d.x / az; v = d.y / az; } else { face = 5; u = -d.x / az; v = d.y / az; }
  return { face, a: Math.atan(u) * 4 / Math.PI, b: Math.atan(v) * 4 / Math.PI };
}

class Node {
  mesh: THREE.Mesh | null = null;
  children: Node[] | null = null;
  lastUsed = 0;
  queued = false;
  readonly center = new THREE.Vector3();
  /** 노드 한 변의 대략적인 길이 (칸) */
  readonly edge: number;
  minH = 0;
  maxH = 0;

  constructor(readonly face: number, readonly level: number, readonly a0: number, readonly b0: number, readonly size: number) {
    faceDir(face, a0 + size / 2, b0 + size / 2, this.center);
    this.edge = size * RADIUS * Math.PI / 4;
  }

  get key() { return `${this.face}/${this.level}/${this.a0}/${this.b0}`; }
}

// 노드마다 같은 인덱스 (치마 포함)
function buildIndex(flip: boolean): THREE.BufferAttribute {
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const a = j * N + i;
    quad(a, a + 1, a + N, a + N + 1);
  }
  // 치마: 가장자리 정점 N*N 이후에 4변 × N개
  const base = N * N;
  const edges = [
    (k: number) => k, // 아래 변 (j=0)
    (k: number) => (S - k) + S * N, // 위 변 (j=S), 반대 방향
    (k: number) => (S - k) * N, // 왼쪽 (i=0)
    (k: number) => k * N + S, // 오른쪽 (i=S)
  ];
  edges.forEach((edge, e) => {
    for (let k = 0; k < S; k++) {
      const top0 = edge(k), top1 = edge(k + 1);
      const low0 = base + e * N + k, low1 = base + e * N + k + 1;
      const sides = e === 0 || e === 3 ? !flip : flip;
      if (sides) idx.push(top0, low0, top1, top1, low0, low1); else idx.push(top0, top1, low0, top1, low1, low0);
    }
  });
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

export class PlanetTerrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  readonly sunDir = { value: new THREE.Vector3(1, 0, 0) };
  private readonly roots: Node[] = [];
  private readonly indices: THREE.BufferAttribute[] = [];
  private readonly queue: Node[] = [];
  private frameNo = 0;
  private meshCount = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly col = [0, 0, 0];
  private readonly lights = [0, 0, 0];

  constructor(private readonly planet: Planet) {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const sunDir = this.sunDir;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = sunDir;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aLights;\nuniform vec3 uSunDir;\nvarying float vLights;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 wn = normalize(mat3(modelMatrix) * normal);
          vLights = aLights * smoothstep(0.04, -0.12, dot(wn, uSunDir));`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLights;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * vLights;');
    };
    // 면마다 바깥을 향하도록 감는 방향을 고른다
    for (let f = 0; f < 6; f++) {
      const p0 = faceDir(f, 0, 0, new THREE.Vector3());
      const pa = faceDir(f, 0.01, 0, new THREE.Vector3()).sub(p0);
      const pb = faceDir(f, 0, 0.01, new THREE.Vector3()).sub(p0);
      const n = new THREE.Vector3().crossVectors(pa, pb);
      this.indices.push(buildIndex(n.dot(p0) < 0));
      this.roots.push(new Node(f, 0, -1, -1, 2));
    }
  }

  get count() { return this.meshCount; }

  /** 카메라 위치에 맞춰 보일 노드를 고르고, 정해진 시간 안에서 새 노드를 만든다 */
  update(camera: THREE.Vector3, budgetMs = BUILD_BUDGET_MS) {
    this.frameNo++;
    for (const c of this.group.children) c.visible = false;
    this.queue.length = 0;
    const camLen = camera.length();
    const horizon = Math.acos(Math.min(1, (RADIUS - 130) / Math.max(camLen, RADIUS - 129)));
    for (const r of this.roots) this.visit(r, camera, camLen, horizon);
    // 가까운(작은) 노드부터 만든다
    this.queue.sort((a, b) => this.priority(a, camera) - this.priority(b, camera));
    const start = performance.now();
    for (const node of this.queue) {
      node.queued = false;
      if (performance.now() - start > budgetMs) break;
      if (!node.mesh) this.build(node);
    }
    if (this.frameNo % 120 === 0) this.prune();
  }

  /** 지금 필요한 노드를 모두 다 만들 때까지 반복한다 (시작 화면용) */
  prime(camera: THREE.Vector3, maxMs = 6000) {
    const start = performance.now();
    do {
      this.update(camera, 50);
    } while (this.queue.some(n => !n.mesh) && performance.now() - start < maxMs);
    this.update(camera, 0);
  }

  private priority(n: Node, cam: THREE.Vector3) {
    return this.tmp.copy(n.center).multiplyScalar(RADIUS).distanceTo(cam) - n.level * 40;
  }

  private distance(n: Node, cam: THREE.Vector3) {
    const p = this.tmp.copy(n.center).multiplyScalar(RADIUS + (n.minH + n.maxH) / 2);
    const radius = n.edge * 0.72 + (n.maxH - n.minH) / 2;
    return Math.max(0, p.distanceTo(cam) - radius);
  }

  private request(n: Node) {
    if (!n.mesh && !n.queued) { n.queued = true; this.queue.push(n); }
  }

  /** 노드 영역을 메시로 다 덮었으면 true */
  private visit(n: Node, cam: THREE.Vector3, camLen: number, horizon: number): boolean {
    // 지평선 너머의 노드는 건너뛴다
    const ang = Math.acos(Math.max(-1, Math.min(1, n.center.dot(this.tmp2.copy(cam).divideScalar(camLen)))));
    if (n.level > 0 && ang > horizon + n.edge * 0.8 / RADIUS + 0.19) return true;
    n.lastUsed = this.frameNo;
    if (n.level < MAX_LEVEL && this.distance(n, cam) < n.edge * SPLIT) {
      if (!n.children) {
        const h = n.size / 2;
        n.children = [
          new Node(n.face, n.level + 1, n.a0, n.b0, h), new Node(n.face, n.level + 1, n.a0 + h, n.b0, h),
          new Node(n.face, n.level + 1, n.a0, n.b0 + h, h), new Node(n.face, n.level + 1, n.a0 + h, n.b0 + h, h),
        ];
        for (const c of n.children) { c.minH = n.minH; c.maxH = n.maxH; }
      }
      if (n.children.every(c => c.mesh)) {
        let all = true;
        for (const c of n.children) all = this.visit(c, cam, camLen, horizon) && all;
        return all;
      }
      for (const c of n.children) { c.lastUsed = this.frameNo; this.request(c); }
    }
    if (n.mesh) { n.mesh.visible = true; return true; }
    this.request(n);
    // 아직 못 만들었으면 남아 있는 자식들로 대신 메운다
    if (n.children && n.children.every(c => c.mesh)) {
      for (const c of n.children) { c.mesh!.visible = true; c.lastUsed = this.frameNo; }
      return true;
    }
    return false;
  }

  private build(n: Node) {
    const planet = this.planet;
    const step = n.size / S;
    // 1) 한 칸 바깥까지 위치를 샘플링
    const P = new Float64Array(G * G * 3);
    const H = new Float32Array(G * G);
    const d = this.tmp;
    let minH = Infinity, maxH = -Infinity;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      faceDir(n.face, n.a0 + (i - 1) * step, n.b0 + (j - 1) * step, d);
      const h = planet.height(d.x, d.y, d.z);
      const k = j * G + i;
      H[k] = h;
      const r = RADIUS + h;
      P[k * 3] = d.x * r; P[k * 3 + 1] = d.y * r; P[k * 3 + 2] = d.z * r;
      if (i > 0 && j > 0 && i < G - 1 && j < G - 1) { minH = Math.min(minH, h); maxH = Math.max(maxH, h); }
    }
    n.minH = minH; n.maxH = maxH;

    const cx = n.center.x * RADIUS, cy = n.center.y * RADIUS, cz = n.center.z * RADIUS;
    const vcount = N * N + 4 * N;
    const pos = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    const colors = new Float32Array(vcount * 3);
    const lights = new Float32Array(vcount);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), nn = new THREE.Vector3();
    const col = this.col;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (j + 1) * G + (i + 1);
      const v = j * N + i;
      const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
      pos[v * 3] = x - cx; pos[v * 3 + 1] = y - cy; pos[v * 3 + 2] = z - cz;
      a.set(P[(k + 1) * 3] - P[(k - 1) * 3], P[(k + 1) * 3 + 1] - P[(k - 1) * 3 + 1], P[(k + 1) * 3 + 2] - P[(k - 1) * 3 + 2]);
      b.set(P[(k + G) * 3] - P[(k - G) * 3], P[(k + G) * 3 + 1] - P[(k - G) * 3 + 1], P[(k + G) * 3 + 2] - P[(k - G) * 3 + 2]);
      nn.crossVectors(a, b).normalize();
      const r = Math.hypot(x, y, z);
      const ux = x / r, uy = y / r, uz = z / r;
      if (nn.x * ux + nn.y * uy + nn.z * uz < 0) nn.negate();
      nor[v * 3] = nn.x; nor[v * 3 + 1] = nn.y; nor[v * 3 + 2] = nn.z;
      const slope = 1 - Math.min(1, nn.x * ux + nn.y * uy + nn.z * uz);
      const lat = Math.asin(uy) * 57.29577951308232, lon = Math.atan2(-uz, ux) * 57.29577951308232;
      groundColor(planet.earth, ux, uy, uz, lat, lon, H[k], Math.min(1, slope * 3.2), col);
      planet.elevation.shapeColor(ux, uy, uz, col);
      colors[v * 3] = col[0]; colors[v * 3 + 1] = col[1]; colors[v * 3 + 2] = col[2];
      if (H[k] > 0) {
        samplePicture(planet.night, lat, lon, this.lights);
        lights[v] = Math.min(1, Math.max(0, this.lights[0] * 0.5 + this.lights[1] * 0.5 - 0.02) * 2.2);
      }
    }
    // 치마
    const skirt = Math.max(0.6, n.edge / S * 2.5);
    const edgeVerts = [
      (k: number) => k, (k: number) => (S - k) + S * N, (k: number) => (S - k) * N, (k: number) => k * N + S,
    ];
    edgeVerts.forEach((edge, e) => {
      for (let k = 0; k < N; k++) {
        const src = edge(k), dst = N * N + e * N + k;
        const x = pos[src * 3] + cx, y = pos[src * 3 + 1] + cy, z = pos[src * 3 + 2] + cz;
        const r = Math.hypot(x, y, z), s = (r - skirt) / r;
        pos[dst * 3] = x * s - cx; pos[dst * 3 + 1] = y * s - cy; pos[dst * 3 + 2] = z * s - cz;
        for (let c = 0; c < 3; c++) { nor[dst * 3 + c] = nor[src * 3 + c]; colors[dst * 3 + c] = colors[src * 3 + c]; }
        lights[dst] = lights[src];
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aLights', new THREE.BufferAttribute(lights, 1));
    geo.setIndex(this.indices[n.face]);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(cx, cy, cz);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    n.mesh = mesh;
    this.group.add(mesh);
    this.meshCount++;
  }

  /** 오래 쓰지 않은 노드의 메시를 내려놓는다 */
  private prune() {
    const old = this.frameNo - 300;
    const walk = (n: Node) => {
      if (n.children) {
        for (const c of n.children) walk(c);
        if (n.children.every(c => !c.mesh && !c.children && c.lastUsed < old)) n.children = null;
      }
      if (n.level > 1 && n.mesh && n.lastUsed < old) {
        this.group.remove(n.mesh);
        n.mesh.geometry.dispose();
        n.mesh = null;
        this.meshCount--;
      }
    };
    for (const r of this.roots) walk(r);
  }
}
