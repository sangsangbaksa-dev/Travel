import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from '../terrain/height';
import { CHUNK, ObjectCache, type WorldObj } from './scatter';

// 플레이어 주변 청크를 불러오고 멀어지면 내려놓는다. 지형은 높이 함수를 격자로 샘플링해서 만들고,
// 가장자리 법선은 이웃 청크와 같은 값이 나오도록 한 칸 바깥까지 샘플링한다 (이음새 없음).
const SEG = 32;
const CELL = CHUNK / SEG;
const N = SEG + 1;
const HALO = SEG + 3;
export const LOAD_RADIUS = 3;
const KEEP_RADIUS = 4;

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};
const GRASS_LOW = hex('#9be08a');
const GRASS_HIGH = hex('#d6f0a0');
const SAND = hex('#f4e3b0');
const ROCK = hex('#c9c2d6');
const SEABED = hex('#86bdb4');
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerpC = (o: RGB, a: RGB, b: RGB, u: number) => {
  o[0] = a[0] + (b[0] - a[0]) * u;
  o[1] = a[1] + (b[1] - a[1]) * u;
  o[2] = a[2] + (b[2] - a[2]) * u;
};

// 모든 청크가 공유하는 인덱스 / 재료
const sharedIndex = (() => {
  const idx = new Uint16Array(SEG * SEG * 6);
  let k = 0;
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  return new THREE.BufferAttribute(idx, 1);
})();
const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });

