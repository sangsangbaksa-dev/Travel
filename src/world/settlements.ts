import * as THREE from 'three';
import type { Terrain } from '../terrain/height';

import { BUILDING_OFFSETS, CITY_BUILDING_OFFSETS, SETTLEMENTS } from './settlement-layout';
export { SETTLEMENTS } from './settlement-layout';

const box = new THREE.BoxGeometry(1, 1, 1);
const roof = new THREE.ConeGeometry(1, 1, 4);
const round = new THREE.CylinderGeometry(1, 1, 1, 12);
const mats = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string) {
  let m = mats.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); mats.set(color, m); }
  return m;
}
function piece(group: THREE.Group, geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation = 0) {
  const mesh = new THREE.Mesh(geo, mat(color));
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.rotation.y = rotation;
  group.add(mesh);
}

function label(text: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#fff9ef'; c.beginPath(); c.roundRect(4, 4, 504, 120, 26); c.fill();
  c.strokeStyle = color; c.lineWidth = 7; c.stroke();
  c.fillStyle = '#51475a'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = 'bold 48px system-ui, sans-serif'; c.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
  sprite.scale.set(3.8, .95, 1);
  return sprite;
}

export class Settlements {
  readonly group = new THREE.Group();
  private readonly areas: THREE.Group[] = [];
  constructor(terrain: Terrain) {
    const height = (x: number, z: number) => Math.max(terrain.height(x, z), terrain.waterLevel ?? -Infinity);
    // 시작점의 목적지 안내: 화살표가 실제 월드 좌표를 가리킨다.
    const signs = [
      { x: -7, z: 7, target: SETTLEMENTS[1], title: '바람 마을', color: '#658b9c' },
      { x: 0, z: 9, target: SETTLEMENTS[0], title: '꽃길 마을', color: '#be7b84' },
      { x: 7, z: 7, target: SETTLEMENTS[2], title: '햇살 도시', color: '#ad8c69' },
    ];
    for (const sign of signs) {
      const y = height(sign.x, sign.z);
      piece(this.group, box, '#98796b', sign.x, y + 1.1, sign.z, .18, 2.2, .18);
      const name = label(sign.title, sign.color); name.position.set(sign.x, y + 2.5, sign.z); this.group.add(name);
      const direction = new THREE.Vector3(sign.target.x - sign.x, 0, sign.target.z - sign.z).normalize();
      this.group.add(new THREE.ArrowHelper(direction, new THREE.Vector3(sign.x, y + .2, sign.z), 2.8, sign.color, .9, .55));
    }
    for (const sign of [{x:-5, title:'지하 동굴 입구', color:'#579c98'}, {x:5, title:'하늘 계단', color:'#b583b6'}]) {
      const z = -2.2, y = height(sign.x, z);
      const name = label(sign.title, sign.color); name.position.set(sign.x, y + 2.7, z); this.group.add(name);
    }
    SETTLEMENTS.forEach((place, style) => {
      const area = new THREE.Group();
      this.group.add(area); this.areas.push(area);
      // 작은 포석은 각 지면 높이에 맞춰 깔아 언덕에도 자연스럽게 이어진다.
      for (let ix = -3; ix <= 3; ix++) for (let iz = -3; iz <= 3; iz++) {
        if (ix * ix + iz * iz > 12) continue;
        const x = place.x + ix * 1.25, z = place.z + iz * 1.25;
        piece(area, box, (ix + iz) % 2 ? '#e2cfb0' : '#f1dfc1', x, height(x,z) + .035, z, 1.18, .07, 1.18);
      }
      (style === 2 ? CITY_BUILDING_OFFSETS : BUILDING_OFFSETS).forEach(([dx,dz], i) => {
        const x = place.x + dx, z = place.z + dz, ground = height(x,z);
        const w = style === 2 ? 4.3 : 3.6, d = 3.5, h = style === 2 ? (i >= 8 ? 9 + (i % 3) * 1.5 : 5 + (i % 3) * 1.3) : 2.7 + (i % 2) * .5;
        const wall = style === 0 ? ['#fff3dd','#f4d8cf','#f9e4c8'][i%3] : style === 1 ? ['#f5f1e5','#d7e8e9','#f8e8ce'][i%3] : ['#e9d6c2','#f3e6d3','#d8e4df'][i%3];
        const top = style === 0 ? '#b87870' : style === 1 ? '#648c9a' : '#bd927e';
        const foundationBottom = Math.min(terrain.height(x, z), ground - .5);
        const foundationHeight = ground + .5 - foundationBottom;
        piece(area, box, '#cabda4', x, foundationBottom + foundationHeight/2, z, w+.3, foundationHeight, d+.3);
        piece(area, box, wall, x, ground+.5+h/2, z, w, h, d);
        if (style === 1) piece(area, box, top, x, ground+.5+h+.16, z, w+.25, .32, d+.25);
        else piece(area, roof, top, x, ground+.5+h+.8, z, w*.78, 1.6, d*.78, Math.PI/4);
        // 광장 쪽의 문과 창문
        const facing = dz > 0 ? -1 : 1;
        piece(area, box, '#8b6d60', x, ground+1.05, z+facing*(d/2+.015), .75, 1.1, .06);
        for (const side of [-1,1]) piece(area, box, '#9ec9d0', x+side*1.15, ground+1.75, z+facing*(d/2+.025), .65, .65, .07);
      });
      if (style === 2) {
        // 도로 타일과 가로수는 인스턴스로 묶어 먼 도시의 드로우콜을 줄인다.
        const roads: { x: number; z: number; angle: number }[] = [];
        for (let n = -22; n <= 22; n += 2) {
          if (Math.abs(n) < 5) continue; // 중앙 광장은 보행자 공간이다
          roads.push({ x: place.x + n, z: place.z, angle: 0 });
          roads.push({ x: place.x, z: place.z + n, angle: Math.PI / 2 });
        }
        const roadMesh = new THREE.InstancedMesh(box, mat('#c1b9a9'), roads.length);
        const temp = new THREE.Object3D();
        roads.forEach((road, i) => {
          temp.position.set(road.x, height(road.x, road.z) + .08, road.z);
          temp.rotation.set(0, road.angle, 0); temp.scale.set(2.05, .12, 3.5); temp.updateMatrix();
          roadMesh.setMatrixAt(i, temp.matrix);
        });
        area.add(roadMesh);
        const treePositions: { x: number; z: number }[] = [];
        for (let n = -18; n <= 18; n += 6) for (const side of [-1, 1]) {
          if (Math.abs(n) < 7) continue;
          for (const [dx, dz] of [[n, side * 3.6], [side * 3.6, n]]) {
            if (CITY_BUILDING_OFFSETS.some(([bx, bz]) => Math.hypot(dx - bx, dz - bz) < 4.5)) continue;
            treePositions.push({ x: place.x + dx, z: place.z + dz });
          }
        }
        const trunks = new THREE.InstancedMesh(round, mat('#987964'), treePositions.length);
        const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat('#a8ce9f'), treePositions.length);
        treePositions.forEach((tree, i) => {
          const y = height(tree.x, tree.z);
          temp.rotation.set(0,0,0); temp.position.set(tree.x, y + 1.1, tree.z); temp.scale.set(.2, 2.2, .2); temp.updateMatrix(); trunks.setMatrixAt(i, temp.matrix);
          temp.position.set(tree.x, y + 2.9, tree.z); temp.scale.set(1.1, 1.15, 1.1); temp.updateMatrix(); crowns.setMatrixAt(i, temp.matrix);
        });
        area.add(trunks, crowns);
      }
      // 지역마다 다른 광장 랜드마크: 꽃나무, 풍차, 시계탑.
      const x=place.x, z=place.z, y=height(x,z);
      if (style === 0) {
        piece(area, round, '#a77768', x,y+1.1,z,.36,2.2,.36);
        for (const [dx,dy,dz] of [[0,3,0],[-.9,2.7,0],[.9,2.8,0],[0,3,-.8]]) piece(area,new THREE.IcosahedronGeometry(1,1),'#f3b7c5',x+dx,y+dy,z+dz,1.25,1,1.1);
      } else if (style === 1) {
        piece(area, box, '#f7eddd', x,y+2.5,z,2.1,5,2.1);
        piece(area, roof, '#7098a3', x,y+5.75,z,1.8,1.5,1.8,Math.PI/4);
        piece(area, box, '#d7c3a5',x,y+3.8,z+1.1,3.8,.25,.18);
        piece(area, box, '#d7c3a5',x,y+3.8,z+1.1,.25,3.8,.18);
      } else {
        piece(area, box, '#dec5aa',x,y+4,z,2.3,8,2.3);
        piece(area, box, '#f7ead4',x,y+6.4,z+1.17,1.25,1.25,.12);
        piece(area, box, '#8c7770',x,y+6.4,z+1.25,.1,.8,.08);
        piece(area, box, '#8c7770',x+.2,y+6.4,z+1.25,.45,.1,.08);
        piece(area, roof, '#a87972',x,y+8.8,z,2,1.6,2,Math.PI/4);
      }
    });
  }
  update(x: number, z: number) {
    this.areas.forEach((area, i) => { const p = SETTLEMENTS[i]; area.visible = Math.hypot(x-p.x,z-p.z) < 180; });
  }
}
