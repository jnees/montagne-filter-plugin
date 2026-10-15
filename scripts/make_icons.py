"""Draws the extension icon (perfume bottle + in-stock check) at all sizes.

Usage: python3 scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "hide-sold-out" / "icons"
SIZES = [16, 32, 48, 128]
S = 1024  # draw large, then downsample for clean edges

INK = (34, 34, 34, 255)
GLASS = (236, 226, 178, 255)
LABEL = (255, 255, 255, 255)
GREEN = (31, 122, 77, 255)


def draw() -> Image.Image:
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    # Dark rounded tile
    d.rounded_rectangle((32, 32, S - 32, S - 32), radius=200, fill=INK)

    # Bottle: cap, neck, body, label
    d.rounded_rectangle((420, 150, 604, 330), radius=28, fill=(150, 150, 150, 255))
    d.rectangle((455, 320, 569, 380), fill=(200, 200, 200, 255))
    d.rounded_rectangle((260, 370, 764, 880), radius=110, fill=GLASS)
    d.rounded_rectangle((300, 520, 724, 720), radius=16, fill=LABEL)
    d.rectangle((360, 600, 664, 630), fill=INK)

    # In-stock check badge, bottom right
    cx, cy, r = 760, 760, 190
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=GREEN, outline=INK, width=36)
    d.line(
        [(cx - 90, cy + 5), (cx - 25, cy + 75), (cx + 100, cy - 70)],
        fill=LABEL,
        width=56,
        joint="curve",
    )
    return im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    big = draw()
    for size in SIZES:
        big.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
        print("wrote", OUT / f"icon{size}.png")


if __name__ == "__main__":
    main()
