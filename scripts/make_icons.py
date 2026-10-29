"""Gera os ícones da PWA em docs/icons/ sem dependências externas.

Um prato branco sobre fundo verde, em dois conjuntos:
- icon-192.png e icon-512.png: o ícone normal ("any").
- icon-maskable-192.png e icon-512.png: com o prato mais pequeno, para o Android os poder cortar em círculo,
  quadrado arredondado, etc. sem lhes comer o prato (o prato fica dentro da zona segura de 80%).
"""

import struct
import zlib
from pathlib import Path

BG = (47, 125, 79)
WHITE = (255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"
MASKABLE_PLATE = 0.85  # o prato do ícone maskable tem 85% do tamanho do normal


def pixel(x: float, y: float, size: int, plate: float) -> tuple[int, int, int]:
    c = size / 2
    d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5 / (size * plate)
    if d > 0.30:
        return BG
    if 0.205 <= d <= 0.235:  # aro do prato
        return BG
    return WHITE


def render(size: int, plate: float) -> bytes:
    rows = []
    offsets = [(i + 0.5) / 3 for i in range(3)]  # 3x3 subamostras por píxel para suavizar
    for y in range(size):
        row = bytearray([0])  # filtro PNG: nenhum
        for x in range(size):
            samples = [pixel(x + ox, y + oy, size, plate) for ox in offsets for oy in offsets]
            row.extend(round(sum(s[i] for s in samples) / 9) for i in range(3))
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path: Path, size: int, plate: float = 1.0) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8 bits, RGB
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(render(size, plate), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        write_png(OUT / f"icon-{size}.png", size)
        write_png(OUT / f"icon-maskable-{size}.png", size, MASKABLE_PLATE)
        print(f"icon-{size}.png e icon-maskable-{size}.png")
