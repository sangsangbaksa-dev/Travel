import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldObstacle, WorldObstacleSource } from './body';
import { RADIUS } from './geo';
import type { Planet } from './planet';
import { samplePicture, TREE, vegetation, type TreeKind } from './surface';
import { dirFace, faceDir } from './terrain';

// 나무: 큐브 스피어 면 좌표의 촘촘한 격자(약 2칸)마다 해시로 한 그루씩 심을지 정한다.
// 같은 좌표면 언제나 같은 결과라서 렌더링과 충돌이 일치한다. 플레이어 근처 타일만 만든다.

const CELL = 2 / 1024;
const TILE = 32;
const VIEW = 420;
const KINDS = [TREE.broadleaf, TREE.conifer, TREE.palm, TREE.birch, TREE.shrub] as const;
/** 종류별 실제 크기 배율: treeGeometry는 약 3~4 단위이고 1 단위 = 1 m */
const KIND_SCALE: Partial<Record<TreeKind, number>> = {
  [TREE.broadleaf]: 4, [TREE.conifer]: 4.5, [TREE.palm]: 3.4, [TREE.birch]: 4, [TREE.shrub]: 2.5,
};
/** 나무 키(충돌 높이, m) */
const TREE_HEIGHT = 15;
/** 줄기 색 표시: 정점 색 r이 음수면 셰이더가 줄기 색으로 칠한다 */
const TRUNK = -1;

function paint(g: THREE.BufferGeometry, r: number, gg = r, b = r): THREE.BufferGeometry {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.index) return g.toNonIndexed();
  return g;
}

function treeGeometry(kind: TreeKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = (r0: number, r1: number, h: number) => paint(new THREE.CylinderGeometry(r0, r1, h, 6).translate(0, h / 2, 0), TRUNK);
  const leaf = (g: THREE.BufferGeometry) => paint(g, 1);
  switch (kind) {
    case TREE.broadleaf:
      parts.push(trunk(0.13, 0.2, 1.7));
      parts.push(leaf(new THREE.IcosahedronGeometry(1.25, 1).scale(1, 0.85, 1).translate(0, 2.5, 0)));
      parts.push(leaf(new THREE.IcosahedronGeometry(0.8, 1).translate(0.55, 3.1, 0.2)));
      break;
    case TREE.conifer:
      parts.push(trunk(0.1, 0.16, 1.2));
      parts.push(leaf(new THREE.ConeGeometry(1.05, 2.1, 7).translate(0, 1.9, 0)));
      parts.push(leaf(new THREE.ConeGeometry(0.8, 1.8, 7).translate(0, 2.9, 0)));
      parts.push(leaf(new THREE.ConeGeometry(0.5, 1.4, 7).translate(0, 3.8, 0)));
      break;
    case TREE.palm: {
      for (let i = 0; i < 4; i++) parts.push(paint(new THREE.CylinderGeometry(0.11, 0.14, 0.9, 6).rotateZ(0.08 * i).translate(0.06 * i * i, 0.45 + i * 0.85, 0), TRUNK));
      for (let i = 0; i < 7; i++) {
        const blade = new THREE.ConeGeometry(0.22, 1.9, 4).rotateZ(Math.PI / 2 + 0.5).translate(0.95, 0, 0).rotateY((i / 7) * Math.PI * 2);
        parts.push(leaf(blade.translate(0.55, 3.45, 0)));
      }
      break;
    }
    case TREE.birch:
      parts.push(paint(new THREE.CylinderGeometry(0.09, 0.12, 2.4, 6).translate(0, 1.2, 0), TRUNK));
      parts.push(leaf(new THREE.IcosahedronGeometry(0.8, 1).scale(0.8, 1.4, 0.8).translate(0, 2.8, 0)));
      break;
    default:
      parts.push(leaf(new THREE.IcosahedronGeometry(0.55, 0).scale(1, 0.7, 1).translate(0, 0.35, 0)));
      parts.push(leaf(new THREE.IcosahedronGeometry(0.4, 0).translate(0.4, 0.3, 0.2)));
  }
  return mergeGeometries(parts);
}

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Tile {
  key: string;
  meshes: THREE.InstancedMesh[];
  /** 칸 → 나무 위치(밑동, 행성 좌표)와 반지름. 없으면 null */
  cells: ({ p: THREE.Vector3; r: number } | null)[];
  lastNeeded: number;
}

