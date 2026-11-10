// 키보드 + 터치(조이스틱/점프 버튼/화면 드래그)를 하나의 입력 형태로 합친다.
export interface InputFrame {
  /** 카메라 기준 입력: x=오른쪽, y=앞 (길이 0~1) */
  moveX: number;
  moveY: number;
  /** 카메라 회전 델타(라디안), 읽으면 비워진다 */
  lookYaw: number;
  lookPitch: number;
}

export class Input {
  private keys = new Set<string>();
  private jumpQueued = false;
  private jumpTouch = false;
  private diveTouch = false;
  private runTouch = false;
  private stick = { x: 0, y: 0 };
  private look = { yaw: 0, pitch: 0 };
  private active = false;
  private resetTouch = () => {};
  private lastPointerType = '';
  readonly isTouch: boolean;

  constructor(private readonly canvas: HTMLElement, root: HTMLElement) {
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });

    addEventListener('pointerdown', (e) => { this.lastPointerType = e.pointerType; }, true);

    // 잠금이 불가능하거나 거부되었을 때는 기존 드래그를 유지한다.
    let dragging = false;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) {
        if (document.pointerLockElement === canvas) return;
        dragging = true;
        canvas.setPointerCapture(e.pointerId);
        if (this.active && document.pointerLockElement !== canvas) this.requestPointerLock();
      }
    });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging && document.pointerLockElement !== canvas && e.pointerType === 'mouse') this.addLook(e.movementX * 0.005, e.movementY * 0.004);
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) this.addLook(e.movementX * 0.005, e.movementY * 0.004);
    });
    document.addEventListener('pointerlockchange', () => { dragging = false; });

    if (this.isTouch) this.buildTouchUi(root);
  }

  reset() {
    this.keys.clear();
    this.resetTouch();
    this.jumpQueued = this.jumpTouch = this.diveTouch = this.runTouch = false;
    this.stick.x = this.stick.y = this.look.yaw = this.look.pitch = 0;
    document.querySelector<HTMLElement>('.knob')?.style.setProperty('transform', 'translate(0,0)');
    const run = document.querySelector('.runbtn');
    run?.classList.remove('on'); run?.setAttribute('aria-pressed', 'false');
  }

  /** 시작 버튼이나 키 입력의 사용자 제스처 안에서 호출한다. */
  start() {
    this.active = true;
    if (this.lastPointerType !== 'touch' && (this.lastPointerType === 'mouse' || matchMedia('(pointer: fine)').matches)) this.requestPointerLock();
  }

  private requestPointerLock() {
    if (typeof this.canvas.requestPointerLock !== 'function') return;
    try {
      // 브라우저에 따라 Promise를 반환하지 않을 수도 있다.
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* 거부되면 드래그 조작으로 계속한다 */ }
  }

  private addLook(yaw: number, pitch: number) {
    this.look.yaw += yaw;
    this.look.pitch += pitch;
  }

  private buildTouchUi(root: HTMLElement) {
    const base = document.createElement('div');
    base.className = 'stick';
    const knob = document.createElement('div');
    knob.className = 'knob';
    base.appendChild(knob);
    const jump = document.createElement('button');
    jump.className = 'jumpbtn';
    jump.textContent = '점프';
    const dive = document.createElement('button');
    dive.className = 'divebtn';
    dive.textContent = '잠수';
    const run = document.createElement('button');
    run.className = 'runbtn';
    run.textContent = '달리기';
    run.setAttribute('aria-pressed', 'false');
    root.append(base, jump, dive, run);
    // 달리기 버튼은 누를 때마다 켜고 끈다 (스틱과 함께 쓰기 편하도록)
    run.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.runTouch = !this.runTouch;
      run.classList.toggle('on', this.runTouch);
      run.setAttribute('aria-pressed', String(this.runTouch));
    });

    const R = 55;
    let stickId = -1;
    let cx = 0, cy = 0;
    const setKnob = (dx: number, dy: number) => {
      const len = Math.hypot(dx, dy);
      const k = len > R ? R / len : 1;
      dx *= k; dy *= k;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick.x = dx / R;
      this.stick.y = -dy / R;
    };
    base.addEventListener('pointerdown', (e) => {
      if (stickId !== -1) return;
      stickId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      setKnob(e.clientX - cx, e.clientY - cy);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === stickId) setKnob(e.clientX - cx, e.clientY - cy);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = -1; this.stick.x = this.stick.y = 0;
      knob.style.transform = 'translate(0,0)';
    };
    base.addEventListener('pointerup', endStick);
    base.addEventListener('pointercancel', endStick);
    base.addEventListener('lostpointercapture', endStick);

    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      jump.setPointerCapture(e.pointerId);
      this.jumpTouch = true;
      this.jumpQueued = true;
    });
    const endJump = () => { this.jumpTouch = false; };
    jump.addEventListener('pointerup', endJump);
    jump.addEventListener('pointercancel', endJump);
    jump.addEventListener('lostpointercapture', endJump);

    dive.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dive.setPointerCapture(e.pointerId);
      this.diveTouch = true;
    });
    const endDive = () => { this.diveTouch = false; };
    dive.addEventListener('pointerup', endDive);
    dive.addEventListener('pointercancel', endDive);
    dive.addEventListener('lostpointercapture', endDive);

    // 화면 오른쪽을 드래그하면 카메라 회전
    let lookId = -1, lx = 0, ly = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || lookId !== -1) return;
      this.canvas.setPointerCapture(e.pointerId);
      lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || e.pointerId !== lookId) return;
      this.addLook((e.clientX - lx) * 0.006, (e.clientY - ly) * 0.005);
      lx = e.clientX; ly = e.clientY;
    });
    const endLook = (e: PointerEvent) => { if (e.pointerId === lookId) lookId = -1; };
    this.canvas.addEventListener('pointerup', endLook);
    this.canvas.addEventListener('pointercancel', endLook);
    this.canvas.addEventListener('lostpointercapture', endLook);
    this.resetTouch = () => { stickId = lookId = -1; };
  }

  /** 점프 버튼이 새로 눌렸는가 (한 번 읽으면 소비됨) */
  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  get jumpHeld(): boolean {
    return this.keys.has('Space') || this.jumpTouch;
  }

  get diveHeld(): boolean {
    return this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.diveTouch;
  }

  /** 달리기: Shift를 누르고 있는 동안 (터치는 버튼으로 켜고 끔) */
  get runHeld(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.runTouch;
  }

  read(): InputFrame {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    x += this.stick.x;
    y += this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const yawKeys = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const frame: InputFrame = {
      moveX: x, moveY: y,
      lookYaw: this.look.yaw + yawKeys * 0.04,
      lookPitch: this.look.pitch,
    };
    this.look.yaw = 0;
    this.look.pitch = 0;
    return frame;
  }
}