function paint(geo: THREE.BufferGeometry, hexColor: string, yMin = 0, yMax = 1, lightHex?: string) {
  const base = new THREE.Color(hexColor);
  const light = new THREE.Color(lightHex ?? hexColor);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const u = lightHex ? clamp01((pos.getY(i) - yMin) / (yMax - yMin || 1)) : 0;
    c.copy(base).lerp(light, u);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function buildTreeGeometry(foliage: string, foliageLight: string) {
  const trunk = paint(new THREE.CylinderGeometry(0.16, 0.22, 1.0, 6).translate(0, 0.5, 0), '#b78d6e');
  const blobs = [
    new THREE.SphereGeometry(0.95, 8, 6).translate(0, 1.5, 0),
    new THREE.SphereGeometry(0.72, 8, 6).translate(0.05, 2.15, 0),
    new THREE.SphereGeometry(0.45, 8, 6).translate(0, 2.65, 0),
  ].map((g) => paint(g, foliage, 0.6, 3.1, foliageLight));
  return mergeGeometries([trunk, ...blobs])!;
}
const treeGeos = [buildTreeGeometry('#86d27f', '#c3ec97'), buildTreeGeometry('#f4a9c4', '#ffd9e6')];
const rockGeo = new THREE.IcosahedronGeometry(1, 0);
const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const rockMat = new THREE.MeshLambertMaterial({ color: '#cdc7dc', flatShading: true });

interface Chunk {
  group: THREE.Group;
  ground: THREE.BufferGeometry;
  instanced: THREE.InstancedMesh[];
}

const hGrid = new Float32Array(HALO * HALO); // 재사용 버퍼

export class ChunkManager {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Chunk>();

  constructor(private readonly terrain: Terrain, private readonly objects: ObjectCache) {}

  get count() {
    return this.chunks.size;
  }

  /** 시작할 때 가까운 청크를 한꺼번에 만들어 둔다 */
  prime(px: number, pz: number, radius = 2) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) this.ensure(ccx + dx, ccz + dz);
  }

  /** 매 프레임 호출. 새 청크는 프레임당 budget개까지만 만든다 (끊김 방지). */
  update(px: number, pz: number, budget = 2) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);

    const wanted: [number, number, number][] = [];
    for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
      for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
        if (!this.chunks.has(`${ccx + dx},${ccz + dz}`)) wanted.push([ccx + dx, ccz + dz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    for (let i = 0; i < Math.min(budget, wanted.length); i++) this.ensure(wanted[i][0], wanted[i][1]);

    for (const [key, chunk] of this.chunks) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - ccx), Math.abs(kz - ccz)) > KEEP_RADIUS) {
        this.dispose(chunk);
        this.chunks.delete(key);
      }
    }
    this.objects.prune(ccx, ccz, KEEP_RADIUS + 2);
  }

  private ensure(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const chunk = this.build(cx, cz);
    this.chunks.set(key, chunk);
    this.group.add(chunk.group);
  }

  private dispose(c: Chunk) {
    this.group.remove(c.group);
    c.ground.dispose();
    for (const m of c.instanced) m.dispose();
  }

  private build(cx: number, cz: number): Chunk {
    const t = this.terrain;
    const water = t.waterLevel ?? -Infinity;
    const ox = cx * CHUNK, oz = cz * CHUNK;

    for (let j = 0; j < HALO; j++) {
      for (let i = 0; i < HALO; i++) hGrid[j * HALO + i] = t.height(ox + (i - 1) * CELL, oz + (j - 1) * CELL);
    }

    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const c: RGB = [0, 0, 0];
    const tmp: RGB = [0, 0, 0];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const h = (jj: number, ii: number) => hGrid[(jj + 1) * HALO + (ii + 1)];
        const y = h(j, i);
        const dx = h(j, i + 1) - h(j, i - 1);
        const dz = h(j + 1, i) - h(j - 1, i);
        const nx = -dx / (2 * CELL), nz = -dz / (2 * CELL);
        const inv = 1 / Math.hypot(nx, 1, nz);
        const o = (j * N + i) * 3;
        pos[o] = i * CELL; pos[o + 1] = y; pos[o + 2] = j * CELL;
        nor[o] = nx * inv; nor[o + 1] = inv; nor[o + 2] = nz * inv;

        // 색: 바다 밑 → 모래 해변 → 잔디(높을수록 밝게) → 바위, 가파른 곳은 바위빛
        if (y < water) {
          lerpC(c, SAND, SEABED, clamp01((water - y) / 3));
        } else {
          lerpC(c, GRASS_LOW, GRASS_HIGH, clamp01((y + 4) / 14));
          lerpC(c, SAND, c, clamp01((y - water - 0.5) / 1.4));
          if (y > 9) lerpC(c, c, ROCK, clamp01((y - 9) / 6));
        }
        const steep = clamp01((0.86 - nor[o + 1]) / 0.16);
        if (steep > 0) { tmp[0] = c[0]; tmp[1] = c[1]; tmp[2] = c[2]; lerpC(c, tmp, ROCK, steep); }
        const shade = ((cx * SEG + i + cz * SEG + j) & 1) === 0 ? 1 : 0.972;
        col[o] = c[0] * shade; col[o + 1] = c[1] * shade; col[o + 2] = c[2] * shade;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(sharedIndex);
    geo.computeBoundingSphere();

    const group = new THREE.Group();
    group.position.set(ox, 0, oz);
    group.add(new THREE.Mesh(geo, groundMat));

    const instanced = this.buildObjects(this.objects.get(cx, cz), ox, oz);
    for (const m of instanced) group.add(m);
    return { group, ground: geo, instanced };
  }

  private buildObjects(list: WorldObj[], ox: number, oz: number): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const tint = new THREE.Color();

    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, objs: WorldObj[], flat: boolean) => {
      if (objs.length === 0) return;
      const mesh = new THREE.InstancedMesh(geo, mat, objs.length);
      objs.forEach((o, i) => {
        q.setFromAxisAngle(up, o.rot);
        p.set(o.x - ox, o.y, o.z - oz);
        if (flat) s.set(o.scale, o.scale * 0.55, o.scale);
        else s.setScalar(o.scale);
        mesh.setMatrixAt(i, m4.compose(p, q, s));
        const v = 0.9 + ((Math.sin(o.x * 12.9898 + o.z * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.16;
        mesh.setColorAt(i, tint.setRGB(v, v, v));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      out.push(mesh);
    };
    make(treeGeos[0], treeMat, list.filter((o) => o.kind === 'tree' && o.variant === 0), false);
    make(treeGeos[1], treeMat, list.filter((o) => o.kind === 'tree' && o.variant === 1), false);
    make(rockGeo, rockMat, list.filter((o) => o.kind === 'rock'), true);
    return out;
  }
}
