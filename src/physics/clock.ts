// 고정 시간 간격 누산기. 렌더 주사율과 무관하게 물리를 동일하게 진행시킨다.
export const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;

export class FixedStepper {
  private acc = 0;

  /** 경과 시간을 넣으면 실행할 스텝 수를 돌려준다. alpha는 보간 비율. */
  advance(frameDt: number): { steps: number; alpha: number } {
    this.acc += Math.min(frameDt, 0.25);
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS) {
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0; // 너무 밀리면 따라잡기를 포기
    return { steps, alpha: this.acc / FIXED_DT };
  }
}
