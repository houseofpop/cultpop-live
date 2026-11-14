# Uniforma le foto dei Gen Z: stessa inquadratura (testa alla stessa altezza e grandezza), busto tagliato dritto, bordo bianco tipo adesivo.
import sys, pathlib
from PIL import Image, ImageFilter, ImageOps, ImageChops
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
# testa: (cima dei capelli, mento, centro x) nelle foto caricate su Magnific
HEAD = {'chichi': (32, 632, 800), 'fil': (320, 1032, 456), 'giorgia': (200, 888, 544), 'tommaso': (352, 1328, 720), 'greta': (80, 700, 600), 'jack': (560, 1376, 512)}
OUT, RATIO, TOP, BORDER = 800, 0.52, 0.07, 14  # poi ridotte a 512 px per il sito
for n, (top, chin, cx) in HEAD.items():
    im = Image.open(src / f'{n}.png').convert('RGBA')
    hh = chin - top
    cut = min(im.height, int(chin + 0.30 * hh))  # stesso taglio per tutti: collo e attacco delle spalle
    a = im.getchannel('A'); a = a.point(lambda v: 255 if v > 128 else (0 if v < 40 else v))
    a.paste(0, (0, cut, im.width, im.height)); im.putalpha(a)
    S = hh / RATIO
    x0, y0 = int(cx - S / 2), int(top - TOP * S)
    tile = Image.new('RGBA', (int(S), int(S)), (0, 0, 0, 0))
    tile.paste(im, (-x0, -y0), im)
    tile = tile.resize((OUT, OUT), Image.LANCZOS)
    # luce uniforme: leggero autocontrasto solo sulla persona
    rgb = ImageOps.autocontrast(tile.convert('RGB'), cutoff=1); tile = Image.merge('RGBA', (*rgb.split(), tile.getchannel('A')))
    alpha = tile.getchannel('A')
    solid = alpha.filter(ImageFilter.GaussianBlur(4)).point(lambda v: 255 if v > 140 else 0)  # niente aloni attorno ai capelli ricci
    ring = ImageChops.lighter(solid, alpha.point(lambda v: 255 if v > 200 else 0)).filter(ImageFilter.MaxFilter(BORDER * 2 + 1)).filter(ImageFilter.GaussianBlur(1.2))
    sticker = Image.new('RGBA', (OUT, OUT), (255, 255, 255, 0)); sticker.putalpha(ring)
    shadow = Image.new('RGBA', (OUT, OUT), (23, 18, 31, 0)); shadow.putalpha(ring.point(lambda v: int(v * 0.35)))
    final = Image.new('RGBA', (OUT, OUT), (0, 0, 0, 0))
    final.alpha_composite(shadow, (8, 10)); final.alpha_composite(sticker); final.alpha_composite(tile)
    final.save(out / f'{n}.webp', 'WEBP', quality=86, method=6)
    print(n, 'testa', hh, 'riquadro', int(S), 'taglio busto a', cut, '/', im.height)
