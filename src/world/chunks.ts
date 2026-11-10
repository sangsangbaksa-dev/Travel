import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BIOMES, biomeWeights } from '../terrain/biome';
import type { Terrain } from '../terrain/height';
import { CHUNK, ObjectCache, VARIANT, VARIANT_COUNT, type WorldObj } from './scatter';
import { isCave } from './passages';
import { VOLCANO } from './volcano';
import { ALPINE_LAKE, alpineDistance } from './alpineLake';

// 플레이어 주변 청크를 불러오고 멀어지면 내려놓는다. 지형은 높이 함수를 격자로 샘플링해서 만들고,
// 가장자리 법선은 이웃 청크와 같은 값이 나오도록 한 칸 바깥까지 샘플링한다 (이음새 없음).
const SEG = 32;
const CELL = CHUNK / SEG;
const N = SEG + 1;
const HALO = SEG + 3;
const CW = SEG / 4 + 1; // 기후는 4칸마다 샘플링해서 보간한다
export const LOAD_RADIUS = 3;
const KEEP_RADIUS = 4;

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerpC = (o: RGB, a: RGB, b: RGB, u: number) => {
  o[0] = a[0] + (b[0] - a[0]) * u;
  o[1] = a[1] + (b[1] - a[1]) * u;
  o[2] = a[2] + (b[2] - a[2]) * u;
};

// 생태계별 지면 색 (낮은 곳, 높은 곳) — BIOMES 순서와 같다.
// 채도를 낮추고 바이옴 간에 온도를 갈라, 나무·바위·건물이 지면 위에 또렷이 앉게 한다.
const GROUND: [RGB, RGB][] = [
  [hex('#5fa85a'), hex('#c2cc7a')], // meadow: 진한 잔디 → 햇살 받은 마른 풀
  [hex('#a8c07a'), hex('#e0b8c4')], // blossom: 연두 잔디 → 먼지 앉은 장미빛
  [hex('#c4843c'), hex('#e3b85c')], // autumn: 호박·황토
  [hex('#e0c48a'), hex('#f0e2bc')], // desert: 따뜻한 모래 (가을보다 옅고 덜 주황)
  [hex('#2e7a4e'), hex('#6aaa58')], // tropical: 깊은 밀림 초록 (기존 민트를 고침)
  [hex('#d2e0ec'), hex('#f2f6fa')], // snow: 순백을 피해 소나무·바위가 드러나게
  [hex('#8a7cb8'), hex('#cfc4e4')], // crystal: 살짝 가라앉힌 라벤더, 수정이 돋보이게
  [hex('#4e9a80'), hex('#b0a8c4')], // mushroom: 이끼 청록 → 엷은 보라
];
const SAND = hex('#ead4a0');
const SNOW_SAND = hex('#dce8f2');
const ROCK = hex('#9a9388');
const SNOW = hex('#f4f7fb');
const SEA_SHALLOW = hex('#5eb8c4');
const SEA_DEEP = hex('#2d6a8c');
const FOAM = hex('#eef4f2');
const CAVE_GROUND = hex('#6a6560');
const VOLCANIC_ROCK = hex('#4e4844');
const LAKE_GRAVEL = hex('#a49d8a');
const LAKE_BOTTOM = hex('#3d6e68');
const ROCK_TINT: RGB[] = [
  [1, 0.98, 0.92], [1, 0.94, 0.96], [1, 0.88, 0.78], [1, 0.86, 0.68],
  [0.95, 1, 0.92], [0.94, 0.98, 1], [0.92, 0.88, 1], [0.88, 1, 0.96],
];

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

// ---- 나무 모양들 (정점 색으로 칠한 병합 지오메트리) ----
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

