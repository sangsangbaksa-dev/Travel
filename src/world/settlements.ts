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
  c.fillStyle = '#f7f1e4'; c.beginPath(); c.roundRect(4, 4, 504, 120, 26); c.fill();
  c.strokeStyle = color; c.lineWidth = 7; c.stroke();
  c.fillStyle = '#3f3a46'; c.textAlign = 'center'; c.textBaseline = 'middle';
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
      { x: -7, z: 7, target: SETTLEMENTS[1], title: '바람 마을', color: '#4f7a88' },
      { x: 0, z: 9, target: SETTLEMENTS[0], title: '꽃길 마을', color: '#a65d58' },
      { x: 7, z: 7, target: SETTLEMENTS[2], title: '햇살 도시', color: '#a87860' },
    ];
    for (const sign of signs) {
      const y = height(sign.x, sign.z);
      piece(this.group, box, '#7a5e50', sign.x, y + 1.1, sign.z, .18, 2.2, .18);
      const name = label(sign.title, sign.color); name.position.set(sign.x, y + 2.5, sign.z); this.group.add(name);
      const direction = new THREE.Vector3(sign.target.x - sign.x, 0, sign.target.z - sign.z).normalize();
      this.group.add(new THREE.ArrowHelper(direction, new THREE.Vector3(sign.x, y + .2, sign.z), 2.8, sign.color, .9, .55));
    }
    for (const sign of [{x:-10, title:'지하로 내려가는 길', color:'#4a8a84'}, {x:12, title:'천국으로 가는 계단', color:'#9a6e9e'}]) {
      const z = 2, y = height(sign.x, z);
      const name = label(sign.title, sign.color); name.position.set(sign.x, y + 2.7, z); this.group.add(name);
    }
    SETTLEMENTS.forEach((place, style) => {
      const area = new THREE.Group();
      this.group.add(area); this.areas.push(area);
      // 작은 포석은 각 지면 높이에 맞춰 깔아 언덕에도 자연스럽게 이어진다.
      for (let ix = -3; ix <= 3; ix++) for (let iz = -3; iz <= 3; iz++) {
        if (ix * ix + iz * iz > 12) continue;
        const x = place.x + ix * 1.25, z = place.z + iz * 1.25;
        piece(area, box, (ix + iz) % 2 ? '#cbb892' : '#e2d0ae', x, height(x,z) + .035, z, 1.18, .07, 1.18);
      }
      (style === 2 ? CITY_BUILDING_OFFSETS : BUILDING_OFFSETS).forEach(([dx,dz], i) => {
        const x = place.x + dx, z = place.z + dz, ground = height(x,z);
        const w = style === 2 ? 4.3 : 3.6, d = 3.5, h = style === 2 ? (i >= 8 ? 9 + (i % 3) * 1.5 : 5 + (i % 3) * 1.3) : 2.7 + (i % 2) * .5;
        const wall = style === 0 ? ['#f0e0c8','#ead0c4','#f3dcc0'][i%3] : style === 1 ? ['#ece8dc','#cddcde','#efe4d0'][i%3] : ['#e2ccb0','#eedcc4','#cfd8d0'][i%3];
        const top = style === 0 ? '#a65d58' : style === 1 ? '#4f7a88' : '#a87860';
        const foundationBottom = Math.min(terrain.height(x, z), ground - .5);
        const foundationHeight = ground + .5 - foundationBottom;
        piece(area, box, '#b5a78e', x, foundationBottom + foundationHeight/2, z, w+.3, foundationHeight, d+.3);
        piece(area, box, wall, x, ground+.5+h/2, z, w, h, d);
        if (style === 1 || style === 2) piece(area, box, top, x, ground+.5+h+.16, z, w+.25, .32, d+.25);
        else piece(area, roof, top, x, ground+.5+h+.8, z, w*.78, 1.6, d*.78, Math.PI/4);
        // 광장 쪽의 문과 창문
        const facing = dz > 0 ? -1 : 1;
        piece(area, box, '#6e5348', x, ground+1.05, z+facing*(d/2+.015), .75, 1.1, .06);
        for (const side of [-1,1]) piece(area, box, '#6ea8b4', x+side*1.15, ground+1.75, z+facing*(d/2+.025), .65, .65, .07);
        if (style === 2) {
          // 층마다 창을 배치하고 1층은 상점이나 업무 공간처럼 구분한다.
          for (let floor = 1; floor < Math.floor(h / 1.4); floor++) for (const side of [-1, 1]) {
            piece(area, box, '#7eacb0', x + side * 1.15, ground + 1.75 + floor * 1.25, z + facing * (d / 2 + .03), .7, .72, .06);
          }
          piece(area, box, i % 2 ? '#5e7a74' : '#9a6e58', x, ground + 2.45, z + facing * (d / 2 + .08), 2.1, .23, .16);
        }
      });
      if (style === 2) {
        // 도로 타일과 가로수는 인스턴스로 묶어 먼 도시의 드로우콜을 줄인다.
        const roads: { x: number; z: number; angle: number }[] = [];
        for (let n = -22; n <= 22; n += 2) {
          if (Math.abs(n) < 5) continue; // 중앙 광장은 보행자 공간이다
          roads.push({ x: place.x + n, z: place.z, angle: 0 });
          roads.push({ x: place.x, z: place.z + n, angle: Math.PI / 2 });
        }
        const roadMesh = new THREE.InstancedMesh(box, mat('#b4ada0'), roads.length);
        const temp = new THREE.Object3D();
        roads.forEach((road, i) => {
          temp.position.set(road.x, height(road.x, road.z) + .08, road.z);
          temp.rotation.set(0, road.angle, 0); temp.scale.set(2.05, .12, 3.5); temp.updateMatrix();
          roadMesh.setMatrixAt(i, temp.matrix);
        });
        area.add(roadMesh);
        // 교차로 주변 횡단보도와 가로등.
        for (const side of [-1, 1]) for (let stripe = -2; stripe <= 2; stripe++) {
          const x = place.x + stripe * .55, z = place.z + side * 6;
          piece(area, box, '#efe8d4', x, height(x, z) + .16, z, .32, .025, 1.3);
          const x2 = place.x + side * 6, z2 = place.z + stripe * .55;
          piece(area, box, '#efe8d4', x2, height(x2, z2) + .16, z2, 1.3, .025, .32);
        }
        for (const [dx, dz] of [[-5,-5],[5,-5],[-5,5],[5,5]]) {
          const x = place.x + dx, z = place.z + dz, y = height(x,z);
          piece(area, round, '#5c605c', x, y + 1.7, z, .09, 3.4, .09);
          piece(area, box, '#ddd8c6', x, y + 3.45, z, .42, .12, .42);
        }
        const treePositions: { x: number; z: number }[] = [];
        for (let n = -18; n <= 18; n += 6) for (const side of [-1, 1]) {
          if (Math.abs(n) < 7) continue;
          for (const [dx, dz] of [[n, side * 3.6], [side * 3.6, n]]) {
            if (CITY_BUILDING_OFFSETS.some(([bx, bz]) => Math.hypot(dx - bx, dz - bz) < 4.5)) continue;
            treePositions.push({ x: place.x + dx, z: place.z + dz });
          }
        }
        const trunks = new THREE.InstancedMesh(round, mat('#7a5e48'), treePositions.length);
        const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat('#5fa05a'), treePositions.length);
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
        piece(area, round, '#8d5e50', x,y+1.1,z,.36,2.2,.36);
        for (const [dx,dy,dz] of [[0,3,0],[-.9,2.7,0],[.9,2.8,0],[0,3,-.8]]) piece(area,new THREE.IcosahedronGeometry(1,1),'#d889a0',x+dx,y+dy,z+dz,1.25,1,1.1);
      } else if (style === 1) {
        piece(area, box, '#eee4d0', x,y+2.5,z,2.1,5,2.1);
        piece(area, roof, '#4f7a88', x,y+5.75,z,1.8,1.5,1.8,Math.PI/4);
        piece(area, box, '#c4ad88',x,y+3.8,z+1.1,3.8,.25,.18);
        piece(area, box, '#c4ad88',x,y+3.8,z+1.1,.25,3.8,.18);
      } else {
        piece(area, box, '#c9af8c',x,y+4,z,2.3,8,2.3);
        piece(area, box, '#ead9b8',x,y+6.4,z+1.17,1.25,1.25,.12);
        piece(area, box, '#6e5348',x,y+6.4,z+1.25,.1,.8,.08);
        piece(area, box, '#6e5348',x+.2,y+6.4,z+1.25,.45,.1,.08);
        piece(area, roof, '#a87860',x,y+8.8,z,2,1.6,2,Math.PI/4);
      }
    });
  }
  update(x: number, z: number) {
    this.areas.forEach((area, i) => { const p = SETTLEMENTS[i]; area.visible = Math.hypot(x-p.x,z-p.z) < 180; });
  }
}
