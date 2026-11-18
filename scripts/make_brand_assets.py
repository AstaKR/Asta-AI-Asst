"""Draws the Asta Talk logo and writes every icon the apps need, from one set of numbers.

    .venv\\Scripts\\python.exe scripts\\make_brand_assets.py

The mark is a letter A whose crossbar is a voice waveform (speech + "A" for Asta). Vector sources go to
branding\\*.svg; PNGs go to mobile\\assets and frontend\\public. Needs Pillow and numpy.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
BRAND = REPO / "branding"
ASSETS = REPO / "mobile" / "assets"
WEB_PUBLIC = REPO / "frontend" / "public"

NAME = "Asta Talk"
SS = 4  # supersampling for the mark

# ---- colours (the app's own aurora palette) ----
INK = "#eef1fb"
CANVAS = "#070b1a"
TEAL = "#35e0c0"
WHITE = "#ffffff"
BG_STOPS = [(0.0, "#7c6cf5"), (0.55, "#5445e0"), (1.0, "#281c7a")]
ADAPTIVE_BG = "#3b2eb0"  # android backgroundColor fallback (mid of the gradient)

# ---- geometry, in a 1024 x 1024 space ----
APEX, FOOT_L, FOOT_R = (512, 226), (246, 798), (778, 798)
A_W = 86  # stroke of the A
BAR_W, BAR_STEP, BAR_CY = 36, 54, 664
BAR_H = [88, 160, 228, 160, 88]
CORNER = 228  # rounded-square radius of the full icon


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def gradient(size: int) -> Image.Image:
    xs = np.linspace(0, 1, size, dtype=np.float32)
    t = (xs[None, :] + xs[:, None]) / 2  # top-left -> bottom-right
    out = np.zeros((size, size, 3), dtype=np.float32)
    for (t0, c0), (t1, c1) in zip(BG_STOPS, BG_STOPS[1:]):
        m = (t >= t0) & (t <= t1)
        f = ((t - t0) / (t1 - t0))[m][:, None]
        out[m] = np.array(hex_rgb(c0)) * (1 - f) + np.array(hex_rgb(c1)) * f
    return Image.fromarray(out.astype(np.uint8), "RGB").convert("RGBA")


def draw_mark(size: int, k: float, a_fill: str, bar_fill: str) -> Image.Image:
    """The A + waveform on a transparent square of `size` px; k scales it about the centre."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    unit = big / 1024

    def P(p):
        return ((512 + (p[0] - 512) * k) * unit, (512 + (p[1] - 512) * k) * unit)

    def stroke(p, q, w, fill):
        p, q, r = P(p), P(q), w * k * unit / 2
        d.line([p, q], fill=fill, width=round(r * 2))
        for c in (p, q):
            d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=fill)

    stroke(FOOT_L, APEX, A_W, a_fill)
    stroke(APEX, FOOT_R, A_W, a_fill)
    for i, h in enumerate(BAR_H):
        x = 512 + (i - 2) * BAR_STEP
        half = h / 2 - BAR_W / 2  # the round caps add the rest
        stroke((x, BAR_CY - half), (x, BAR_CY + half), BAR_W, bar_fill)
    return img.resize((size, size), Image.LANCZOS)


def rounded_mask(size: int, radius_ratio: float = CORNER / 1024) -> Image.Image:
    big = size * SS
    m = Image.new("L", (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * radius_ratio), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def icon(size: int, k: float = 0.86, rounded: bool = False) -> Image.Image:
    img = gradient(size)
    img.alpha_composite(draw_mark(size, k, WHITE, TEAL))
    if rounded:
        img.putalpha(rounded_mask(size))
    return img


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"  {path.relative_to(REPO)}  {img.width}x{img.height}")


# ---------- SVG sources ----------
def svg_mark_group(k: float, a: str, bar: str) -> str:
    def p(pt):
        return f"{512 + (pt[0] - 512) * k:.1f} {512 + (pt[1] - 512) * k:.1f}"

    bars = []
    for i, h in enumerate(BAR_H):
        x = 512 + (i - 2) * BAR_STEP
        half = h / 2 - BAR_W / 2
        y1, y2 = 512 + (BAR_CY - half - 512) * k, 512 + (BAR_CY + half - 512) * k
        xx = 512 + (x - 512) * k
        bars.append(f'<line x1="{xx:.1f}" y1="{y1:.1f}" x2="{xx:.1f}" y2="{y2:.1f}"/>')
    return (
        f'<path d="M{p(FOOT_L)} L{p(APEX)} L{p(FOOT_R)}" fill="none" stroke="{a}" stroke-width="{A_W * k:.1f}" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
        f'<g stroke="{bar}" stroke-width="{BAR_W * k:.1f}" stroke-linecap="round">{"".join(bars)}</g>'
    )


def svg_gradient_defs() -> str:
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in BG_STOPS)
    return f'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">{stops}</linearGradient></defs>'