function roundTree(foliage: string, light: string) {
  const trunk = paint(new THREE.CylinderGeometry(0.16, 0.22, 1.0, 6).translate(0, 0.5, 0), '#8d6a4e');
  const blobs = [
    new THREE.SphereGeometry(0.95, 8, 6).translate(0, 1.5, 0),
    new THREE.SphereGeometry(0.72, 8, 6).translate(0.05, 2.15, 0),
    new THREE.SphereGeometry(0.45, 8, 6).translate(0, 2.65, 0),
  ].map((g) => paint(g, foliage, 0.6, 3.1, light));
  return mergeGeometries([trunk, ...blobs])!;
}

function pineTree() {
  const trunk = paint(new THREE.CylinderGeometry(0.14, 0.2, 0.8, 6).translate(0, 0.4, 0), '#6e5340');
  const cones = [
    paint(new THREE.ConeGeometry(1.0, 1.3, 8).translate(0, 1.4, 0), '#2f6a52', 0.75, 2.05, '#7eab8e'),
    paint(new THREE.ConeGeometry(0.78, 1.15, 8).translate(0, 2.1, 0), '#3a7d62', 1.5, 2.7, '#8fbe9e'),
    paint(new THREE.ConeGeometry(0.52, 1.0, 8).translate(0, 2.75, 0), '#4a8f70', 2.25, 3.25, '#c5ddd0'),
  ];
  return mergeGeometries([trunk, ...cones])!;
}

function palmTree() {
  const parts: THREE.BufferGeometry[] = [
    paint(new THREE.CylinderGeometry(0.12, 0.2, 2.4, 6).translate(0, 1.2, 0).rotateZ(0.12), '#b08452'),
  ];
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.SphereGeometry(0.5, 6, 4)
      .scale(1.9, 0.1, 0.55)
      .translate(0.95, 0, 0)
      .rotateZ(-0.45)
      .rotateY((i * Math.PI) / 3)
      .translate(-0.29, 2.4, 0);
    parts.push(paint(leaf, '#2f9a4a'));
  }
  for (const [dx, dz] of [[0.1, 0.1], [-0.1, 0.08], [0.02, -0.12]]) {
    parts.push(paint(new THREE.SphereGeometry(0.13, 6, 4).translate(-0.29 + dx, 2.28, dz), '#6e3f28'));
  }
  return mergeGeometries(parts)!;
}

function cactus() {
  const g = (geo: THREE.BufferGeometry) => paint(geo, '#4ea06a');
  return mergeGeometries([
    g(new THREE.CapsuleGeometry(0.3, 1.2, 4, 8).translate(0, 0.9, 0)),
    g(new THREE.CapsuleGeometry(0.17, 0.45, 4, 6).rotateZ(Math.PI / 2).translate(0.42, 1.0, 0)),
    g(new THREE.CapsuleGeometry(0.17, 0.5, 4, 6).translate(0.7, 1.32, 0)),
    g(new THREE.CapsuleGeometry(0.15, 0.4, 4, 6).rotateZ(Math.PI / 2).translate(-0.38, 0.65, 0)),
    g(new THREE.CapsuleGeometry(0.15, 0.4, 4, 6).translate(-0.62, 0.9, 0)),
    paint(new THREE.SphereGeometry(0.13, 6, 4).translate(0, 1.95, 0), '#e07898'),
  ])!;
}

function crystalCluster(base: string, light: string) {
  const piece = (h: number, r: number, x: number, z: number, tx: number, tz: number) => {
    const body = new THREE.CylinderGeometry(r, r, h, 6).translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, h * 0.38, 6).translate(0, h + h * 0.19, 0);
    const g = mergeGeometries([body, tip])!;
    g.rotateX(tx).rotateZ(tz).translate(x, 0, z);
    return paint(g, base, 0, 2.4, light);
  };
  return mergeGeometries([
    piece(1.5, 0.28, 0, 0, 0, 0),
    piece(1.0, 0.2, 0.42, 0.12, 0.1, -0.35),
    piece(0.8, 0.17, -0.38, -0.1, -0.12, 0.4),
    piece(0.55, 0.14, 0.1, -0.4, 0.4, 0.05),
    piece(0.45, 0.12, -0.15, 0.38, -0.35, -0.1),
  ])!;
}

