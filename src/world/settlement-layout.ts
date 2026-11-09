/** 정착지 배치는 렌더링과 월드 충돌이 공유한다. */
export const SETTLEMENTS = [
  { x: 30, z: 15, name: '꽃길 마을' },
  { x: -50, z: -25, name: '바람 마을' },
  { x: 85, z: -50, name: '햇살 도시' },
] as const;
export const BUILDING_OFFSETS = [[-9,-8],[0,-11],[9,-8],[-11,1],[11,1],[-9,9],[0,11],[9,9]] as const;
export const CITY_BUILDING_OFFSETS = [
  [-10,-10],[-5,-12],[8,-10],[12,-5],[-12,5],[-9,10],[5,12],[10,10],
  [-20,-20],[-10,-20],[10,-20],[-20,20],[-10,20],[10,20],
] as const;
export const settlementRadius = (index: number) => index === 2 ? 29 : 17;
export const inSettlement = (x: number, z: number) => SETTLEMENTS.some((p, i) => Math.hypot(x-p.x,z-p.z) < settlementRadius(i));

/** 정착지 경계 안에 있을 때 가장 가까운 이름을 반환한다. */
export function settlementNameAt(x: number, z: number): string | null {
  let best: string | null = null;
  let distance = Infinity;
  for (const [index, place] of SETTLEMENTS.entries()) {
    const d = Math.hypot(x - place.x, z - place.z);
    if (d < settlementRadius(index) && d < distance) { distance = d; best = place.name; }
  }
  return best;
}
