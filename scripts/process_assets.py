"""Chroma-key, crop, and pack Flappy Dude sprites from Imagine outputs."""

from __future__ import annotations

import colorsys
import json
import math
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SRC = Path(
    r"C:\Users\KROSS\.grok\sessions"
    r"\C%3A%5CUsers%5CKROSS%5CDesktop%5Cprogramming%20projects%5Cgames%5Cflappy-dude"
    r"\01a098ac-e682-7be1-8edd-8c169a51a886\images"
)
OUT = Path(__file__).resolve().parents[1] / "public" / "assets"
OUT.mkdir(parents=True, exist_ok=True)


def is_magenta(r: int, g: int, b: int) -> bool:
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    if s < 0.22 or v < 0.18:
        return False
    return h >= 0.72 or h <= 0.02


def chroma_and_flood(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    pix = im.load()

    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if is_magenta(r, g, b):
                pix[x, y] = (0, 0, 0, 0)

    # Flood from every edge pixel that is already transparent or still magenta-ish
    seen = bytearray(w * h)
    q = deque()

    def push(x: int, y: int) -> None:
        i = y * w + x
        if seen[i]:
            return
        seen[i] = 1
        q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        r, g, b, a = pix[x, y]
        if a == 0 or is_magenta(r, g, b) or (r > 160 and b > 90 and g < 120 and r + b > g * 2.4):
            pix[x, y] = (0, 0, 0, 0)
            if x > 0:
                push(x - 1, y)
            if x + 1 < w:
                push(x + 1, y)
            if y > 0:
                push(x, y - 1)
            if y + 1 < h:
                push(x, y + 1)

    # Despill remaining magenta fringe
    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if a == 0:
                continue
            h_, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            if s > 0.15 and 0.70 <= h_ <= 0.98:
                mag = min(r, b)
                r = min(255, int(g * 0.65 + r * 0.35))
                b = min(255, int(g * 0.65 + b * 0.35))
                a = int(a * 0.55)
                pix[x, y] = (r, g, b, a)

    return im


def alpha_bbox(im: Image.Image, threshold: int = 12) -> tuple[int, int, int, int] | None:
    w, h = im.size
    pix = im.load()
    min_x, min_y, max_x, max_y = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            if pix[x, y][3] > threshold:
                found = True
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y
    if not found:
        return None
    return min_x, min_y, max_x + 1, max_y + 1


def crop_alpha(im: Image.Image, pad: int = 8) -> Image.Image:
    box = alpha_bbox(im)
    if not box:
        return im
    x0, y0, x1, y1 = box
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(im.width, x1 + pad)
    y1 = min(im.height, y1 + pad)
    return im.crop((x0, y0, x1, y1))


def resize_max(im: Image.Image, max_w: int, max_h: int) -> Image.Image:
    im.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
    return im


def make_x_seamless(im: Image.Image, overlap: int = 96) -> Image.Image:
    im = im.convert("RGB")
    w, h = im.size
    overlap = min(overlap, w // 4)
    double = Image.new("RGB", (w * 2, h))
    double.paste(im, (0, 0))
    double.paste(im, (w, 0))
    pix = double.load()
    for x in range(overlap):
        t = x / max(overlap - 1, 1)
        t = t * t * (3 - 2 * t)
        xa = w - overlap + x
        xb = w + x
        for y in range(h):
            pa = pix[xa, y]
            pb = pix[xb, y]
            mix = tuple(int(pa[c] * (1 - t) + pb[c] * t) for c in range(3))
            pix[xa, y] = mix
            pix[xb, y] = mix
    return double.crop((w // 2, 0, w // 2 + w, h))


def crop_ground(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    w, h = im.size
    pix = im.load()
    grass_top = None
    for y in range(h):
        green = 0
        for x in range(0, w, 8):
            r, g, b = pix[x, y]
            if g > r + 20 and g > b + 15 and g > 80:
                green += 1
        if green > (w / 8) * 0.35:
            grass_top = y
            break
    if grass_top is None:
        grass_top = int(h * 0.28)
    y0 = max(0, grass_top - 6)
    cropped = im.crop((0, y0, w, h))
    return make_x_seamless(cropped, overlap=120)


def mirror_loop(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    flip = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    out = Image.new("RGB", (im.width * 2, im.height))
    out.paste(im, (0, 0))
    out.paste(flip, (im.width, 0))
    return out


def tile_check(im: Image.Image, path: Path) -> None:
    w, h = im.size
    grid = Image.new("RGB", (w * 2, h * 2))
    for i in range(2):
        for j in range(2):
            grid.paste(im.convert("RGB"), (i * w, j * h))
    grid.thumbnail((1200, 800), Image.Resampling.LANCZOS)
    grid.save(path)


def process_keyed(src_name: str, dest_name: str, max_w: int, max_h: int) -> Image.Image:
    im = Image.open(SRC / src_name)
    keyed = chroma_and_flood(im)
    cropped = crop_alpha(keyed, pad=6)
    cropped = resize_max(cropped, max_w, max_h)
    cropped.save(OUT / dest_name)
    print(f"wrote {dest_name} {cropped.size}")
    return cropped


def main() -> None:
    pipe = process_keyed("1.jpg", "pipe.png", 280, 900)
    process_keyed("2.jpg", "wing.png", 320, 320)
    process_keyed("8.jpg", "beak.png", 320, 320)
    process_keyed("4.jpg", "cloud.png", 640, 360)
    process_keyed("5.jpg", "play.png", 280, 280)

    ground_src = Image.open(SRC / "7.jpg")
    ground = crop_ground(ground_src)
    ground = ground.resize((1024, int(1024 * ground.height / ground.width)), Image.Resampling.LANCZOS)
    ground.save(OUT / "ground.png")
    tile_check(ground, OUT / "_ground_tile_check.png")
    print(f"wrote ground.png {ground.size}")

    hills = Image.open(SRC / "6.jpg").convert("RGB")
    hills = hills.resize((960, int(960 * hills.height / hills.width)), Image.Resampling.LANCZOS)
    hills_loop = mirror_loop(hills)
    hills_loop.save(OUT / "hills.png")
    print(f"wrote hills.png {hills_loop.size}")

    cap_ratio = 0.18
    box = alpha_bbox(pipe)
    if box:
        # Estimate cap as the top band that is wider than the shaft.
        pix = pipe.load()
        widths = []
        for y in range(pipe.height):
            xs = [x for x in range(pipe.width) if pix[x, y][3] > 20]
            widths.append((xs[-1] - xs[0] + 1) if xs else 0)
        max_w = max(widths) if widths else pipe.width
        shaft_w = max_w
        # median of lower half as shaft width
        lower = [w for w in widths[int(pipe.height * 0.4) :] if w > 0]
        if lower:
            lower_sorted = sorted(lower)
            shaft_w = lower_sorted[len(lower_sorted) // 2]
        cap_end = 0
        for y, ww in enumerate(widths):
            if ww > 0 and ww <= shaft_w * 1.08 and y > 8:
                cap_end = y
                break
        if cap_end:
            cap_ratio = cap_end / pipe.height

    meta = {"pipeCapRatio": round(float(cap_ratio), 3)}
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("meta", meta)


if __name__ == "__main__":
    main()
