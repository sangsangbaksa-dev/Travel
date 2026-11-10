// 화면 UI 조작을 한곳에 모은다.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
    muteBtn.textContent = touch ? (m ? '소리 꺼짐' : '소리') : (m ? '소리 꺼짐 (M)' : '소리 켜짐 (M)');
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
    if (touch) timeBtn.textContent = '시간';
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
