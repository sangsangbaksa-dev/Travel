// Keep startup failures visible even if WebGL or asset initialization fails.
void import('./main').catch((error: unknown) => {
  console.error('Game initialization failed', error);
  const loading = document.getElementById('loading')!;
  loading.hidden = false;
  loading.textContent = '지구를 불러오지 못했어요. WebGL 지원과 연결을 확인하고 새로고침해 주세요.';
  (document.getElementById('startBtn') as HTMLButtonElement).disabled = true;
});
