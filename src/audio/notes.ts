// 배경 멜로디용 음계 도우미 (순수 함수)
export const PENTATONIC = [0, 2, 4, 7, 9]; // 장조 5음 음계: 어떤 순서로 쳐도 어울린다

/** root(Hz)에서 degree번째 음의 주파수. degree는 음수/옥타브 초과도 가능 */
export function noteFreq(root: number, degree: number): number {
  const oct = Math.floor(degree / 5);
  const idx = ((degree % 5) + 5) % 5;
  return root * 2 ** ((PENTATONIC[idx] + 12 * oct) / 12);
}

/** 이전 음에서 한두 칸 오르내리는 무작위 걷기. 범위를 벗어나면 되돌아온다. */
export function nextDegree(cur: number, rnd: () => number, lo = -3, hi = 9): number {
  const step = Math.floor(rnd() * 5) - 2 || 1; // -2..2, 0이면 1
  let next = cur + step;
  if (next < lo || next > hi) next = cur - step;
  return Math.min(hi, Math.max(lo, next));
}
