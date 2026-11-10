// 위성사진 세계지도 위에 지금 위치와 바라보는 방향을 표시한다. 위쪽이 북쪽.
// 기본은 플레이어 주변 지역 지도이고, N 키나 지도를 누르면 세계지도와 번갈아 보인다.
export class Minimap {
  readonly element = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image = new Image();
  private timer = 0;
  private world = false;
  private readonly w = 220;
  private readonly h = 140;

  constructor(root: HTMLElement, imageUrl: string, private readonly marks: { lat: number; lon: number }[]) {
    this.element.width = this.w * 2;
    this.element.height = this.h * 2;
    this.element.setAttribute('role', 'img');
    this.element.setAttribute('aria-label', '위성사진 지도. 위쪽이 북쪽이고 가운데 화살표가 지금 위치와 방향입니다. N 키로 세계지도와 지역 지도를 바꿉니다.');
    Object.assign(this.element.style, {
      position: 'fixed', left: 'max(14px, env(safe-area-inset-left, 0px))', bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
      width: `${this.w}px`, height: `${this.h}px`, borderRadius: '14px', zIndex: '1', cursor: 'pointer',
      boxShadow: '0 6px 18px rgba(20, 30, 50, .35)', border: '2px solid rgba(255,255,255,.75)', opacity: '0',
      transition: 'opacity .4s', background: '#0b1d33',
    });
    this.ctx = this.element.getContext('2d')!;
    this.image.src = imageUrl;
    root.appendChild(this.element);
    this.element.addEventListener('click', () => { this.world = !this.world; this.timer = 0; });
    addEventListener('keydown', (e) => { if (e.code === 'KeyN' && !e.repeat && !(e.target instanceof HTMLInputElement)) { this.world = !this.world; this.timer = 0; } });
  }

  showWorld() { this.world = true; this.timer = 0; }

  /** heading: 북쪽 기준 시계 방향 라디안 */
  update(lat: number, lon: number, heading: number, dt: number, visible: boolean) {
    this.element.style.opacity = visible ? '0.94' : '0';
    this.element.style.pointerEvents = visible ? 'auto' : 'none';
    this.timer -= dt;
    if (this.timer > 0 || !visible || !this.image.complete || !this.image.naturalWidth) return;
    this.timer = 0.1;
    const c = this.ctx, W = this.element.width, H = this.element.height;
    const iw = this.image.naturalWidth, ih = this.image.naturalHeight;
    // 보여 줄 경도 폭 (도)
    const span = this.world ? 360 : 70;
    const spanLat = span * H / W;
    const cLat = this.world ? 0 : Math.max(-90 + spanLat / 2, Math.min(90 - spanLat / 2, lat));
    const cLon = this.world ? 0 : lon;
    const ppd = W / span; // 도당 픽셀
    c.clearRect(0, 0, W, H);
    // 경도 방향으로 감아서 두 번까지 그린다
    const left = cLon - span / 2;
    const sy = ((90 - (cLat + spanLat / 2)) / 180) * ih, sh = (spanLat / 180) * ih;
    for (const shift of [-360, 0, 360]) {
      const l = left - shift;
      const x0 = Math.max(-180, l), x1 = Math.min(180, l + span);
      if (x1 <= x0) continue;
      const sx = ((x0 + 180) / 360) * iw, sw = ((x1 - x0) / 360) * iw;
      c.drawImage(this.image, sx, sy, sw, sh, (x0 - l) * ppd, 0, (x1 - x0) * ppd, H);
    }
    const toX = (lo: number) => {
      let d = lo - cLon;
      d = ((d + 540) % 360) - 180;
      return W / 2 + d * ppd;
    };
    const toY = (la: number) => H / 2 - (la - cLat) * ppd;
    c.fillStyle = 'rgba(255, 214, 120, .95)';
    for (const m of this.marks) {
      const x = toX(m.lon), y = toY(m.lat);
      if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
      c.beginPath(); c.arc(x, y, this.world ? 2.5 : 4, 0, Math.PI * 2); c.fill();
    }
    // 플레이어 화살표
    const px = toX(lon), py = toY(lat);
    c.save();
    c.translate(px, py);
    c.rotate(heading);
    c.fillStyle = '#ff6f93'; c.strokeStyle = '#fff'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -13); c.lineTo(9, 10); c.lineTo(0, 5); c.lineTo(-9, 10); c.closePath();
    c.fill(); c.stroke();
    c.restore();
    c.fillStyle = 'rgba(255,255,255,.85)'; c.font = 'bold 18px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('N', W - 18, 24);
  }
}
