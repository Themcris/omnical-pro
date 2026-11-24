"""Genera los iconos de la PWA (192, 512 y maskable 512) en web/.   python3 gen_icons.py"""
import math
from PIL import Image, ImageDraw

BG, FG = '#0b1016', '#19e6bd'

def icono(size, nombre, maskable=False):
    S = 4                                   # supermuestreo para bordes suaves
    px = size * S
    img = Image.new('RGB', (px, px), BG)
    d = ImageDraw.Draw(img)
    zona = 0.62 if maskable else 1.0        # el maskable deja margen de seguridad (círculo 80%)
    off = px * (1 - zona) / 2
    m = off + px * zona * 0.1
    d.rounded_rectangle([m, m, px - m, px - m], radius=px * zona * 0.25, outline=FG, width=int(px * zona * 0.04))
    cy, amp = px / 2, px * zona * 0.15
    x0, x1 = m + px * zona * 0.09, px - m - px * zona * 0.09
    pts = [(x, cy + amp * math.sin((x - x0) / (px * zona * 0.085))) for x in range(int(x0), int(x1))]
    d.line(pts, fill=FG, width=int(px * zona * 0.045), joint='curve')
    r = px * zona * 0.03
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=FG)
    img.resize((size, size), Image.LANCZOS).save(nombre)
    print(f'✔ {nombre}')

icono(192, 'web/icon-192.png')
icono(512, 'web/icon-512.png')
icono(512, 'web/icon-maskable-512.png', maskable=True)
