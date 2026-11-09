import * as THREE from 'three';

// 카메라를 따라다니는 큰 수면. 반투명이라 바닥의 모래빛이 비치고, 햇빛에 반짝인다.
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly uTime = { value: 0 };
  private readonly uSun = { value: 1 };

  constructor(level: number) {
    const mat = new THREE.MeshLambertMaterial({
      color: '#7fd3ea', emissive: '#2a6f86', emissiveIntensity: 0.18,
      transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.uniforms.uSun = this.uSun;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform float uSun;')
        .replace(
          '#include <dithering_fragment>',
          `float s = sin(vWPos.x * 1.7 + uTime * 1.3) * sin(vWPos.z * 1.9 - uTime * 1.1)
             + 0.5 * sin((vWPos.x + vWPos.z) * 3.1 + uTime * 2.3);
           float sp = smoothstep(1.05, 1.4, s);
           gl_FragColor.rgb += sp * 0.32 * uSun;
           gl_FragColor.a = min(1.0, gl_FragColor.a + sp * 0.2);
           #include <dithering_fragment>`,
        );
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), mat);
    this.mesh.position.y = level;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  /** brightness: 0(밤)~1(낮). 반짝임 세기를 정한다 */
  update(x: number, z: number, time: number, brightness: number) {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    this.uTime.value = time;
    this.uSun.value = Math.max(0.12, brightness);
  }
}
