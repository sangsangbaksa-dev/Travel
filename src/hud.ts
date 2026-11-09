// 조작 안내 문구: 환경(터치/키보드)에 맞춰 보여주고, 잠시 뒤 사라진다.
const hint = document.getElementById('hint')!;
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
hint.textContent = touch
  ? '왼쪽 스틱으로 이동 · 화면 드래그로 시점 · 점프 버튼'
  : 'WASD 이동 · 스페이스 점프(길게 누르면 높이 뜀) · 드래그/QE 시점';
setTimeout(() => hint.classList.add('hide'), 9000);
