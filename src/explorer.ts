import { SITES } from './earth/landmarks';
import type { Minimap } from './world/minimap';

export function setupExplorer(map: Minimap, teleport: (lat: number, lon: number) => void) {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'explorerTitle');
  dialog.innerHTML = `<h2 id="explorerTitle">세계지도 · 목적지 탐색</h2>
    <p>지도 위쪽은 북쪽입니다. 장소를 선택하면 안전한 지표면 또는 수면 위로 이동해요.</p>
    <label for="destinationSearch">장소 검색</label><input id="destinationSearch" type="search" placeholder="에베레스트, 마리아나, 서울…" />
    <div class="destinations"></div><p class="empty" hidden>검색 결과가 없어요.</p>
    <form method="dialog"><button type="submit">닫기</button></form>`;
  document.body.append(dialog);
  const search = dialog.querySelector('input')!;
  const list = dialog.querySelector('.destinations')!;
  const sites = [{ name: '뉴욕 · 출발 지점', lat: 40.758, lon: -73.9855 }, ...SITES];
  const render = () => {
    list.replaceChildren();
    for (const site of sites.filter(s => s.name.includes(search.value.trim()))) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = site.name;
      button.addEventListener('click', () => {
        teleport(site.lat, site.lon);
        dialog.close();
      });
      list.append(button);
    }
    (dialog.querySelector('.empty') as HTMLElement).hidden = list.childElementCount > 0;
  };
  search.addEventListener('input', render);
  const open = () => {
    if (!document.body.classList.contains('game-started') || dialog.open) return;
    document.exitPointerLock?.();
    window.dispatchEvent(new Event('blur'));
    map.showWorld();
    search.value = ''; render(); dialog.showModal(); search.focus();
  };
  document.getElementById('mapBtn')!.addEventListener('click', open);
  addEventListener('keydown', e => { if (e.code === 'KeyN' && !e.repeat && !dialog.open) open(); });

  const help = document.createElement('dialog');
  help.setAttribute('aria-label', '조작 도움말');
  const title = document.createElement('h2'); title.textContent = '조작 도움말'; help.append(title);
  for (const section of document.querySelectorAll('.card details')) {
    const copy = section.cloneNode(true) as HTMLDetailsElement;
    copy.removeAttribute('id'); copy.open = true; help.append(copy);
  }
  const close = document.createElement('button'); close.textContent = '닫기';
  close.addEventListener('click', () => help.close()); help.append(close); document.body.append(help);
  document.getElementById('helpBtn')!.addEventListener('click', () => {
    document.exitPointerLock?.(); window.dispatchEvent(new Event('blur')); help.showModal();
  });
}
