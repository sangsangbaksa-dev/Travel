// 화면 UI 조작을 한곳에 모은다.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const placeEl = $('place');
const toastEl = $('toast');
const hintEl = $('hint');
const startEl = $('start');
const muteBtn = $('muteBtn');
const viewBtn = $('viewBtn');
const startBtn = $('startBtn') as HTMLButtonElement;
const loadingEl = $('loading');

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


  onMute(cb: () => void) {
    muteBtn.addEventListener('click', cb);
    addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) cb(); });
  },


  /** 1인칭/3인칭 전환 (T) */
  onView(cb: () => void) {
    viewBtn.addEventListener('click', cb);
    addEventListener('keydown', (e) => { if (e.code === 'KeyT' && !e.repeat) cb(); });
  },

  setView(firstPerson: boolean) {
    viewBtn.textContent = touch ? (firstPerson ? '1인칭' : '3인칭') : (firstPerson ? '1인칭 (T)' : '3인칭 (T)');
    viewBtn.classList.toggle('on', firstPerson);
  },

  /** 줌 버튼: dir > 0이면 멀어진다 */
  onZoom(cb: (dir: number) => void) {
    $('zoomOut').addEventListener('click', () => cb(1));
    $('zoomIn').addEventListener('click', () => cb(-1));
  },

  /** 불러오는 동안 시작 버튼을 막고 문구를 보인다. null이면 준비 완료 */
  setLoading(msg: string | null) {
    loadingEl.textContent = msg ?? '';
    loadingEl.hidden = msg === null;
    startBtn.disabled = msg !== null;
    if (msg === null) startBtn.focus({ preventScroll: true });
  },

  /** 시작 화면: 버튼, Enter, Space 중 무엇으로든 시작한다 */
  onStart(cb: () => void) {
    let done = false;
    const go = () => {
      if (done || startBtn.disabled) return;
      done = true;
      startEl.classList.add('hidden');
      cb();
    };
    startBtn.addEventListener('click', go);
    addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') go(); });
  },
};
