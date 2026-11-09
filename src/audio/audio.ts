import { nextDegree, noteFreq } from './notes';

// 파일 없이 WebAudio로 합성하는 소리: 효과음 + 바람/새/귀뚜라미 + 잔잔한 오르골 멜로디.
// 브라우저 정책상 첫 클릭/키 입력 뒤에 unlock()을 불러야 소리가 난다.
const MUTE_KEY = 'cubeworld.muted';

export interface AmbientEnv {
  /** 해 높이 -1~1 */
  elevation: number;
  speed: number;
  grounded: boolean;
}

type Wave = OscillatorType;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private windGain!: GainNode;
  private noise!: AudioBuffer;
  muted = false;
  private nextNote = 0;
  private degree = 2;
  private birdT = 2;
  private cricketT = 0;

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* 저장소를 못 쓰면 기본값 */ }
  }

  get state(): string {
    return this.ctx ? this.ctx.state : 'locked';
  }

  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
      this.amb = ctx.createGain(); this.amb.gain.value = 1; this.amb.connect(this.master);
      this.music = ctx.createGain(); this.music.gain.value = 0.55;
      this.music.connect(this.master);
      // 메아리: 오르골 소리가 공간감 있게 울린다
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.36;
      const fb = ctx.createGain(); fb.gain.value = 0.38;
      const wet = ctx.createGain(); wet.gain.value = 0.5;
      this.music.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(this.master);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // 바람: 낮은 대역만 통과시킨 노이즈를 계속 깔아둔다
      const wind = ctx.createBufferSource();
      wind.buffer = this.noise; wind.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0.02;
      wind.connect(lp).connect(this.windGain).connect(this.amb);
      wind.start();
    } catch {
      this.ctx = null;
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* 무시 */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // ---- 소리 재료 ----
  private tone(freq: number, dur: number, type: Wave, vol: number, slideTo?: number, delay = 0, dest?: AudioNode) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  private burst(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  // ---- 효과음 ----
  jump() { this.tone(360, 0.14, 'sine', 0.22, 760); }
  land(impact: number) {
    const v = Math.min(0.3, 0.06 + impact * 0.01);
    this.tone(150, 0.14, 'sine', v, 60);
    this.burst(0.08, v * 0.5, 'lowpass', 900, 300);
  }
  step() { this.burst(0.035, 0.035, 'bandpass', 1100, 700); }
  splash() {
    this.burst(0.4, 0.22, 'lowpass', 3200, 500);
    this.tone(520, 0.12, 'sine', 0.06, 900, 0.04);
  }
  collect(value: number) {
    if (value >= 5) {
      [660, 880, 1320, 1760].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.16, undefined, i * 0.07));
    } else {
      this.tone(880, 0.22, 'triangle', 0.17);
      this.tone(1320, 0.3, 'triangle', 0.15, undefined, 0.08);
    }
  }
  milestone() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.18, undefined, i * 0.11));
  }

  // ---- 환경음 + 배경 멜로디 ----
  update(dt: number, env: AmbientEnv) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    const move = Math.min(1, env.speed / 9);
    this.windGain.gain.setTargetAtTime(0.018 + 0.03 * move + (env.grounded ? 0 : 0.02), now, 0.25);
    if (this.muted) return;

    const day = env.elevation > 0.12;
    const night = env.elevation < -0.05;

    if (day) {
      this.birdT -= dt;
      if (this.birdT <= 0) {
        this.birdT = 3 + Math.random() * 7;
        const base = 2300 + Math.random() * 1300;
        this.tone(base, 0.09, 'sine', 0.04, base * 1.5, 0, this.amb);
        this.tone(base * 1.2, 0.1, 'sine', 0.035, base * 1.7, 0.12, this.amb);
        if (Math.random() < 0.5) this.tone(base * 1.1, 0.08, 'sine', 0.03, base * 1.6, 0.26, this.amb);
      }
    }
    if (night) {
      this.cricketT -= dt;
      if (this.cricketT <= 0) {
        this.cricketT = 0.7 + Math.random() * 0.5;
        for (let i = 0; i < 3; i++) this.tone(4300, 0.04, 'sine', 0.012, undefined, i * 0.07, this.amb);
      }
    }

    // 오르골 멜로디: 낮엔 경쾌하게, 밤엔 낮은 음으로 느리고 조용하게
    if (this.nextNote < now) this.nextNote = now + 0.2;
    while (this.nextNote < now + 0.25) {
      this.degree = nextDegree(this.degree, Math.random);
      const root = night ? 220 : 261.63;
      const f = noteFreq(root, this.degree);
      const vol = night ? 0.07 : 0.1;
      const t0 = this.nextNote - now;
      this.tone(f, 1.5, 'sine', vol, undefined, t0, this.music);
      this.tone(f * 2, 0.9, 'triangle', vol * 0.3, undefined, t0, this.music);
      this.nextNote += night ? 1.5 + Math.random() * 1.6 : 0.7 + Math.random() * 0.9;
    }
  }
}
