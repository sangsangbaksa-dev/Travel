import data from './assets/countries.json';

/**
 * 국가 경계. polys[폴리곤][링][인덱스]: 각 링은 [lon0, lat0, lon1, lat1, ...] 평탄 배열이며
 * 값은 0.01도 단위 정수(도 × 100)다. 첫 링이 외곽, 나머지는 구멍이다.
 */
export interface Country {
  n: string;
  polys: number[][][];
}

const SCALE = 100;

interface Poly {
  rings: Float64Array[]; // 도 단위 링
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

interface Entry {
  name: string;
  polys: Poly[];
}

/** 짝수-홀수 규칙으로 점이 링 안에 있는지 판정한다 (lon = x, lat = y). */
function inRing(ring: Float64Array, lon: number, lat: number): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1];
    const xj = ring[j], yj = ring[j + 1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function buildPoly(rawRings: number[][]): Poly | null {
  const rings: Float64Array[] = [];
  for (const raw of rawRings) {
    if (raw.length < 6) continue;
    const r = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) r[i] = raw[i] / SCALE;
    rings.push(r);
  }
  if (rings.length === 0) return null;
  // 외곽 링 기준 바운딩 박스 (구멍은 외곽 안에만 있다).
  const outer = rings[0];
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < outer.length; i += 2) {
    minLon = Math.min(minLon, outer[i]);
    maxLon = Math.max(maxLon, outer[i]);
    minLat = Math.min(minLat, outer[i + 1]);
    maxLat = Math.max(maxLat, outer[i + 1]);
  }
  return { rings, minLon, maxLon, minLat, maxLat };
}

function containsPoly(p: Poly, lon: number, lat: number): boolean {
  if (lon < p.minLon || lon > p.maxLon || lat < p.minLat || lat > p.maxLat) return false;
  // 구멍까지 포함해 짝수-홀수로 판정하면 구멍 내부는 자동으로 제외된다.
  let inside = false;
  for (const ring of p.rings) {
    if (inRing(ring, lon, lat)) inside = !inside;
  }
  return inside;
}

export class CountryIndex {
  private readonly entries: Entry[];

  constructor(data: Country[]) {
    this.entries = [];
    for (const c of data) {
      const polys: Poly[] = [];
      for (const rings of c.polys) {
        const p = buildPoly(rings);
        if (p) polys.push(p);
      }
      if (polys.length) this.entries.push({ name: c.n, polys });
    }
  }

  /** lat/lon in degrees → Korean country name, or null over ocean */
  nameAt(lat: number, lon: number): string | null {
    // 날짜변경선 처리: 경도를 ±360도 옮긴 좌표로도 확인한다.
    // (Natural Earth 110m 데이터는 대부분 ±180에서 끊겨 있으므로 보통 첫 번째 시도로 충분하다.)
    const shifts = [0, 360, -360];
    for (const shift of shifts) {
      const x = lon + shift;
      for (const e of this.entries) {
        for (const p of e.polys) {
          if (containsPoly(p, x, lat)) return e.name;
        }
      }
    }
    return null;
  }
}

export async function loadCountries(): Promise<CountryIndex> {
  return new CountryIndex(data as Country[]);
}
