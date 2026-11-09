import * as THREE from 'three';
import { noise2, type Terrain } from '../terrain/height';

export const VOLCANO = { x: 240, z: 160 } as const;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const innerFloor = 9 + 78 * (1 - 8 / 110) - 20;

/** 화산 원뿔과 분화구를 실제 지형 높이에 통합한다. */
export function createVolcanicTerrain(base: Terrain): Terrain {
  return {
    ...base,
    height(x, z) {
      const h = base.height(x, z);
      const dx = x - VOLCANO.x, dz = z - VOLCANO.z;
      const r = Math.hypot(dx, dz);
      if (r >= 125) return h;
      const influence = 1 - smooth((r - 95) / 30);
      const direction = Math.atan2(dz, dx);
      const flank = smooth((r - 10) / 26) * (1 - smooth((r - 82) / 43));
      // 협곡은 위에서 아래로 이어지고 산기슭에서 주위 지형과 섞인다.
      const erosion = flank * (2.4 * Math.cos(direction * 7 + r * .037) + 1.4 * Math.sin(direction * 11 - r * .048)
        + 2.8 * noise2(x * .038, z * .038, 221));
      const cone = 9 + 78 * (1 - Math.max(8, r) / 110) + erosion;
      const crater = 20 * (1 - smooth((r - 8) / 12));
      return h + (cone - crater - h) * influence;
    },
  };
}

export class Volcano {
  readonly group = new THREE.Group();
  private readonly smoke: THREE.Sprite[] = [];
  private readonly lavaTime = { value: 0 };
  constructor() {
    const lavaSurface = new THREE.CircleGeometry(7.3, 64).rotateX(-Math.PI / 2);
    const shore = lavaSurface.attributes.position;
    for (let i = 1; i < shore.count; i++) {
      const x = shore.getX(i), z = shore.getZ(i);
      const a = Math.atan2(z, x);
      const bank = .94 + .075 * Math.sin(a * 3) + .044 * Math.cos(a * 5 + .8);
      shore.setXYZ(i, x * bank, 0, z * bank);
    }
    const lavaMaterial = new THREE.MeshBasicMaterial();
    lavaMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uLavaTime = this.lavaTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLava;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLava = position.xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLava;\nuniform float uLavaTime;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 p = vLava * 1.4;
          float flow = sin(p.x * 1.25 + sin(p.y * 1.7) + uLavaTime * .45)
            + sin(p.y * 1.6 - p.x * .5 - uLavaTime * .3);
          float seams = 1.0 - smoothstep(.03, .35, abs(flow));
          float edge = smoothstep(5.3, 7.7, length(vLava));
          diffuseColor.rgb = mix(vec3(.13, .032, .016), vec3(1., .24, .028), seams * (1. - edge * .62));`);
    };
    const lava = new THREE.Mesh(lavaSurface, lavaMaterial);
    lava.position.set(VOLCANO.x, innerFloor + .12, VOLCANO.z);
    this.group.add(lava);
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
      const r = Math.hypot((x - 15.5) / 15.5, (z - 15.5) / 15.5);
      const a = (1 - smooth(r)) * (.75 + noise2(x * .18, z * .18, 882) * .3);
      pixels.set([255, 255, 255, Math.round(clamp(a) * 255)], (z * 32 + x) * 4);
    }
    const ash = new THREE.DataTexture(pixels, 32, 32);
    ash.minFilter = ash.magFilter = THREE.LinearFilter;
    ash.needsUpdate = true;
    for (let i = 0; i < 10; i++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ash, color: '#827c73', transparent: true, opacity: 0, depthWrite: false,
      }));
      this.smoke.push(puff); this.group.add(puff);
    }
  }
  update(time: number) {
    this.lavaTime.value = time;
    this.smoke.forEach((puff, i) => {
      const age = (time * .45 + i) % 10;
      puff.position.set(VOLCANO.x + age * .94 + Math.sin(i * 2) * age * .14, innerFloor + 2 + age * 2.6, VOLCANO.z + age * .48);
      puff.scale.set(4 + age * 1.6, 4 + age * 1.08, 1);
      puff.material.opacity = .36 * smooth(age / 1.6) * (1 - smooth((age - 5) / 5));
    });
  }
}
