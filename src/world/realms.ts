import * as THREE from 'three';
import { noise2, type Terrain } from '../terrain/height';
import { HALF, type PhysicsState } from '../physics/world';

export type Realm = 'surface' | 'cave' | 'sky';
const SIZE = 32;
const SEGMENTS = 16;
const ENTRANCE_Z = -4;
const ENTRANCES = { cave: -5, sky: 5 } as const;
const heightFor = (mode: Realm, x: number, z: number) => {
  const base = mode === 'cave' ? -45 : 65;
  const broad = noise2(x * 0.014, z * 0.014, mode === 'cave' ? 401 : 501);
  const detail = noise2(x * 0.055, z * 0.055, mode === 'cave' ? 402 : 502);
  // 동굴에는 완만한 언덕과 바위 능선, 하늘에는 계곡을 잇는 넓은 초원 능선.
  const ridge = 1 - Math.abs(noise2(x * 0.022, z * 0.022, mode === 'cave' ? 403 : 503));
  const n = mode === 'cave'
    ? broad * 4.5 + detail * 1.3 + ridge * ridge * 2
    : broad * 6 + detail * 1.1 + ridge * ridge * 3;
  // 포털 주변은 안전한 평지
  return base + n * Math.min(1, Math.hypot(x, z) / 12);
};

function caveEntrance(x: number, y: number, z: number): THREE.Group {
  const group = new THREE.Group();
  const rock = new THREE.MeshLambertMaterial({ color: '#77717d', flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: '#292e3c', side: THREE.DoubleSide });
  const opening = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.8), dark);
  opening.position.set(0, 1.4, -0.18);
  group.add(opening);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rock);
    pillar.scale.set(0.58, 1.75, 0.7);
    pillar.position.set(side * 1.55, 1.4, 0);
    group.add(pillar);
  }
  const lintel = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rock);
  lintel.scale.set(2, 0.65, 0.75);
  lintel.position.y = 3.05;
  group.add(lintel);
  group.position.set(x, y, z);
  return group;
}

function stairHeight(base: (x: number, z: number) => number, x: number, z: number, inside: boolean) {
  const i = inside ? Math.floor((-z - 4) / 0.75) : Math.floor((2 - z) / 0.75);
  if (i < 0 || i >= 8) return null;
  const center = inside ? -4 - (i + 0.5) * 0.75 : 2 - (i + 0.5) * 0.75;
  return base(x, center) + (inside ? 8 - i : i + 1) * 0.13;
}

function stairs(base: (x: number, z: number) => number, x: number, inside: boolean): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ color: '#c9c0ad' });
  for (let i = 0; i < 8; i++) {
    const z = inside ? -4 - (i + 0.5) * 0.75 : 2 - (i + 0.5) * 0.75;
    const height = (inside ? 8 - i : i + 1) * 0.13;
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.7, height + 0.15, 0.77), material);
    step.position.set(x, base(x, z) + (height - 0.15) / 2, z);
    group.add(step);
  }
  return group;
}

