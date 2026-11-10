import * as THREE from 'three';
import type { SkyState } from './cycle';

const DOME_R = 300;
const SPRITE_R = 250;

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
  private readonly rainbow = new THREE.Group();
  private readonly rainbowMats: THREE.MeshBasicMaterial[] = [];
  private readonly uAuroraTime = { value: 0 };
  private readonly uAuroraAlpha = { value: 0 };
  private readonly uTop = { value: new THREE.Color() };
  private readonly uHorizon = { value: new THREE.Color() };

  constructor(private readonly scene: THREE.Scene) {
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
    const n = 450;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < n; i++) {
      const y = 0.08 + rnd() * 0.92;
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

    // 무지개: 해 반대편 하늘에 걸리는 일곱 빛깔 아치
    ['#ff6b6b', '#ffa15c', '#ffe066', '#7fe08a', '#6cc6ff', '#7f8cff', '#c586ff'].forEach((color, i) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(66 - i * 3.4, 69.2 - i * 3.4, 64, 1, 0, Math.PI),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false }),
      );
      m.renderOrder = -6;
      this.rainbowMats.push(m.material as THREE.MeshBasicMaterial);
      this.rainbow.add(m);
    });
    this.rainbow.frustumCulled = false;

    scene.add(this.aurora, this.rainbow);
    scene.add(this.dome, this.sunGlow, this.sunCore, this.moonGlow, this.moon, this.stars);
    scene.add(this.sunLight, this.moonLight, this.hemi);
    if (!scene.fog) scene.fog = new THREE.Fog('#d2e6f4', 30, 92);
  }

  update(camera: THREE.Camera, s: SkyState, time = 0) {
    const p = camera.position;
    for (const o of [this.dome, this.stars]) o.position.copy(p);
    this.aurora.position.set(p.x, p.y + 70, p.z);
    this.uAuroraTime.value = time;
    this.uAuroraAlpha.value = 0;

    // 무지개는 해가 낮게 떠 있는 낮에, 해의 반대편에 나타난다
    const sunLow = THREE.MathUtils.smoothstep(s.elevation, 0.1, 0.3) * (1 - THREE.MathUtils.smoothstep(s.elevation, 0.55, 0.85));
    for (const m of this.rainbowMats) m.opacity = 0.42 * sunLow;
    this.rainbow.visible = false;
    const hl = Math.hypot(s.sunDir[0], s.sunDir[2]) || 1;
    this.rainbow.position.set(p.x - (s.sunDir[0] / hl) * 210, p.y - 12, p.z - (s.sunDir[2] / hl) * 210);
    this.rainbow.lookAt(p);

    this.uTop.value.setRGB(...s.top);
    this.uHorizon.value.setRGB(...s.horizon);
    (this.scene.fog as THREE.Fog).color.setRGB(...s.horizon);

    const [dx, dy, dz] = s.sunDir;
    const place = (o: THREE.Object3D, sign: number) =>
      o.position.set(p.x + dx * SPRITE_R * sign, p.y + dy * SPRITE_R * sign, p.z + dz * SPRITE_R * sign);
    place(this.sunGlow, 1);
    place(this.sunCore, 1);
    place(this.moon, -1);
    place(this.moonGlow, -1);

    const sunVis = THREE.MathUtils.clamp((s.elevation + 0.12) / 0.2, 0, 1);
    const moonVis = THREE.MathUtils.clamp((-s.elevation + 0.12) / 0.2, 0, 1);
    const sc = new THREE.Color(...s.sunColor);
    (this.sunCore.material as THREE.SpriteMaterial).color.copy(sc);
    (this.sunCore.material as THREE.SpriteMaterial).opacity = sunVis;
    (this.sunGlow.material as THREE.SpriteMaterial).color.copy(sc);
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = 0.5 * sunVis;
    (this.moon.material as THREE.SpriteMaterial).opacity = moonVis;
    (this.moonGlow.material as THREE.SpriteMaterial).opacity = 0.35 * moonVis;
    (this.stars.material as THREE.PointsMaterial).opacity = s.stars;

    // 조명: 해가 지면 달빛이 이어받는다
    this.sunLight.position.set(dx, dy, dz).multiplyScalar(80);
    this.sunLight.color.setRGB(...s.sunColor);
    this.sunLight.intensity = s.sunIntensity;
    this.moonLight.position.set(-dx, -dy, -dz).multiplyScalar(80);
    this.moonLight.intensity = s.moonIntensity;
    this.hemi.color.setRGB(...s.hemiSky);
    this.hemi.groundColor.setRGB(...s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;
  }
}