function mushroom(cap: string, capLight: string, spot: string) {
  const stem = paint(new THREE.CylinderGeometry(0.22, 0.3, 1.0, 8).translate(0, 0.5, 0), '#e8d5b8');
  const dome = new THREE.SphereGeometry(0.95, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1).translate(0, 1.0, 0);
  const under = paint(new THREE.CircleGeometry(0.95, 12).rotateX(Math.PI / 2).translate(0, 1.0, 0), '#d4b896');
  const parts: THREE.BufferGeometry[] = [stem, paint(dome, cap, 1.0, 1.8, capLight), under];
  for (const [x, y, z, r] of [[0.45, 1.58, 0.2, 0.15], [-0.35, 1.62, -0.3, 0.13], [0.02, 1.78, 0.0, 0.14], [-0.2, 1.52, 0.5, 0.1]]) {
    parts.push(paint(new THREE.SphereGeometry(r, 6, 4).scale(1, 0.5, 1).translate(x, y, z), spot));
  }
  return mergeGeometries(parts)!;
}

function floatingIsland() {
  const top = new THREE.CylinderGeometry(1.5, 1.35, 0.45, 10).translate(0, 0, 0);
  const under = new THREE.ConeGeometry(1.35, 2.2, 8).rotateX(Math.PI).translate(0, -1.3, 0);
  const crystal = mergeGeometries([
    new THREE.CylinderGeometry(0.2, 0.2, 0.9, 6).translate(0.45, 0.65, 0.1),
    new THREE.ConeGeometry(0.2, 0.35, 6).translate(0.45, 1.27, 0.1),
  ])!;
  const tree = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5).translate(-0.5, 0.42, -0.2), '#8d6a4e'),
    paint(new THREE.SphereGeometry(0.34, 7, 5).translate(-0.5, 0.82, -0.2), '#4f9a4a', 0.5, 1.2, '#9ccc6e'),
  ])!;
  return mergeGeometries([
    paint(top, '#5fa85a'),
    paint(under, '#6e6294', -2.4, -0.2, '#b8a8d8'),
    paint(crystal, '#6ad4ef', 0.2, 1.5, '#d4f4fb'),
    tree,
  ])!;
}

function runeDecal() {
  const parts: THREE.BufferGeometry[] = [
    new THREE.RingGeometry(1.05, 1.3, 40),
    new THREE.RingGeometry(0.55, 0.64, 32),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(new THREE.CircleGeometry(0.1, 8).translate(Math.cos(a) * 0.85, Math.sin(a) * 0.85, 0));
  }
  // 안쪽 별 무늬
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.22;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  parts.push(new THREE.ShapeGeometry(star));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!.rotateX(-Math.PI / 2).translate(0, 0.07, 0);
}

// VARIANT 순서: green, pink, orange, pine, palm, cactus, crystal x3, mushroom x2
const treeGeos: THREE.BufferGeometry[] = [
  roundTree('#3f8f48', '#8fbf5e'),
  roundTree('#c56e90', '#efb8c8'),
  roundTree('#c25a28', '#e89848'),
  pineTree(),
  palmTree(),
  cactus(),
  crystalCluster('#7a58d8', '#d4c4f8'),
  crystalCluster('#2aa8c8', '#b8eaf6'),
  crystalCluster('#d060b0', '#f4c8e6'),
  mushroom('#d45a78', '#f0a8b8', '#f4efe6'),
  mushroom('#3a86d0', '#8ec8f0', '#e6f4fa'),
];
const floatGeo = floatingIsland();
const runeGeo = runeDecal();
const beamGeo = new THREE.CylinderGeometry(0.95, 1.15, 9, 20, 1, true).translate(0, 4.5, 0);
const rockGeo = new THREE.IcosahedronGeometry(1, 0);
const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const rockMat = new THREE.MeshLambertMaterial({ color: '#b5afa4', flatShading: true });
const floatMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#6b4bd8', emissiveIntensity: 0.1 });

