import * as THREE from 'three';
import type { Terrain } from './height';

// 임시 렌더 지형: 플레이어를 따라 움직이는 격자. 청크 시스템이 들어오면 교체된다.
const SEGMENTS = 160;
const SIZE = 200;
const CELL = SIZE / SEGMENTS;

const GRASS_LOW = new THREE.Color('#9be08a');
const GRASS_HIGH = new THREE.Color('#d6f0a0');
const SAND = new THREE.Color('#f4e3b0');
const ROCK = new THREE.Color('#c9c2d6');

export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.PlaneGeometry;
  private cx = Number.NaN;
  private cz = Number.NaN;
  private readonly tmp = new THREE.Color();

  constructor(private readonly terrain: Terrain) {
    this.geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    this.geo.rotateX(-Math.PI / 2);
    this.geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(this.geo.attributes.position.count * 3), 3),
    );
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** 플레이어 위치에 맞춰 격자를 옮긴다 (격자 간격 단위로 스냅 → 출렁임 없음) */
  update(px: number, pz: number) {
    const cx = Math.round(px / CELL) * CELL;
    const cz = Math.round(pz / CELL) * CELL;
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx;
    this.cz = cz;
    this.mesh.position.set(cx, 0, cz);

    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const col = this.geo.attributes.color as THREE.BufferAttribute;
    const h = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const wx = cx + pos.getX(i);
      const wz = cz + pos.getZ(i);
      const y = this.terrain.height(wx, wz);
      h[i] = y;
      pos.setY(i, y);
    }
    for (let i = 0; i < pos.count; i++) {
      const y = h[i];
      // 완만한 곳은 잔디, 낮은 곳은 모래빛, 높은 곳은 바위빛
      const t = THREE.MathUtils.clamp((y + 4) / 14, 0, 1);
      this.tmp.copy(GRASS_LOW).lerp(GRASS_HIGH, t);
      if (y < -3) this.tmp.lerp(SAND, THREE.MathUtils.clamp((-3 - y) / 3, 0, 1));
      if (y > 9) this.tmp.lerp(ROCK, THREE.MathUtils.clamp((y - 9) / 6, 0, 1));
      // 잔잔한 체크무늬 결 (거리감용)
      const ix = Math.round((cx + pos.getX(i)) / CELL);
      const iz = Math.round((cz + pos.getZ(i)) / CELL);
      const shade = ((ix + iz) & 1) === 0 ? 1 : 0.97;
      col.setXYZ(i, this.tmp.r * shade, this.tmp.g * shade, this.tmp.b * shade);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