export class Vegetation implements WorldObstacleSource {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  private readonly geos = new Map<TreeKind, THREE.BufferGeometry>();
  private readonly material: THREE.MeshLambertMaterial;
  private readonly wanted: { key: string; face: number; ti: number; tj: number }[] = [];
  private timer = 0;
  private clock = 0;
  private readonly autumn: number;
  private readonly tmp = new THREE.Vector3();
  private readonly col = [0, 0, 0];
  private readonly q = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly planet: Planet, private readonly blocker: { blocksVegetation(d: THREE.Vector3): boolean }) {
    for (const k of KINDS) this.geos.set(k, treeGeometry(k));
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
        if (color.r < 0.0) vColor.rgb = vec3(-1.0);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if (vColor.r < 0.0) diffuseColor.rgb = vec3(0.16, 0.11, 0.07);`);
    };
    // 북반구 가을(9~11월)에는 활엽수가 물든다
    const month = new Date().getMonth();
    this.autumn = month >= 8 && month <= 10 ? 1 : 0;
  }

  update(player: THREE.Vector3) {
    this.clock++;
    if (--this.timer <= 0) {
      this.timer = 20;
      this.collectWanted(player);
    }
    // 한 프레임에 타일 하나씩
    for (const w of this.wanted) {
      const t = this.tiles.get(w.key);
      if (t) { t.lastNeeded = this.clock; continue; }
      this.build(w.key, w.face, w.ti, w.tj);
      break;
    }
    if (this.clock % 300 === 0) {
      for (const [k, t] of this.tiles) {
        if (this.clock - t.lastNeeded < 600) continue;
        for (const m of t.meshes) { this.group.remove(m); m.dispose(); }
        this.tiles.delete(k);
      }
    }
  }

  private collectWanted(player: THREE.Vector3) {
    this.wanted.length = 0;
    const seen = new Set<string>();
    const up = this.tmp.copy(player).normalize();
    const e = new THREE.Vector3(up.z, 0, -up.x);
    if (e.lengthSq() < 1e-6) e.set(1, 0, 0);
    e.normalize();
    const n = new THREE.Vector3().crossVectors(up, e);
    const p = new THREE.Vector3();
    const list: { key: string; face: number; ti: number; tj: number; d: number }[] = [];
    for (let y = -VIEW; y <= VIEW; y += 90) for (let x = -VIEW; x <= VIEW; x += 90) {
      const d = Math.hypot(x, y);
      if (d > VIEW) continue;
      p.copy(up).multiplyScalar(RADIUS).addScaledVector(e, x).addScaledVector(n, y).normalize();
      const f = dirFace(p);
      const ti = Math.floor((f.a + 1) / CELL / TILE), tj = Math.floor((f.b + 1) / CELL / TILE);
      const key = `${f.face}/${ti}/${tj}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ key, face: f.face, ti, tj, d });
    }
    list.sort((a, b) => a.d - b.d);
    this.wanted.push(...list);
    for (const w of this.wanted) { const t = this.tiles.get(w.key); if (t) t.lastNeeded = this.clock; }
  }

  private build(key: string, face: number, ti: number, tj: number) {
    const planet = this.planet;
    const per = new Map<TreeKind, THREE.Matrix4[]>();
    const colors = new Map<TreeKind, THREE.Color[]>();
    const cells: Tile['cells'] = new Array(TILE * TILE).fill(null);
    const d = new THREE.Vector3(), d2 = new THREE.Vector3();
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const ci = ti * TILE + i, cj = tj * TILE + j;
      const r0 = hash(face, ci, cj);
      if (r0 > 0.62) continue;
      const a = -1 + (ci + 0.15 + 0.7 * hash(ci, cj, face + 7)) * CELL;
      const b = -1 + (cj + 0.15 + 0.7 * hash(cj, ci, face + 13)) * CELL;
      faceDir(face, a, b, d);
      const h = planet.height(d.x, d.y, d.z);
      if (h < 0.35) continue;
      const lat = Math.asin(d.y) * 57.29577951308232, lon = Math.atan2(-d.z, d.x) * 57.29577951308232;
      samplePicture(planet.earth, lat, lon, this.col);
      for (let c = 0; c < 3; c++) this.col[c] = Math.min(1, 1.75 * Math.pow(this.col[c], 0.86));
      const pre = vegetation(this.col, lat, h, 0);
      if (pre.kind === TREE.none || r0 > pre.density * 0.62) continue;
      // 비탈 확인
      faceDir(face, a + CELL * 0.5, b, d2);
      const slope = Math.abs(planet.height(d2.x, d2.y, d2.z) - h) / (CELL * 0.5 * RADIUS * 0.8);
      if (slope > 1.1) continue;
      if (this.blocker.blocksVegetation(d)) continue;
      const kind = pre.kind;
      const scale = (0.8 + hash(ci + 3, cj, face) * 0.75) * (KIND_SCALE[kind] ?? 1);
      const base = d.clone().multiplyScalar(RADIUS + h - 0.05);
      this.q.setFromUnitVectors(this.up, d);
      const yaw = new THREE.Quaternion().setFromAxisAngle(this.up, hash(ci, cj + 5, face) * 6.283);
      this.q.multiply(yaw);
      this.m.compose(base, this.q, this.s.setScalar(scale));
      if (!per.has(kind)) { per.set(kind, []); colors.set(kind, []); }
      per.get(kind)!.push(this.m.clone());
      colors.get(kind)!.push(this.leafColor(kind, lat, hash(cj, ci, face + 21)));
      if (kind !== TREE.shrub) cells[j * TILE + i] = { p: base, r: 0.15 * scale };
    }
    const meshes: THREE.InstancedMesh[] = [];
    for (const [kind, mats] of per) {
      const mesh = new THREE.InstancedMesh(this.geos.get(kind)!, this.material, mats.length);
      const cs = colors.get(kind)!;
      mats.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, cs[i]); });
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      meshes.push(mesh);
    }
    this.tiles.set(key, { key, meshes, cells, lastNeeded: this.clock });
  }

  private leafColor(kind: TreeKind, lat: number, r: number): THREE.Color {
    const c = new THREE.Color();
    switch (kind) {
      case TREE.conifer: return c.setRGB(0.05 + r * 0.03, 0.12 + r * 0.04, 0.05);
      case TREE.palm: return c.setRGB(0.14 + r * 0.05, 0.26 + r * 0.06, 0.07);
      case TREE.birch: return c.setRGB(0.3 + r * 0.1, 0.36 + r * 0.08, 0.1);
      case TREE.shrub: return c.setRGB(0.17 + r * 0.06, 0.2 + r * 0.05, 0.08);
      default: {
        // 북반구 온대의 가을 단풍
        const fall = this.autumn * (lat > 28 && lat < 58 ? 1 : 0);
        if (fall && r < 0.75) {
          const hues: [number, number, number][] = [[0.55, 0.18, 0.04], [0.62, 0.36, 0.05], [0.42, 0.1, 0.05], [0.5, 0.42, 0.1]];
          const [rr, gg, bb] = hues[Math.floor(r * 5.33) % 4];
          return c.setRGB(rr, gg, bb);
        }
        return c.setRGB(0.08 + r * 0.06, 0.18 + r * 0.08, 0.05 + r * 0.02);
      }
    }
  }

  collect(p: THREE.Vector3, radius: number, out: WorldObstacle[]) {
    const dir = this.tmp.copy(p).normalize();
    const f = dirFace(dir);
    const ci = Math.floor((f.a + 1) / CELL), cj = Math.floor((f.b + 1) / CELL);
    const reach = Math.ceil(radius / 7) + 1;
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const i = ci + di, j = cj + dj;
      const t = this.tiles.get(`${f.face}/${Math.floor(i / TILE)}/${Math.floor(j / TILE)}`);
      if (!t) continue;
      const cell = t.cells[(((j % TILE) + TILE) % TILE) * TILE + (((i % TILE) + TILE) % TILE)];
      if (cell) out.push({ p: cell.p, r: cell.r, height: TREE_HEIGHT, walkable: false });
    }
  }
}
