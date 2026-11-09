import * as THREE from 'three';

// 카메라를 따라다니는 큰 수면. 반투명이라 바닥의 모래빛이 비쳐 보인다.
export class Water {
  readonly mesh: THREE.Mesh;

  constructor(level: number) {
    const geo = new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        color: '#7fd3ea', emissive: '#2a6f86', emissiveIntensity: 0.18,
        transparent: true, opacity: 0.72, depthWrite: false,
      }),
    );
    this.mesh.position.y = level;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  follow(x: number, z: number) {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }
}
