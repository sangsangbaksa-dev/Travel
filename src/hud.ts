// 화면 UI 조작을 한곳에 모은다: 점수, 나침반, 알림, 안내 문구, 시작 화면, 소리/시간 버튼.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const scoreEl = $('score');
const scoreN = $('scoreN');
const compass = $('compass');
const arrow = document.getElementById('arrow') as unknown as SVGElement;
const distEl = $('dist');
const placeEl = $('place');
const toastEl = $('toast');
const hintEl = $('hint');
const startEl = $('start');
const muteBtn = $('muteBtn');
const timeBtn = $('timeBtn');

const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
let toastTimer = 0;

export const hud = {
  isTouch: touch,

  setScore(n: number, bump = false) {
    scoreN.textContent = String(n);
    if (bump) {
      scoreEl.classList.remove('bump');
      void scoreEl.offsetWidth; // 애니메이션을 다시 시작시킨다
      scoreEl.classList.add('bump');
    }
  },

  /** angleDeg: 화면 위쪽이 0도, 시계 방향. null이면 숨긴다 */
  setCompass(angleDeg: number | null, dist = 0) {
    if (angleDeg === null) {
      compass.hidden = true;
      return;
    }
    compass.hidden = false;
    arrow.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;
    distEl.textContent = `${Math.round(dist)}m`;
  },

  setPlace(name: string) {
    placeEl.textContent = name;
  },

  toast(msg: string, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
  },

  showHint(msg: string, ms = 8000) {
    hintEl.textContent = msg;
    hintEl.hidden = false;
    hintEl.classList.remove('hide');
    setTimeout(() => hintEl.classList.add('hide'), ms);
  },

  setMuted(m: boolean) {
    muteBtn.textContent = m ? '소리 꺼짐 (M)' : '소리 켜짐 (M)';
    muteBtn.classList.toggle('on', m);
  },

  setFast(f: boolean) {
    timeBtn.classList.toggle('on', f);
  },

  onMute(cb: () => void) {
    muteBtn.addEventListener('click', cb);
    addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) cb(); });
  },

  onFast(cb: () => void) {
    timeBtn.addEventListener('click', cb);
    addEventListener('keydown', (e) => { if (e.code === 'KeyT' && !e.repeat) cb(); });
  },

  /** 시작 화면: 버튼, Enter, Space 중 무엇으로든 시작한다 */
  onStart(cb: () => void) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      startEl.classList.add('hidden');
      cb();
    };
    $('startBtn').addEventListener('click', go);
    addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') go(); });
    $('startBtn').focus({ preventScroll: true });
  },
};
