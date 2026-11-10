import * as THREE from 'three';
import type { SkyState } from './cycle';

const DOME_R = 300;
const SPRITE_R = 250;
const WHITE = new THREE.Color('#ffffff');

function softDisc(inner: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(inner, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sprite(tex: THREE.Texture, size: number, order: number): THREE.Sprite {
  const m = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false }),
  );
  m.scale.setScalar(size);
  m.renderOrder = order;
  m.frustumCulled = false;
  return m;
}

// 하늘 돔(그라데이션) + 해/달/별 + 해/달/반구 조명 + 안개 색을 한 곳에서 관리한다.
export class Sky {
  private readonly dome: THREE.Mesh;
  private readonly sunGlow: THREE.Sprite;
  private readonly sunCore: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly moonGlow: THREE.Sprite;
  private readonly stars: THREE.Points;
  readonly sunLight = new THREE.DirectionalLight('#fff0d8', 1);
  readonly moonLight = new THREE.DirectionalLight('#a9b8ff', 0);
  readonly hemi = new THREE.HemisphereLight('#fff6ec', '#a8c8a0', 1.7);
  private readonly aurora: THREE.Mesh;
  private readonly uAuroraTime = { value: 0 };
  private readonly uAuroraAlpha = { value: 0 };
  private readonly uTop = { value: new THREE.Color() };
  private readonly uHorizon = { value: new THREE.Color() };

  constructor(scene: THREE.Scene, local: THREE.Object3D) {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_R, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: this.uTop, horizon: this.uHorizon },
        vertexShader: `varying float vY;
          void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying float vY;
          void main(){ float k = pow(clamp(vY, 0.0, 1.0), 0.55); gl_FragColor = vec4(mix(horizon, top, k), 1.0); }`,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;

    const glowTex = softDisc(0.0);
    const discTex = softDisc(0.82);
    this.sunGlow = sprite(glowTex, 120, -9);
    this.sunCore = sprite(discTex, 26, -8);
    this.moonGlow = sprite(glowTex, 60, -9);
    this.moon = sprite(discTex, 18, -8);
    (this.moon.material as THREE.SpriteMaterial).color.set('#f4f0ff');
    (this.moonGlow.material as THREE.SpriteMaterial).color.set('#b8c4ff');

    // 별: 위쪽 반구에 흩뿌린다 (고정 시드)
    const n = 900;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < n; i++) {
      const y = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 280, y * 280, Math.sin(a) * r * 280], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: '#fffbea', size: 2.2, sizeAttenuation: false, transparent: true,
        opacity: 0, depthWrite: false, fog: false,
      }),
    );
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;

    // 오로라: 밤하늘에 일렁이는 빛의 커튼 (카메라를 둘러싼 원통의 안쪽 면)
    this.aurora = new THREE.Mesh(
      new THREE.CylinderGeometry(260, 260, 110, 64, 1, true),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: this.uAuroraTime, uAlpha: this.uAuroraAlpha },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float uTime; uniform float uAlpha; varying vec2 vUv;
          void main(){
            float x = vUv.x * 6.2831853;
            float wave = sin(x * 2.0 + uTime * 0.35) * 0.5 + sin(x * 5.0 - uTime * 0.5) * 0.25;
            float band = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.3 + 0.25 * wave, 1.0, vUv.y));
            float ray = 0.6 + 0.4 * sin(x * 16.0 + uTime * 0.8);
            float sector = smoothstep(0.35, 0.9, 0.5 + 0.5 * sin(x + 2.0));
            vec3 c = mix(vec3(0.3, 1.0, 0.7), vec3(0.85, 0.45, 1.0), clamp(vUv.y * 1.3 + wave * 0.25, 0.0, 1.0));
            gl_FragColor = vec4(c, band * ray * sector * uAlpha * 0.6);
          }`,
      }),
    );
    this.aurora.renderOrder = -8;
    this.aurora.frustumCulled = false;

    // 하늘 장식은 카메라가 든 지역 좌표계에, 빛은 행성 좌표계에 둔다
    local.add(this.aurora, this.dome, this.sunGlow, this.sunCore, this.moonGlow, this.moon, this.stars);
    scene.add(this.sunLight, this.moonLight, this.hemi);
  }

  /**
   * @param p 카메라 위치 (지역 좌표)
   * @param world 행성 좌표의 해 방향, 지금 서 있는 곳의 위쪽, 우주에 가까운 정도(0~1), 오로라 세기
   */
  update(p: THREE.Vector3, s: SkyState, time: number, world: { sun: THREE.Vector3; up: THREE.Vector3; space: number; aurora: number }) {
    for (const o of [this.dome, this.stars]) o.position.copy(p);
    this.aurora.position.set(p.x, p.y + 70, p.z);
    this.uAuroraTime.value = time;
    this.uAuroraAlpha.value = world.aurora * (1 - world.space);

    // 높이 올라갈수록 하늘이 검은 우주로 바뀐다
    const air = 1 - world.space;
    this.uTop.value.setRGB(...s.top).multiplyScalar(air);
    this.uHorizon.value.setRGB(...s.horizon).multiplyScalar(air);

    const [dx, dy, dz] = s.sunDir;
    const place = (o: THREE.Object3D, sign: number) =>
      o.position.set(p.x + dx * SPRITE_R * sign, p.y + dy * SPRITE_R * sign, p.z + dz * SPRITE_R * sign);
    place(this.sunGlow, 1);
    place(this.sunCore, 1);
    place(this.moon, -1);
    place(this.moonGlow, -1);

    const sunVis = Math.max(world.space, THREE.MathUtils.clamp((s.elevation + 0.12) / 0.2, 0, 1));
    const moonVis = Math.max(world.space, THREE.MathUtils.clamp((-s.elevation + 0.12) / 0.2, 0, 1));
    const sc = new THREE.Color(...s.sunColor);
    (this.sunCore.material as THREE.SpriteMaterial).color.copy(sc);
    (this.sunCore.material as THREE.SpriteMaterial).opacity = sunVis;
    (this.sunGlow.material as THREE.SpriteMaterial).color.copy(sc);
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = 0.5 * sunVis * (0.4 + 0.6 * air);
    (this.moon.material as THREE.SpriteMaterial).opacity = moonVis;
    (this.moonGlow.material as THREE.SpriteMaterial).opacity = 0.35 * moonVis * air;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(s.stars, world.space);

    // 조명은 행성 전체에 같은 방향으로 비춘다 (낮과 밤이 경도에 따라 갈린다)
    const sun = world.sun;
    this.sunLight.position.copy(sun).multiplyScalar(10000);
    this.sunLight.color.setRGB(...s.sunColor).lerp(WHITE, world.space);
    this.sunLight.intensity = THREE.MathUtils.lerp(s.sunIntensity, 1.6, world.space);
    this.moonLight.position.copy(sun).multiplyScalar(-10000);
    this.moonLight.intensity = s.moonIntensity * air;
    this.hemi.position.copy(world.up);
    this.hemi.color.setRGB(...s.hemiSky);
    this.hemi.groundColor.setRGB(...s.hemiGround);
    this.hemi.intensity = s.hemiIntensity * (1 - 0.8 * world.space);
  }
}
