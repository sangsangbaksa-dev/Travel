import * as THREE from 'three';
import { dirFromLatLon } from './geo';

// 해의 위치: 해가 바로 머리 위에 있는 지점(태양 직하점)의 위경도로 나타낸다.
// 계절(적위)은 날짜로, 경도는 세계시(UTC)로 정한다.

/** 태양 적위(도). dayOfYear는 1월 1일이 0 */
export function declination(dayOfYear: number): number {
  return -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
}

/** 세계시 utcHours(0~24)일 때 태양 직하점의 경도 */
export function subsolarLon(utcHours: number): number {
  const lon = -15 * (utcHours - 12);
  return ((lon + 540) % 360) - 180;
}

export function dayOfYear(date: Date): number {
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000);
}

/** 행성 좌표의 해 방향 (단위 벡터) */
export function sunDirection(dayOfYear: number, utcHours: number, out = new THREE.Vector3()): THREE.Vector3 {
  return dirFromLatLon(declination(dayOfYear), subsolarLon(utcHours), out);
}
