// 바다 이름: 위경도로 가늠하는 대략적인 경계
const SEAS: { n: string; lat: [number, number]; lon: [number, number] }[] = [
  { n: '황해', lat: [32, 40.5], lon: [119, 126.6] },
  { n: '동해', lat: [34.5, 46], lon: [128, 141] },
  { n: '남중국해', lat: [3, 23], lon: [105, 121] },
  { n: '동중국해', lat: [24, 32], lon: [119, 131] },
  { n: '카리브해', lat: [9, 22], lon: [-88, -60] },
  { n: '멕시코만', lat: [18, 31], lon: [-98, -81] },
  { n: '지중해', lat: [30, 46], lon: [-5.5, 36.5] },
  { n: '흑해', lat: [40.8, 47], lon: [27, 42] },
  { n: '홍해', lat: [12, 30], lon: [32, 44] },
  { n: '페르시아만', lat: [23.5, 30.5], lon: [47.5, 57] },
  { n: '북해', lat: [51, 61], lon: [-4, 9] },
  { n: '발트해', lat: [53.5, 66], lon: [9.5, 30] },
  { n: '베링해', lat: [52, 66], lon: [162, 180] },
  { n: '베링해', lat: [52, 66], lon: [-180, -157] },
  { n: '허드슨만', lat: [51, 64], lon: [-95, -77] },
  { n: '카스피해', lat: [36.5, 47.5], lon: [46.5, 55] },
];

export function seaName(lat: number, lon: number): string {
  for (const s of SEAS) if (lat >= s.lat[0] && lat <= s.lat[1] && lon >= s.lon[0] && lon <= s.lon[1]) return s.n;
  if (lat > 66) return '북극해';
  if (lat < -60) return '남극해';
  if (lon >= 20 && lon < 120 && lat < 30) return '인도양';
  if (lon >= 120 && lon < 147 && lat < -12) return '인도양';
  if (lon >= -70 && lon < 20) return '대서양';
  if (lon >= -100 && lon < -70 && lat > 8) return '대서양';
  return '태평양';
}
