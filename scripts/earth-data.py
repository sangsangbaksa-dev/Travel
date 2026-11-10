#!/usr/bin/env python3
"""지구 데이터 생성기.

NOAA ETOPO1(육지 고도 + 해저 수심)을 10분 간격으로 받아 게임용 이진 파일로 압축하고,
NASA 블루 마블 위성사진과 야간 도시 불빛 사진을 게임 크기로 줄여 저장한다.

  python3 scripts/earth-data.py <작업 폴더>

결과물: src/earth/assets/elevation.bin, earth.jpg, night.jpg
"""
import io
import struct
import sys
import urllib.request
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'earth' / 'assets'
ETOPO = 'https://upwell.pfeg.noaa.gov/erddap/griddap/etopo180.nc?altitude%5B(-90):10:(90)%5D%5B(-180):10:(180)%5D'
IMG = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img/'
W, H = 2161, 1081  # 10분 간격, 양 극과 ±180°를 모두 포함하는 격자
Q_LAND, Q_SEA = 2, 8  # 미터 단위 양자화 간격


def fetch(url: str, cache: Path) -> bytes:
    if not cache.exists():
        print('받는 중', url)
        with urllib.request.urlopen(url, timeout=600) as r:
            cache.write_bytes(r.read())
    return cache.read_bytes()


def elevation(work: Path) -> None:
    raw = fetch(ETOPO, work / 'etopo10.nc')
    a = np.frombuffer(raw[-W * H * 2:], dtype='>i2').reshape(H, W).astype(np.int32)  # 남→북, 서→동
    code = np.where(a >= 0, np.round(a / Q_LAND), np.round(a / Q_SEA)).astype(np.int32)
    # 왼쪽 + 위 - 왼쪽위 예측의 잔차만 저장하면 훨씬 잘 압축된다
    pred = np.zeros_like(code)
    pred[1:, 1:] = code[1:, :-1] + code[:-1, 1:] - code[:-1, :-1]
    pred[0, 1:] = code[0, :-1]
    pred[1:, 0] = code[:-1, 0]
    resid = (code - pred).astype('<i2')
    header = struct.pack('<4sHHHH', b'ETP1', W, H, Q_LAND, Q_SEA)
    body = zlib.compress(resid.tobytes(), 9)
    (OUT / 'elevation.bin').write_bytes(header + body)
    print('elevation.bin', len(body) // 1024, 'KB', 'min', a.min(), 'max', a.max())


def image(name: str, out: str, size: tuple[int, int], quality: int, work: Path) -> None:
    im = Image.open(io.BytesIO(fetch(IMG + name, work / name))).convert('RGB')
    im = im.resize(size, Image.LANCZOS)
    im.save(OUT / out, quality=quality, optimize=True, progressive=True)
    print(out, (OUT / out).stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    work = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    work.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    elevation(work)
    image('earth-blue-marble.jpg', 'earth.jpg', (4096, 2048), 86, work)
    image('earth-night.jpg', 'night.jpg', (2048, 1024), 80, work)
