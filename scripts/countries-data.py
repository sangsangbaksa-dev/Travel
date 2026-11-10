#!/usr/bin/env python3
"""국가 경계 데이터 생성기.

Natural Earth 110m admin-0 국가 경계(GeoJSON)를 받아 게임용 countries.json으로 줄인다.
좌표는 0.01도 단위 정수로 양자화하며, 각 국가는 {"n": 한국어 이름, "polys": [[외곽, 구멍...], ...]} 이다.

  python3 -I scripts/countries-data.py <작업 폴더>

결과물: src/earth/assets/countries.json
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'earth' / 'assets' / 'countries.json'
URLS = [
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
    'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson',
]
SCALE = 100  # 0.01도 단위


def fetch(cache: Path) -> bytes:
    if cache.exists() and cache.stat().st_size > 0:
        return cache.read_bytes()
    last_err = None
    for url in URLS:
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                data = resp.read()
            cache.write_bytes(data)
            return data
        except Exception as e:  # 다음 주소로 재시도
            last_err = e
            print(f'다운로드 실패: {url} ({e})', file=sys.stderr)
    raise SystemExit(f'모든 주소에서 다운로드에 실패했다: {last_err}')


def quantize_ring(ring) -> list[int]:
    flat: list[int] = []
    for lon, lat in ring:
        flat.append(round(lon * SCALE))
        flat.append(round(lat * SCALE))
    return flat


def polygons_of(geom) -> list[list[list[int]]]:
    gtype = geom.get('type')
    coords = geom.get('coordinates') or []
    if gtype == 'Polygon':
        polys = [coords]
    elif gtype == 'MultiPolygon':
        polys = coords
    else:
        return []
    out = []
    for poly in polys:
        rings = [quantize_ring(r) for r in poly if len(r) >= 3]
        if rings:
            out.append(rings)
    return out


def main() -> None:
    work = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    work.mkdir(parents=True, exist_ok=True)
    raw = fetch(work / 'ne_110m_admin_0_countries.geojson')
    geo = json.loads(raw.decode('utf-8'))

    countries = []
    for feat in geo.get('features', []):
        props = feat.get('properties') or {}
        name = props.get('NAME_KO') or props.get('NAME')
        if not name:
            continue
        polys = polygons_of(feat.get('geometry') or {})
        if polys:
            countries.append({'n': name, 'polys': polys})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(countries, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(text, encoding='utf-8')
    print(f'{len(countries)}개 국가 -> {OUT}')
    print(f'파일 크기: {OUT.stat().st_size} bytes')


if __name__ == '__main__':
    main()
