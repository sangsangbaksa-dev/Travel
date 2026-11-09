import { SETTLEMENTS } from './settlement-layout';
import type { WreckSite } from './deepSea';
import { VOLCANO } from './volcano';
import { ALPINE_LAKE } from './alpineLake';

/** 북쪽(-Z)이 위인 탐험 지도. 대상이 멀면 가장자리에 방향을 표시한다. */
export class Minimap {
  readonly element = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private elapsed = Infinity;
  constructor(parent: HTMLElement, private readonly wreck: WreckSite | null = null) {
    this.element.width = this.element.height = 240;
    this.element.setAttribute('aria-label', '탐험 지도. 북쪽을 기준으로 마을, 도시, 동굴, 계단, 화산, 빙하호와 난파선의 위치를 표시합니다.');
    this.element.setAttribute('role', 'img');
    Object.assign(this.element.style, {
      position: 'fixed', top: 'max(53px, calc(env(safe-area-inset-top, 0px) + 43px))',
      left: 'max(14px, env(safe-area-inset-left, 0px))',
      width: 'clamp(88px, 18vw, 116px)', height: 'clamp(88px, 18vw, 116px)',
      borderRadius: '50%', boxShadow: '0 3px 12px rgba(66,73,76,.18)',
      pointerEvents: 'none', zIndex: '5',
    });
    this.ctx = this.element.getContext('2d')!;
    parent.appendChild(this.element);
  }
  update(x: number, z: number, faceX: number, faceZ: number, dt: number, visible = true) {
    this.element.hidden = !visible;
    if (!visible) return;
    this.elapsed += dt;
    if (this.elapsed < .15) return;
    this.elapsed = 0;
    const c = this.ctx, center = 120, radius = 112, scale = .82;
    c.clearRect(0, 0, 240, 240);
    c.beginPath(); c.arc(center, center, radius, 0, Math.PI * 2); c.fillStyle = 'rgba(250,248,236,.88)'; c.fill();
    c.save(); c.beginPath(); c.arc(center, center, radius - 3, 0, Math.PI * 2); c.clip();
    c.strokeStyle = 'rgba(112,140,126,.16)'; c.lineWidth = 1;
    for (let i = -2; i <= 2; i++) { const a = center + i * 40; c.beginPath(); c.moveTo(a, 8); c.lineTo(a, 232); c.moveTo(8, a); c.lineTo(232, a); c.stroke(); }
    const points = [
      { ...SETTLEMENTS[0], label: '꽃', color: '#c27e8b' },
      { ...SETTLEMENTS[1], label: '바', color: '#568899' },
      { ...SETTLEMENTS[2], label: '도', color: '#a78053' },
      { x: -10, z: 0, label: '굴', color: '#538c86' },
      { x: 12, z: 0, label: '계', color: '#a27bb1' },
      { ...VOLCANO, label: '화', color: '#b56d4e' },
      { ...ALPINE_LAKE, label: '호', color: '#417f76' },
    ];
    if (this.wreck) points.push({ ...this.wreck, label: '배', color: '#557b8c' });
    for (const point of points) {
      let dx = (point.x - x) * scale, dz = (point.z - z) * scale;
      const d = Math.hypot(dx, dz), max = radius - 17;
      if (d > max) { dx *= max / d; dz *= max / d; }
      const px = center + dx, py = center + dz;
      c.beginPath(); c.arc(px, py, 12, 0, Math.PI*2); c.fillStyle = point.color; c.fill();
      c.fillStyle = '#fff'; c.font = 'bold 15px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(point.label, px, py + 1);
    }
    const length = Math.hypot(faceX, faceZ) || 1;
    const fx = faceX / length, fz = faceZ / length;
    c.save(); c.translate(center, center); c.rotate(Math.atan2(fx, -fz));
    c.beginPath(); c.moveTo(0, -13); c.lineTo(8, 9); c.lineTo(0, 5); c.lineTo(-8, 9); c.closePath();
    c.fillStyle = '#40536b'; c.strokeStyle = '#fff'; c.lineWidth = 3; c.stroke(); c.fill(); c.restore();
    c.restore();
    c.beginPath(); c.arc(center, center, radius, 0, Math.PI*2); c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 7; c.stroke();
    c.fillStyle = '#5a6b67'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 14px system-ui, sans-serif'; c.fillText('N', center, 20);
  }
}
