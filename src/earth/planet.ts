import * as THREE from 'three';
import { decodeElevation, Elevation } from './elevation';
import { RADIUS } from './geo';
import type { Picture } from './surface';

/** 고도와 위성사진을 묶은 행성. 모든 지형 질의는 여기를 거친다. */
export class Planet {
  constructor(readonly elevation: Elevation, readonly earth: Picture, readonly night: Picture) {}

  /** 단위 방향의 지면 높이 (칸, 해수면 0) */
  height(x: number, y: number, z: number): number {
    return this.elevation.height(x, y, z);
  }

  /** 행성 중심에서 지면까지의 거리 */
  groundRadius(dir: THREE.Vector3): number {
    const l = dir.length();
    return RADIUS + this.elevation.height(dir.x / l, dir.y / l, dir.z / l);
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadPicture(url: string): Promise<Picture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(img, 0, 0);
  return { w: canvas.width, h: canvas.height, data: c.getImageData(0, 0, canvas.width, canvas.height).data };
}

export const EARTH_IMAGE_URL = new URL('./assets/earth.jpg', import.meta.url).href;

/** 브라우저에서 지구 데이터를 불러온다 */
export async function loadPlanet(): Promise<Planet> {
  const elevationUrl = new URL('./assets/elevation.bin', import.meta.url).href;
  const nightUrl = new URL('./assets/night.jpg', import.meta.url).href;
  const [bytes, earth, night] = await Promise.all([
    fetch(elevationUrl).then(r => r.arrayBuffer()),
    loadPicture(EARTH_IMAGE_URL),
    loadPicture(nightUrl),
  ]);
  const grid = await decodeElevation(new Uint8Array(bytes), inflate);
  return new Planet(new Elevation(grid), earth, night);
}
