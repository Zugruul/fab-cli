#!/usr/bin/env python3
"""
postprocess.py — Overlay the real QR codes onto a ChatGPT-generated poster.

ChatGPT can't place scannable QR codes, so the prompt tells it to KEEP the gold
"QR1"/"QR2"/"QR3" text anchors in each panel's right slot. This script detects the
three gold-framed panels in the generated image and composites the real QR PNGs
(on a clean white rounded card that covers the QRn label) into each right slot.

Detection is robust: the panels' gold frames survive ChatGPT's edit, so we find the
three long horizontal gold borders → 3 panel y-bands, independent of resolution.

Usage:
  python postprocess.py --image generated.png --dir <folder with qr1/2/3.png> --out final.png
  python postprocess.py --image generated.png --qr a.png b.png c.png --out final.png
Tuning (rarely needed):
  --xc 0.853     QR slot center as fraction of width
  --scale 0.78   QR size as fraction of panel height
  --card 1.14    white card size as multiple of QR size
"""
import argparse, os, sys
from PIL import Image, ImageDraw

try:
    import numpy as np
except ImportError:
    sys.exit("Missing numpy. Install: <venv>/bin/pip install numpy Pillow")


def detect_panels(im):
    """Return list of (top, bottom) y for the 3 gold-framed panels."""
    W, H = im.size
    a = np.asarray(im.convert("RGBA"))
    r, g, b, al = (a[..., i].astype(int) for i in range(4))
    gold = (r > 150) & (g > 120) & (b < 150) & (al > 40)
    rowcount = gold[:, int(W * 0.06):int(W * 0.94)].sum(axis=1)
    if rowcount.max() == 0:
        return []
    rows = np.where(rowcount > rowcount.max() * 0.5)[0]
    borders, cur = [], [rows[0]]
    for y in rows[1:]:
        if y - cur[-1] > 15:
            borders.append(int(np.mean(cur))); cur = []
        cur.append(y)
    borders.append(int(np.mean(cur)))
    panels = []
    for i in range(len(borders) - 1):
        if borders[i + 1] - borders[i] > H * 0.12:
            panels.append((borders[i], borders[i + 1]))
    return panels[:3]


def rounded_card(size, radius, fill=(255, 255, 255, 255)):
    card = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=fill)
    return card


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dir", help="folder containing qr1.png qr2.png qr3.png")
    ap.add_argument("--qr", nargs=3, help="three QR image paths in order")
    ap.add_argument("--xc", type=float, default=0.853)
    ap.add_argument("--scale", type=float, default=0.78)
    ap.add_argument("--card", type=float, default=1.14)
    args = ap.parse_args()

    if args.qr:
        qr_paths = args.qr
    elif args.dir:
        qr_paths = [os.path.join(args.dir, f"qr{i}.png") for i in range(1, 4)]
    else:
        sys.exit("Provide --dir or --qr")
    for p in qr_paths:
        if not os.path.exists(p):
            sys.exit(f"QR not found: {p}")

    base = Image.open(args.image).convert("RGBA")
    W, H = base.size
    panels = detect_panels(base)
    if len(panels) != 3:
        sys.exit(f"Expected 3 panels, detected {len(panels)}. "
                 f"Check the image, or set slots manually. Detected: {panels}")

    cx = int(W * args.xc)
    for (top, bot), qrp in zip(panels, qr_paths):
        ph = bot - top
        cy = (top + bot) // 2
        qsize = int(ph * args.scale)
        csize = int(qsize * args.card)
        card = rounded_card(csize, radius=max(8, csize // 12))
        base.alpha_composite(card, (cx - csize // 2, cy - csize // 2))
        qr = Image.open(qrp).convert("RGBA").resize((qsize, qsize), Image.NEAREST)
        base.alpha_composite(qr, (cx - qsize // 2, cy - qsize // 2))

    base.convert("RGB").save(args.out)
    print(f"✅ Wrote {args.out}  (panels: {panels}, slot x={cx})")


if __name__ == "__main__":
    main()
