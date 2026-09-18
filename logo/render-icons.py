#!/usr/bin/env python3
"""Regenerate assets/*.png app icons from the brand mark.

The source file is named .png but is actually an SVG (2048 viewBox, 3 solid-fill
paths, only M/L/C/z absolute commands). No rsvg/inkscape/imagemagick on this repo's
machines and no node_modules, so: flatten the beziers and fill with PIL at 4x.

    python3 logo/render-icons.py          # writes assets/, then self-checks

Scales are deliberate, not taste:
  ICON 0.74  square tile; 13% cream margin clears the iOS superellipse corner mask.
  ADAPTIVE 0.50  Android foreground; the mark is itself a rounded square, and at
                 >0.50 its edges clip under a launcher's worst-case circular mask
                 (72/108 of the canvas). Verified by rendering the mask.
"""
import re
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "logo" / "Abstract-vector-logo-mark-a-solid-round.png"
ASSETS = ROOT / "assets"
ICON, ADAPTIVE, SS = 0.74, 0.50, 4

svg = re.sub(r"<metadata>.*?</metadata>", "", SRC.read_text(encoding="utf-8", errors="replace"), flags=re.S)
VB = float(re.search(r'viewBox="\s*0\s+0\s+(\d+(?:\.\d+)?)', svg).group(1))
PATHS = [((int(r), int(g), int(b)), d) for r, g, b, d in
         re.findall(r'<path[^>]*fill="rgb\((\d+),\s*(\d+),\s*(\d+)\)"[^>]*\bd="([^"]+)"', svg)]
assert len(PATHS) >= 2, "expected a backdrop path plus at least one mark path"

TOK = re.compile(r"([MLCZmlcz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)")


def _flatten(d, steps=48):
    """SVG path data -> list of closed point rings."""
    toks = TOK.findall(d)
    i, cmd, cur, start, ring, rings = 0, None, (0.0, 0.0), (0.0, 0.0), [], []

    def nums(k):
        nonlocal i
        v = []
        while len(v) < k:
            v.append(float(toks[i][1])); i += 1
        return v

    while i < len(toks):
        op = toks[i][0]
        if op:
            cmd = op; i += 1
            if cmd in "Zz":
                if ring: rings.append(ring); ring = []
                cur = start
                continue
        if cmd in "Mm":
            x, y = nums(2)
            if ring: rings.append(ring); ring = []
            cur = start = (x, y); ring = [cur]
        elif cmd in "Ll":
            cur = tuple(nums(2)); ring.append(cur)
        elif cmd in "Cc":
            x1, y1, x2, y2, x, y = nums(6)
            for s in range(1, steps + 1):
                t = s / steps; u = 1 - t
                ring.append((u*u*u*cur[0] + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x,
                             u*u*u*cur[1] + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y))
            cur = (x, y)
        else:
            raise ValueError(f"unsupported path command {cmd!r} — extend _flatten")
    if ring: rings.append(ring)
    return rings


CREAM = PATHS[0][0]                                   # backdrop rect = brand cream
MARK_RGB = PATHS[1][0]                                # the dark mark
MARK = [r for _, d in PATHS[1:] for r in _flatten(d)]
_xs = [p[0] for r in MARK for p in r]; _ys = [p[1] for r in MARK for p in r]
BBOX = (min(_xs), min(_ys), max(_xs), max(_ys))


def render(size, frac, bg=None, colour=None):
    """frac = the mark's longest side as a fraction of the canvas, centred.
    bg=None leaves the canvas transparent (adaptive foreground / monochrome)."""
    s = size * SS
    img = Image.new("RGBA", (s, s), bg + (255,) if bg else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    w, h = BBOX[2] - BBOX[0], BBOX[3] - BBOX[1]
    k = frac * s / max(w, h)
    ox, oy = (s - w * k) / 2 - BBOX[0] * k, (s - h * k) / 2 - BBOX[1] * k
    for ring in MARK:
        if len(ring) > 2:
            draw.polygon([(x * k + ox, y * k + oy) for x, y in ring], fill=(colour or MARK_RGB) + (255,))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    # iOS rejects an alpha channel on the app icon, hence .convert("RGB").
    render(1024, ICON, CREAM).convert("RGB").save(ASSETS / "icon.png")
    render(48, ICON, CREAM).convert("RGB").save(ASSETS / "favicon.png")
    render(1024, ADAPTIVE).save(ASSETS / "android-icon-foreground.png")
    render(1024, ADAPTIVE, colour=(0, 0, 0)).save(ASSETS / "android-icon-monochrome.png")

    assert CREAM == (242, 236, 216) and MARK_RGB == (34, 36, 19), \
        f"mark is off-brand: {CREAM} / {MARK_RGB} (expected DESIGN.md cream + oliveDark)"
    icon = Image.open(ASSETS / "icon.png")
    assert icon.size == (1024, 1024) and icon.mode == "RGB", f"bad icon: {icon.size} {icon.mode}"
    assert icon.getpixel((8, 8)) == CREAM, "icon corner should be brand cream"
    assert icon.getpixel((512, 300))[0] < 60, "icon centre should be the dark mark"
    fg = Image.open(ASSETS / "android-icon-foreground.png")
    assert fg.mode == "RGBA" and fg.getpixel((8, 8))[3] == 0, "adaptive foreground must be transparent"
    # Mark must survive a launcher's worst-case circular mask (visible area = 72/108).
    r, cx = 1024 * 72 / 108 / 2, 512
    opaque = [(x, y) for x in range(0, 1024, 4) for y in range(0, 1024, 4) if fg.getpixel((x, y))[3] > 8]
    assert opaque and max((x-cx)**2 + (y-cx)**2 for x, y in opaque) < r*r, "mark clips under the circular mask"
    print(f"ok — mark {MARK_RGB} on {CREAM}; icon {ICON:.0%}, adaptive {ADAPTIVE:.0%}, mask-safe")
