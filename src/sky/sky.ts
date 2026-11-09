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

    scene.add(this.dome, this.sunGlow, this.sunCore, this.moonGlow, this.moon, this.stars);
    scene.add(this.sunLight, this.moonLight, this.hemi);
    if (!scene.fog) scene.fog = new THREE.Fog('#dff1ff', 30, 92);
  }

  update(camera: THREE.Camera, s: SkyState) {
    const p = camera.position;
    for (const o of [this.dome, this.stars]) o.position.copy(p);

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
