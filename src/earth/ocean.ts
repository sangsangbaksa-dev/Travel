import * as THREE from 'three';
import { RADIUS } from './geo';

// 바다: 플레이어 주변은 촘촘한 원판을 셰이더에서 구면으로 휘고, 먼 바다는 굵은 구로 그린다.
// 해수면은 반지름 RADIUS인 완전한 구다.

const NEAR_RADIUS = 1500;

const vertexCommon = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  uniform float uRadius;
  varying vec3 vWorld;
`;

const fragment = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSun;
  uniform vec3 uCam;
  uniform vec3 uSky;
  uniform vec3 uNearUp;
  uniform float uNearCos;
  uniform float uTime;
  uniform float uDay;
  varying vec3 vWorld;

  float wave(vec2 p) { return sin(p.x) * cos(p.y * 0.8); }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 n0 = normalize(vWorld);
    #ifdef FAR
      if (dot(n0, uNearUp) > uNearCos) discard;
    #endif
    // 잔물결: 접평면 방향으로 법선을 살짝 흔든다
    vec3 t1 = normalize(cross(n0, vec3(0.0, 1.0, 0.0001)));
    vec3 t2 = cross(n0, t1);
    vec2 uv = vec2(dot(vWorld, t1), dot(vWorld, t2));
    float d = distance(uCam, vWorld);
    float fade = 1.0 - smoothstep(30.0, 260.0, d);
    vec2 g = vec2(
      cos(uv.x * 1.7 + uTime * 1.3) * 0.5 + cos((uv.x + uv.y) * 2.9 - uTime * 1.7) * 0.3,
      cos(uv.y * 1.9 - uTime * 1.1) * 0.5 + cos((uv.x - uv.y) * 3.3 + uTime * 1.9) * 0.3
    ) * 0.09 * fade;
    vec3 n = normalize(n0 + t1 * g.x + t2 * g.y);
    vec3 v = normalize(uCam - vWorld);
    float light = smoothstep(-0.18, 0.25, dot(n0, uSun));
    vec3 deep = vec3(0.012, 0.07, 0.16);
    vec3 shallow = vec3(0.03, 0.2, 0.28);
    vec3 col;
    float alpha;
    if (gl_FrontFacing) {
      float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
      vec3 base = mix(shallow, deep, smoothstep(5.0, 120.0, d));
      col = mix(base, uSky * 0.85, fres * 0.75) * (0.12 + 0.88 * light);
      vec3 h = normalize(uSun + v);
      float spec = pow(max(dot(n, h), 0.0), 260.0) * 2.5 + pow(max(dot(n, h), 0.0), 18.0) * 0.08;
      col += vec3(1.0, 0.92, 0.78) * spec * light;
      alpha = mix(0.68, 0.96, fres) ;
      alpha = mix(alpha, 0.94, smoothstep(60.0, 600.0, d));
    } else {
      // 물속에서 올려다본 수면
      col = vec3(0.12, 0.38, 0.45) * (0.25 + 0.75 * light);
      alpha = 0.75;
    }
    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`;

function material(far: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: far ? { FAR: '' } : {},
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: far
      ? vertexCommon + /* glsl */`
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`
      : vertexCommon + /* glsl */`
        void main() {
          // 접평면 위의 점을 해수면 구 위로 정확히 투영한다 (지역 좌표 원점 = 해수면)
          vec3 q = vec3(position.x, uRadius, position.z);
          q *= uRadius / length(q);
          q.y -= uRadius;
          vec4 w = modelMatrix * vec4(q, 1.0);
          vWorld = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
    fragmentShader: fragment,
  });
}

export class Ocean {
  /** 플레이어 기준 좌표계(frame) 그룹에 넣는다 */
  readonly near: THREE.Mesh;
  /** 행성 좌표 그대로 장면에 넣는다 */
  readonly far: THREE.Mesh;
  private readonly shared = {
    uRadius: { value: RADIUS },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uCam: { value: new THREE.Vector3() },
    uSky: { value: new THREE.Color('#9cc4e4') },
    uNearUp: { value: new THREE.Vector3(0, 1, 0) },
    uNearCos: { value: Math.cos(NEAR_RADIUS * 0.94 / RADIUS) },
    uTime: { value: 0 },
    uDay: { value: 1 },
  };

  constructor() {
    // 가운데는 촘촘하고 바깥으로 갈수록 성긴 원판
    const rings = 90, seg = 160;
    const pos: number[] = [0, 0, 0];
    const idx: number[] = [];
    for (let r = 1; r <= rings; r++) {
      const radius = NEAR_RADIUS * Math.pow(r / rings, 2.2);
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        pos.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      }
    }
    for (let s = 0; s < seg; s++) idx.push(0, 1 + ((s + 1) % seg), 1 + s);
    for (let r = 1; r < rings; r++) {
      const a0 = 1 + (r - 1) * seg, a1 = 1 + r * seg;
      for (let s = 0; s < seg; s++) {
        const s1 = (s + 1) % seg;
        idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const nearMat = material(false);
    Object.assign(nearMat.uniforms, this.shared);
    this.near = new THREE.Mesh(geo, nearMat);
    this.near.frustumCulled = false;
    this.near.renderOrder = 1;

    const farMat = material(true);
    Object.assign(farMat.uniforms, this.shared);
    this.far = new THREE.Mesh(new THREE.SphereGeometry(RADIUS - 0.05, 256, 128), farMat);
    this.far.renderOrder = 1;
  }

  update(time: number, sunWorld: THREE.Vector3, camWorld: THREE.Vector3, up: THREE.Vector3, sky: THREE.Color) {
    const u = this.shared;
    u.uTime.value = time;
    u.uSun.value.copy(sunWorld);
    u.uCam.value.copy(camWorld);
    u.uNearUp.value.copy(up);
    u.uSky.value.copy(sky);
  }
}