/** 지상 입구를 지나면 동굴/하늘에 도착하고 같은 길로 돌아온다. */
export class Realms {
  mode: Realm = 'surface';
  readonly terrain: Terrain;
  private readonly surfaceEntrances = new THREE.Group();
  private readonly realmGroup = new THREE.Group();
  private readonly tiles = new Map<string, THREE.Group>();
  private readonly groundMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private readonly caveMaterial = new THREE.MeshLambertMaterial({ color: '#514968', side: THREE.DoubleSide });
  private readonly caveCrystal = new THREE.MeshLambertMaterial({ color: '#80e5d9', emissive: '#207a80', emissiveIntensity: 0.4 });
  private readonly skyStone = new THREE.MeshLambertMaterial({ color: '#c5b7e0' });
  private readonly decoGeometry = new THREE.ConeGeometry(0.45, 2, 6);
  private readonly cloudGeometry = new THREE.SphereGeometry(1, 9, 6);
  private readonly cloudMaterial = new THREE.MeshLambertMaterial({ color: '#f8fbff' });
  private readonly islandGeometry = new THREE.ConeGeometry(1, 2, 7);
  private readonly plantGeometry = new THREE.ConeGeometry(0.22, 0.8, 5);
  private readonly plantMaterial = new THREE.MeshLambertMaterial({ color: '#8cad78' });
  private readonly mushroomGeometry = new THREE.SphereGeometry(0.34, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly mushroomMaterial = new THREE.MeshLambertMaterial({ color: '#94c7b5', emissive: '#2c6558', emissiveIntensity: 0.35 });
  private readonly returnEntrance = new THREE.Group();
  private previousZ: number | null = null;
  private returnX = 0;

  constructor(scene: THREE.Scene, surface: Terrain) {
    const self = this;
    this.terrain = {
      height(x, z) {
        const base = self.mode === 'surface' ? surface.height(x, z) : heightFor(self.mode, x, z);
        const stairX = self.mode === 'surface' ? ENTRANCES.sky : 0;
        if ((self.mode === 'surface' || self.mode === 'sky') && Math.abs(x - stairX) < 1.35) {
          const ground = self.mode === 'surface' ? surface.height : (px: number, pz: number) => heightFor('sky', px, pz);
          const step = stairHeight(ground, stairX, z, self.mode === 'sky');
          if (step !== null) return Math.max(base, step);
        }
        return base;
      },
      get waterLevel() { return self.mode === 'surface' ? surface.waterLevel : -Infinity; },
      climate(x, z) { return surface.climate!(x, z); },
    };
    this.surfaceEntrances.add(caveEntrance(ENTRANCES.cave, surface.height(ENTRANCES.cave, ENTRANCE_Z), ENTRANCE_Z));
    this.surfaceEntrances.add(stairs(surface.height, ENTRANCES.sky, false));
    scene.add(this.surfaceEntrances, this.realmGroup);
    this.realmGroup.add(this.returnEntrance);
    this.returnEntrance.add(caveEntrance(0, heightFor('cave', 0, ENTRANCE_Z), ENTRANCE_Z));
    this.returnEntrance.add(stairs((x, z) => heightFor('sky', x, z), 0, true));
    this.realmGroup.visible = false;
  }

  /** 매 프레임 호출. 전환되면 새 영역 이름을 반환한다. */
  update(state: PhysicsState, surfaceGroup: THREE.Object3D, water: THREE.Object3D): string | null {
    let changed: string | null = null;
    const crossedIn = this.previousZ !== null && this.previousZ > ENTRANCE_Z && state.z <= ENTRANCE_Z;
    const crossedOut = this.previousZ !== null && this.previousZ < ENTRANCE_Z && state.z >= ENTRANCE_Z;
    const atGround = Math.abs(state.y - HALF - this.terrain.height(state.x, state.z)) < 2;
    const entry = this.mode === 'surface' && crossedIn && atGround
      ? (['cave', 'sky'] as const).find((m) => Math.abs(state.x - ENTRANCES[m]) < 1.35)
      : undefined;
    const exit = this.mode !== 'surface' && crossedOut && atGround && Math.abs(state.x) < 1.35;
    if (entry || exit) {
      if (entry) {
        this.returnX = ENTRANCES[entry];
        this.mode = entry;
        state.x = state.px = 0;
        changed = entry === 'cave' ? '지하 동굴' : '하늘 정원';
      } else {
        this.mode = 'surface';
        state.x = state.px = this.returnX;
        changed = '지상';
      }
      state.z = state.pz = ENTRANCE_Z;
      state.y = state.py = this.terrain.height(state.x, state.z) + HALF;
      state.groundY = state.y - HALF;
      state.vx = state.vy = state.vz = 0;
      state.grounded = true;
      state.inWater = false;
      state.submerged = false;
      state.coyote = state.buffer = 0;
      surfaceGroup.visible = water.visible = this.surfaceEntrances.visible = this.mode === 'surface';
      this.realmGroup.visible = this.mode !== 'surface';
      this.clearTiles();
      this.returnEntrance.children[0].visible = this.mode === 'cave';
      this.returnEntrance.children[1].visible = this.mode === 'sky';
    }
    this.previousZ = state.z;
    if (this.mode !== 'surface') this.updateTiles(state.x, state.z);
    return changed;
  }

  private clearTiles() {
    for (const tile of this.tiles.values()) {
      this.realmGroup.remove(tile);
      tile.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh) obj.dispose();
        if (obj instanceof THREE.Mesh && !this.sharedGeometry(obj.geometry)) obj.geometry.dispose();
      });
    }
    this.tiles.clear();
  }

  private updateTiles(x: number, z: number) {
    const cx = Math.floor(x / SIZE), cz = Math.floor(z / SIZE);
    for (const [key, tile] of this.tiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (Math.max(Math.abs(tx - cx), Math.abs(tz - cz)) > 2) {
        this.realmGroup.remove(tile);
        tile.traverse((obj) => {
          if (obj instanceof THREE.InstancedMesh) obj.dispose();
          if (obj instanceof THREE.Mesh && !this.sharedGeometry(obj.geometry)) obj.geometry.dispose();
        });
        this.tiles.delete(key);
      }
    }
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const tx = cx + dx, tz = cz + dz, key = `${tx},${tz}`;
      if (!this.tiles.has(key)) {
        const tile = this.makeTile(tx, tz);
        this.tiles.set(key, tile);
        this.realmGroup.add(tile);
      }
    }
  }

  private sharedGeometry(geometry: THREE.BufferGeometry) {
    return ([this.decoGeometry, this.cloudGeometry, this.islandGeometry, this.plantGeometry, this.mushroomGeometry] as THREE.BufferGeometry[]).includes(geometry);
  }

  private makeTile(cx: number, cz: number): THREE.Group {
    const mode = this.mode;
    const group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(mode === 'cave' ? '#4a4560' : '#86bdbe');
    const high = new THREE.Color(mode === 'cave' ? '#ab9db5' : '#edf4c9');
    const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (cx + 0.5) * SIZE, z = pos.getZ(i) + (cz + 0.5) * SIZE;
      const h = heightFor(mode, x, z);
      pos.setY(i, h);
      color.copy(low).lerp(high, THREE.MathUtils.clamp((h - (mode === 'cave' ? -49 : 61)) / 12, 0, 1));
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const floor = new THREE.Mesh(geo, this.groundMaterial);
    floor.position.set((cx + 0.5) * SIZE, 0, (cz + 0.5) * SIZE);
    group.add(floor);
    if (mode === 'cave') {
      const ceilingGeo = new THREE.PlaneGeometry(SIZE, SIZE, 8, 8);
      ceilingGeo.rotateX(Math.PI / 2);
      const ceilingPos = ceilingGeo.attributes.position;
      for (let i = 0; i < ceilingPos.count; i++) {
        const x = ceilingPos.getX(i) + (cx + 0.5) * SIZE;
        const z = ceilingPos.getZ(i) + (cz + 0.5) * SIZE;
        ceilingPos.setY(i, -27 + noise2(x * 0.025, z * 0.025, 404) * 2);
      }
      ceilingGeo.computeVertexNormals();
      const ceiling = new THREE.Mesh(ceilingGeo, this.caveMaterial);
      ceiling.position.set((cx + 0.5) * SIZE, 0, (cz + 0.5) * SIZE);
      group.add(ceiling);
    } else {
      // 멀리 떠 있는 암반이 높낮이의 기준이 된다. 바닥은 이어져 있어 돌아오는 길을 막지 않는다.
      const island = new THREE.Mesh(this.islandGeometry, this.skyStone);
      island.rotation.z = Math.PI;
      island.scale.set(3.2, 2.6, 2.5);
      const ix = (cx + 0.7) * SIZE, iz = (cz + 0.7) * SIZE;
      island.position.set(ix, heightFor(mode, ix, iz) + 12, iz);
      group.add(island);
    }
    const vegetation = new THREE.InstancedMesh(mode === 'cave' ? this.mushroomGeometry : this.plantGeometry, mode === 'cave' ? this.mushroomMaterial : this.plantMaterial, 21);
    const transform = new THREE.Object3D();
    let plantCount = 0;
    for (let i = 0; i < 7; i++) {
      const x = (cx + (i * 0.38197 + 0.13) % 1) * SIZE;
      const z = (cz + (i * 0.61803 + 0.23) % 1) * SIZE;
      if (Math.hypot(x, z) < 5) continue;
      const piece = new THREE.Mesh(this.decoGeometry, mode === 'cave' ? this.caveCrystal : this.skyStone);
      const scale = 0.5 + (i % 3) * 0.35;
      piece.scale.setScalar(scale);
      piece.position.set(x, heightFor(mode, x, z) + scale, z);
      group.add(piece);
      const ground = heightFor(mode, x, z);
      for (let j = 0; j < 3; j++) {
        const dx = (j - 1) * 0.6, dz = (j % 2) * 0.55 + 1;
        const y = heightFor(mode, x + dx, z + dz);
        transform.position.set(x + dx, y + (mode === 'cave' ? 0.12 : 0.35), z + dz);
        transform.scale.setScalar(0.65 + j * 0.15);
        transform.updateMatrix();
        vegetation.setMatrixAt(plantCount++, transform.matrix);
      }
      if (mode === 'cave') {
        const stalactite = new THREE.Mesh(this.decoGeometry, this.caveMaterial);
        stalactite.scale.set(scale * 1.4, scale * 1.8, scale * 1.4);
        stalactite.rotation.z = Math.PI;
        const ceilingHeight = -27 + noise2((x + 1) * 0.025, z * 0.025, 404) * 2;
        stalactite.position.set(x + 1, ceilingHeight - scale * 1.8 + 0.3, z);
        group.add(stalactite);
      } else if (i % 2 === 0) {
        const cloud = new THREE.Mesh(this.cloudGeometry, this.cloudMaterial);
        cloud.scale.set(2.5, 0.55, 1.6);
        cloud.position.set(x + 4, ground + 4 + i * 0.3, z + 3);
        group.add(cloud);
      }
    }
    vegetation.count = plantCount;
    vegetation.instanceMatrix.needsUpdate = true;
    group.add(vegetation);
    return group;
  }
}