// 밤에 더 밝게 빛나는 마법 재료들
const glow = (emissive: string, base: number, nightGain: number) => ({
  mat: new THREE.MeshLambertMaterial({ vertexColors: true, emissive, emissiveIntensity: base }),
  base,
  nightGain,
});
const GLOWS = {
  violet: glow('#6b4bd8', 0.3, 1.0),
  cyan: glow('#1fa6c9', 0.3, 1.0),
  pink: glow('#c24aa0', 0.3, 1.0),
  red: glow('#a02850', 0.12, 0.35),
  blue: glow('#2a6fd0', 0.45, 1.2),
};
// VARIANT 순서에 맞춘 재료
const variantMats: THREE.Material[] = [
  treeMat, treeMat, treeMat, treeMat, treeMat, treeMat,
  GLOWS.violet.mat, GLOWS.cyan.mat, GLOWS.pink.mat, GLOWS.red.mat, GLOWS.blue.mat,
];
const runeMat = new THREE.MeshBasicMaterial({ color: '#b08cff', transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, blending: THREE.AdditiveBlending });
const beamMat = new THREE.MeshBasicMaterial({ color: '#7a55ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });

/** 낮밤에 따른 마법 재료의 빛남 정도. night: 0(낮)~1(밤) */
export function setMagicGlow(night: number) {
  for (const g of Object.values(GLOWS)) g.mat.emissiveIntensity = g.base + g.nightGain * night;
  floatMat.emissiveIntensity = 0.1 + 0.5 * night;
}

interface Chunk {
  group: THREE.Group;
  ground: THREE.BufferGeometry;
  instanced: THREE.InstancedMesh[];
  /** 둥둥 떠다니는 섬 묶음 (있을 때만) */
  floaters: THREE.InstancedMesh | null;
  phase: number;
}

const hGrid = new Float32Array(HALO * HALO); // 재사용 버퍼
const cGrid = new Float32Array(CW * CW * BIOMES.length);
const wTmp = new Array<number>(BIOMES.length).fill(0);

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

  /** 매 프레임 호출. 새 청크는 시간 예산(ms) 안에서만 만든다 (끊김 방지). */
  update(px: number, pz: number, budgetMs = 4) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);

    const wanted: [number, number, number][] = [];
    for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
      for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
        if (!this.chunks.has(`${ccx + dx},${ccz + dz}`)) wanted.push([ccx + dx, ccz + dz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    const t0 = performance.now();
    for (const [cx, cz] of wanted) {
      this.ensure(cx, cz);
      if (performance.now() - t0 > budgetMs) break; // 최소 1개는 만든다
    }

    for (const [key, chunk] of this.chunks) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - ccx), Math.abs(kz - ccz)) > KEEP_RADIUS) {
        this.dispose(chunk);
        this.chunks.delete(key);
      }
    }
    this.objects.prune(ccx, ccz, KEEP_RADIUS + 2);
  }

  /** 마법 요소 애니메이션: 섬이 둥실거리고 마법진이 숨쉬듯 빛난다 */
  animate(time: number) {
    runeMat.opacity = 0.65 + 0.25 * Math.sin(time * 2.2);
    beamMat.opacity = 0.15 + 0.06 * Math.sin(time * 1.6);
    for (const c of this.chunks.values()) {
      if (c.floaters) c.floaters.position.y = Math.sin(time * 0.7 + c.phase) * 0.45;
    }
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
    const seaLevel = t.waterLevel ?? -Infinity;
    const ox = cx * CHUNK, oz = cz * CHUNK;

    for (let j = 0; j < HALO; j++) {
      for (let i = 0; i < HALO; i++) hGrid[j * HALO + i] = t.height(ox + (i - 1) * CELL, oz + (j - 1) * CELL);
    }
    // 생태계 가중치: 성긴 격자에서 계산해 보간한다
    for (let j = 0; j < CW; j++) {
      for (let i = 0; i < CW; i++) {
        const c = t.climate ? t.climate(ox + i * 4 * CELL, oz + j * 4 * CELL) : { temp: 0.1, moist: -0.25, magic: 0, kind: 0 };
        biomeWeights(c, wTmp);
        cGrid.set(wTmp, (j * CW + i) * BIOMES.length);
      }
    }

    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const c: RGB = [0, 0, 0];
    const tmp: RGB = [0, 0, 0];
    const w = new Array<number>(BIOMES.length).fill(0);
    const K = BIOMES.length;
    for (let j = 0; j < N; j++) {
      const fj = j / 4, j0 = Math.min(Math.floor(fj), CW - 2), tj = fj - j0;
      for (let i = 0; i < N; i++) {
        const h = (jj: number, ii: number) => hGrid[(jj + 1) * HALO + (ii + 1)];
        const y = h(j, i);
        const wx = ox + i * CELL, wz = oz + j * CELL;
        const byLake = alpineDistance(wx, wz) < 1.19;
        const water = byLake ? ALPINE_LAKE.level : seaLevel;
        const dx = h(j, i + 1) - h(j, i - 1);
        const dz = h(j + 1, i) - h(j - 1, i);
        const nx = -dx / (2 * CELL), nz = -dz / (2 * CELL);
        const inv = 1 / Math.hypot(nx, 1, nz);
        const o = (j * N + i) * 3;
        pos[o] = i * CELL; pos[o + 1] = y; pos[o + 2] = j * CELL;
        nor[o] = nx * inv; nor[o + 1] = inv; nor[o + 2] = nz * inv;

        // 생태계 가중치 (이중선형 보간)
        const fi = i / 4, i0 = Math.min(Math.floor(fi), CW - 2), ti = fi - i0;
        for (let k = 0; k < K; k++) {
          const a = cGrid[(j0 * CW + i0) * K + k], b = cGrid[(j0 * CW + i0 + 1) * K + k];
          const cc = cGrid[((j0 + 1) * CW + i0) * K + k], d = cGrid[((j0 + 1) * CW + i0 + 1) * K + k];
          w[k] = (a + (b - a) * ti) * (1 - tj) + (cc + (d - cc) * ti) * tj;
        }
        const snowW = w[5];

        // 색을 섞을 때는 비중이 큰 생태계를 더 강조한다 (경계에서 색이 탁해지지 않게)
        const u = clamp01((y + 4) / 14);
        c[0] = c[1] = c[2] = 0;
        let wsum = 0;
        for (let k = 0; k < K; k++) wsum += w[k] * w[k] * Math.sqrt(w[k]);
        for (let k = 0; k < K; k++) {
          const [lo, hi] = GROUND[k];
          const wk = (w[k] * w[k] * Math.sqrt(w[k])) / wsum;
          c[0] += wk * (lo[0] + (hi[0] - lo[0]) * u);
          c[1] += wk * (lo[1] + (hi[1] - lo[1]) * u);
          c[2] += wk * (lo[2] + (hi[2] - lo[2]) * u);
        }

        if (y < water) {
          // 바다 밑: 얕은 곳은 모래빛 → 청록 → 깊은 곳은 푸른색
          const depth = water - y;
          if (byLake) lerpC(c, LAKE_GRAVEL, LAKE_BOTTOM, clamp01(depth / 7));
          else {
            lerpC(tmp, SAND, SEA_SHALLOW, clamp01(depth / 2));
            lerpC(c, tmp, SEA_DEEP, clamp01((depth - 2.5) / 12));
          }
        } else {
          // 해변: 물가는 모래 (설원은 얼어붙은 해안)
          lerpC(tmp, byLake ? LAKE_GRAVEL : SAND, SNOW_SAND, snowW);
          lerpC(c, tmp, c, clamp01((y - water - 0.5) / 1.4));
          // 높은 곳: 바위 → 만년설
          lerpC(c, c, ROCK, clamp01((y - 11) / 6) * (1 - 0.7 * snowW));
          lerpC(c, c, SNOW, clamp01((y - 20) / 5));
        }
        // 가파른 곳은 바위빛
        const steep = clamp01((0.86 - nor[o + 1]) / 0.16);
        if (steep > 0) { tmp[0] = c[0]; tmp[1] = c[1]; tmp[2] = c[2]; lerpC(c, tmp, ROCK, steep * 0.9); }
        // 물가 거품
        const foam = clamp01(1 - Math.abs(y - water) / 0.22) * 0.5;
        if (foam > 0) { tmp[0] = c[0]; tmp[1] = c[1]; tmp[2] = c[2]; lerpC(c, tmp, FOAM, foam); }

        const volcanic = clamp01((125 - Math.hypot(wx - VOLCANO.x, wz - VOLCANO.z)) / 28) * clamp01((y - water) / 3);
        if (volcanic > 0 || isCave(wx, wz)) {
          tmp[0] = c[0]; tmp[1] = c[1]; tmp[2] = c[2];
          lerpC(c, tmp, isCave(wx, wz) ? CAVE_GROUND : VOLCANIC_ROCK, isCave(wx, wz) ? .9 : volcanic * .85);
        }

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

    const { meshes: instanced, floaters } = this.buildObjects(this.objects.get(cx, cz), ox, oz);
    for (const m of instanced) group.add(m);
    return { group, ground: geo, instanced, floaters, phase: cx * 1.7 + cz * 2.3 };
  }

  private buildObjects(list: WorldObj[], ox: number, oz: number): { meshes: THREE.InstancedMesh[]; floaters: THREE.InstancedMesh | null } {
    const out: THREE.InstancedMesh[] = [];
    let floaters: THREE.InstancedMesh | null = null;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const tint = new THREE.Color();

    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, objs: WorldObj[], rock: boolean, plain = false): THREE.InstancedMesh | null => {
      if (objs.length === 0) return null;
      const mesh = new THREE.InstancedMesh(geo, mat, objs.length);
      objs.forEach((o, i) => {
        q.setFromAxisAngle(up, o.rot);
        p.set(o.x - ox, o.y, o.z - oz);
        if (rock) s.set(o.scale, o.scale * 0.55, o.scale);
        else s.setScalar(o.scale);
        mesh.setMatrixAt(i, m4.compose(p, q, s));
        const v = 0.9 + ((((Math.sin(o.x * 12.9898 + o.z * 78.233) * 43758.5453) % 1) + 1) % 1) * 0.16;
        if (plain) return;
        if (rock) {
          const t = ROCK_TINT[o.biome] ?? ROCK_TINT[0];
          mesh.setColorAt(i, tint.setRGB(t[0] * v, t[1] * v, t[2] * v));
        } else mesh.setColorAt(i, tint.setRGB(v, v, v));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      out.push(mesh);
      return mesh;
    };
    for (let v = 0; v < VARIANT_COUNT; v++) {
      make(treeGeos[v], variantMats[v], list.filter((o) => o.kind === 'tree' && o.variant === v), false);
    }
    make(rockGeo, rockMat, list.filter((o) => o.kind === 'rock'), true);
    const runes = list.filter((o) => o.kind === 'rune');
    make(runeGeo, runeMat, runes, false, true);
    make(beamGeo, beamMat, runes, false, true);
    floaters = make(floatGeo, floatMat, list.filter((o) => o.kind === 'float'), false, true);
    return { meshes: out, floaters };
  }
}

export { VARIANT };
