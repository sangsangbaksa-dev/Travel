import * as THREE from 'three';
import { RADIUS } from './geo';

// 우주에서 본 지구 가장자리의 푸른 대기 빛. 해가 비추는 쪽이 더 밝다.
export class Atmosphere {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uCam: { value: new THREE.Vector3() },
    uAlpha: { value: 0 },
  };

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 1.045, 128, 64),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: this.uniforms,
        vertexShader: /* glsl */`
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */`
          #include <common>
          #include <logdepthbuf_pars_fragment>
          uniform vec3 uSun;
          uniform vec3 uCam;
          uniform float uAlpha;
          varying vec3 vWorld;
          void main() {
            #include <logdepthbuf_fragment>
            vec3 n = normalize(vWorld);
            vec3 v = normalize(vWorld - uCam);
            float rim = pow(1.0 - abs(dot(n, v)), 2.6);
            float lit = smoothstep(-0.35, 0.4, dot(n, uSun));
            vec3 col = mix(vec3(0.25, 0.5, 1.0), vec3(0.55, 0.78, 1.0), rim);
            gl_FragColor = vec4(col * rim * (0.08 + 1.1 * lit) * uAlpha, 1.0);
          }`,
      }),
    );
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
  }

  update(sun: THREE.Vector3, cam: THREE.Vector3, space: number) {
    this.uniforms.uSun.value.copy(sun);
    this.uniforms.uCam.value.copy(cam);
    this.uniforms.uAlpha.value = space;
    this.mesh.visible = space > 0.01;
  }
}