def write_svgs() -> None:
    BRAND.mkdir(exist_ok=True)
    head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Asta Talk">'
    (BRAND / "asta-icon.svg").write_text(
        f'{head}{svg_gradient_defs()}<rect width="1024" height="1024" rx="{CORNER}" fill="url(#bg)"/>{svg_mark_group(0.86, WHITE, TEAL)}</svg>\n',
        encoding="utf-8",
    )
    (BRAND / "asta-mark.svg").write_text(f"{head}{svg_mark_group(1.0, WHITE, TEAL)}</svg>\n", encoding="utf-8")
    # mark for light backgrounds (A in the deep violet, waveform in the stronger teal)
    (BRAND / "asta-mark-light.svg").write_text(f"{head}{svg_mark_group(1.0, '#281c7a', '#0f9c85')}</svg>\n", encoding="utf-8")
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    (WEB_PUBLIC / "favicon.svg").write_text(
        f'{head}{svg_gradient_defs()}<rect width="1024" height="1024" rx="{CORNER}" fill="url(#bg)"/>{svg_mark_group(0.9, WHITE, TEAL)}</svg>\n',
        encoding="utf-8",
    )
    word = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 400" role="img" aria-label="{NAME}">'
        f'<rect width="1500" height="400" fill="{CANVAS}"/>'
        f'<g transform="translate(48 48) scale(0.3)">{svg_gradient_defs()}<rect width="1024" height="1024" rx="{CORNER}" fill="url(#bg)"/>{svg_mark_group(0.86, WHITE, TEAL)}</g>'
        f'<text x="400" y="262" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="190" font-weight="700" fill="{INK}">Asta <tspan fill="{TEAL}">Talk</tspan></text></svg>\n'
    )
    (BRAND / "asta-lockup.svg").write_text(word, encoding="utf-8")


# ---------- PNG sets ----------
def lockup_png(width: int = 1500) -> Image.Image:
    img = Image.new("RGBA", (width, 400), CANVAS)
    img.alpha_composite(icon(304, rounded=True), (48, 48))
    font = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 190)
    d = ImageDraw.Draw(img)
    d.text((400, 262), "Asta ", font=font, fill=INK, anchor="ls")
    d.text((400 + d.textlength("Asta ", font=font), 262), "Talk", font=font, fill=TEAL, anchor="ls")
    return img


def adaptive_preview(mask: str, size: int = 216) -> Image.Image:
    base = Image.new("RGBA", (size, size), ADAPTIVE_BG)
    base = gradient(size)
    base.alpha_composite(draw_mark(size, 0.78, WHITE, TEAL))
    m = Image.new("L", (size * SS, size * SS), 0)
    dd = ImageDraw.Draw(m)
    big = size * SS
    if mask == "circle":
        dd.ellipse([0, 0, big - 1, big - 1], fill=255)
    elif mask == "squircle":
        dd.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.34), fill=255)
    else:
        dd.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.2), fill=255)
    base.putalpha(m.resize((size, size), Image.LANCZOS))
    return base


def preview_sheet() -> Image.Image:
    W, H = 1500, 1060
    sheet = Image.new("RGBA", (W, H), CANVAS)
    sheet.alpha_composite(lockup_png(), (0, 0))
    f = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 26)
    fb = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 26)
    d = ImageDraw.Draw(sheet)
    d.text((48, 440), "App icon and how Android masks it", font=fb, fill=INK)
    x = 48
    sheet.alpha_composite(icon(256, rounded=True), (x, 490))
    d.text((x, 760), "Icon", font=f, fill="#a3adc7")
    x += 296
    for name in ("circle", "squircle", "rounded"):
        sheet.alpha_composite(adaptive_preview(name), (x, 490 + 20))
        d.text((x, 760), name.capitalize(), font=f, fill="#a3adc7")
        x += 256
    # monochrome (themed icons) on a light tile
    tile = Image.new("RGBA", (216, 216), "#e9e6ff")
    mono = draw_mark(216, 0.78, "#2b2358", "#2b2358")
    tile.alpha_composite(mono)
    tm = Image.new("L", (216 * SS, 216 * SS), 0)
    ImageDraw.Draw(tm).rounded_rectangle([0, 0, 216 * SS - 1, 216 * SS - 1], radius=int(216 * SS * 0.34), fill=255)
    tile.putalpha(tm.resize((216, 216), Image.LANCZOS))
    sheet.alpha_composite(tile, (x, 510))
    d.text((x, 760), "Themed (mono)", font=f, fill="#a3adc7")

    d.text((48, 810), "Small sizes", font=fb, fill=INK)
    x = 48
    for s in (96, 64, 48, 32, 24):
        sheet.alpha_composite(icon(s, rounded=True), (x, 860))
        d.text((x, 860 + s + 6), str(s), font=f, fill="#a3adc7")
        x += s + 40
    # light background lockup mark
    light = Image.new("RGBA", (320, 120), "#ffffff")
    light.alpha_composite(draw_mark(120, 1.0, "#281c7a", "#0f9c85"), (0, 0))
    ld = ImageDraw.Draw(light)
    ld.text((130, 78), NAME, font=ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 40), fill="#281c7a", anchor="ls")
    sheet.alpha_composite(light, (1060, 840))
    return sheet


def main() -> None:
    print("SVG sources:")
    write_svgs()
    print("Mobile icons:")
    save(icon(1024), ASSETS / "icon.png")  # full-bleed; iOS and legacy Android apply their own mask
    save(gradient(1024), ASSETS / "android-icon-background.png")
    save(draw_mark(1024, 0.78, WHITE, TEAL), ASSETS / "android-icon-foreground.png")
    save(draw_mark(1024, 0.78, WHITE, WHITE), ASSETS / "android-icon-monochrome.png")
    save(icon(1024, rounded=True), ASSETS / "splash-icon.png")
    save(icon(192, rounded=True).resize((48, 48), Image.LANCZOS), ASSETS / "favicon.png")
    print("Web icons:")
    save(icon(180), WEB_PUBLIC / "apple-touch-icon.png")
    save(icon(192, rounded=True), WEB_PUBLIC / "icon-192.png")
    save(icon(512, rounded=True), WEB_PUBLIC / "icon-512.png")
    print("Preview:")
    save(lockup_png(), BRAND / "asta-lockup.png")
    save(preview_sheet().convert("RGB"), BRAND / "preview.png")


if __name__ == "__main__":
    main()
