#!/usr/bin/env python3
"""
generate.py — Produce all files needed for a "Top 3 decks" Instagram post.

Outputs into a TIMESTAMPED subfolder of --out (e.g. /tmp/<hero>-post/20260617-201530/):
  - template_transparent.png  (panels only, transparent bg — primary base for a generated background)
  - template_grey.png         (flat grey bg — no-AI-background fallback)
  - qr1.png / qr2.png / qr3.png   (scannable QR codes — composited locally, NOT uploaded)
  - PROMPT.md            (the ready-to-paste ChatGPT prompt, with values filled in)

Flow: the human uploads a template to ChatGPT + pastes PROMPT.md (ChatGPT keeps the
"QR1/2/3" text anchors), downloads the result, then runs postprocess.py to composite
the real qr1/2/3.png over those anchors. QRs are NOT uploaded to ChatGPT.

Template placeholders:
  {TITLE} {SUBTITLE}
  per deck n: {DECK_NAME_n} {DECK_CREATOR_n} {WR_n} {WINS_n} {LOSSES_n} {GAMES_n}
  {DATA_SOURCE}
  QR slots are TEXT labels "QR1" / "QR2" / "QR3" (no baked QR graphic) — these get
  replaced by the uploaded qr1/2/3.png images.
The surrounding literals ("By ", "% WR · ", "W-", "L · ", " games", "Data: ...") are
baked into the template — only the {TOKENS} and QR labels get replaced.

Usage:
  python generate.py \
    --out /tmp/prism-post \
    --title PRISM \
    --subtitle "BEST SILVER AGE DECKS · TOP 3 BY WIN RATE (≥30 GAMES)" \
    --data-source "fabrary.net" \
    --deck "OMN Prism upgraded|deskto|66|166|84|250|https://fabrary.net/decks/01KRZXE0NQYX1SJ121BV5GW7Z7" \
    --deck "Hybrid Prism SAGE|sockhands|50|99|100|199|https://fabrary.net/decks/01K848F7REX9GZD7CVJB5PN470" \
    --deck "Prism By the Book (SUP 2025)|Dozr|41|43|62|105|https://fabrary.net/decks/01K8F8TKTMFP3JT1B2GTA05G6J" \
    --bg-theme "prismatic refracted light over deep indigo, crystalline shards, no characters"

Each --deck is "NAME|CREATOR|WR|WINS|LOSSES|GAMES|URL". Exactly 3 required.
WR is the win-rate number only (no %), e.g. 66.
"""
import argparse, datetime, os, shutil, sys

try:
    import qrcode
except ImportError:
    sys.exit("Missing dep. Install with: <venv>/bin/pip install 'qrcode[pil]' Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
TEMPLATE_TRANSPARENT = os.path.join(ASSETS, "template_transparent.png")
TEMPLATE_GREY = os.path.join(ASSETS, "template_grey.png")
FIELDS = ["name", "creator", "wr", "wins", "losses", "games", "url"]


def make_qr(url: str, path: str):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=20, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    qr.make_image(fill_color="black", back_color="white").save(path)


def build_prompt(title, subtitle, data_source, decks, bg_theme, extra=None):
    d = decks
    stat = [f"{x['wr']}% WR · {x['wins']}W-{x['losses']}L · {x['games']} games" for x in d]
    extra_block = ""
    if extra:
        bullets = "\n".join(f"- {e}" for e in extra)
        extra_block = f"\n\nADDITIONAL ART DIRECTION (user suggestions — apply these, they override defaults on conflict):\n{bullets}\n"
    return f"""‼️ ABSOLUTE RULE #1 — NO CURLY BRACES ANYWHERE IN THE OUTPUT. The template uses {{ and }} purely as placeholder markers — INCLUDING the large decorative braces drawn around the title. Those braces are NOT design; they are markers. The final image must contain ZERO "{{" and ZERO "}}" characters. The title must render as exactly "{title}" — NOT "{{{title}}}", NOT "{{ {title} }}", and with NO braces or brace-shaped ornaments around it. Every field likewise shows only its plain value. Before finishing, scan the whole image and delete any "{{" or "}}" that remain.

You are given TWO uploaded template variants of the SAME layout:
- "template_transparent.png" — the foreground only (gold framed panels, title, etc.) on a TRANSPARENT background.
- "template_grey.png" — the same layout on a flat grey background (use only if a no-art flat look is wanted).

PRIMARY TASK: composite the TRANSPARENT template as the foreground over a NEW generated background. Keep the foreground layout EXACTLY — the gold framed panels, rank circles ①②③, title/subtitle styling, fonts, colors, spacing, dividers, the "By" creator line, the stat line, and the footer. Do NOT move, resize, or restyle any foreground element. Output 1:1 square at the template's resolution.

BACKGROUND — IMPORTANT:
- Generate a NEW abstract background behind the transparent foreground. ABSOLUTELY NO characters, people, faces, figures, or creatures — background only.
- Theme: {bg_theme}.
- Keep it dark and low-contrast behind the panels so all text and the gold frames stay clearly legible. Subtle vignette toward the edges.

TEMPLATE FIDELITY — STRICT (do not lose, move, or alter any template element):
- Preserve ALL original design elements exactly: the three gold-framed rounded panels, the gold rank circles ①②③ (keep the numbers 1 / 2 / 3), the vertical gold divider separating the text from the QR slot in each panel, the diamond/line flourishes around the subtitle and footer, and the footer bar. Same sizes, positions, colors, and fonts.
- Render ONLY the exact strings given below. Do NOT add ANY extra word, label, unit, parenthesis, or duplicated text that is not explicitly provided.
- NO leftover marker/label words anywhere in the image: the words "TITLE", "SUBTITLE", "DECK_NAME", "DECK_CREATOR", "WR", "WINS", "LOSSES", "GAMES", "DATA_SOURCE" must NOT appear. (e.g. the stat line ends "50 games", never "GAMES 50 games"; it shows "33W-17L", never "(WINS 33 - LOSSES 17)".)
- Keep EXACTLY 3 panels in the same order/positions. Do not invent extra rows, badges, icons, or text.

RENDER THESE EXACT FINAL STRINGS into the matching template positions. Replace each whole placeholder (braces included) with the string on the right, typed VERBATIM. Do NOT add the field-name words "WINS", "LOSSES", or "GAMES"; do NOT add parentheses; do NOT reformat numbers. The stat line is one single line exactly as written (e.g. "66% WR · 33W-17L · 50 games" — note: it ends in "50 games", NOT "GAMES 50 games"). Match the template's existing font, weight, case, and gold/white coloring per position.

HEADER:
- Title (the big text inside the decorative braces): {title}
- Subtitle: {subtitle}

PANEL 1 (rank ①):
- Deck name: {d[0]['name']}
- Creator line: By {d[0]['creator']}
- Stat line (keep the % as the emphasized gold figure): {stat[0]}

PANEL 2 (rank ②):
- Deck name: {d[1]['name']}
- Creator line: By {d[1]['creator']}
- Stat line: {stat[1]}

PANEL 3 (rank ③):
- Deck name: {d[2]['name']}
- Creator line: By {d[2]['creator']}
- Stat line: {stat[2]}

FOOTER: Data: {data_source} · Scan to open decklist

QR SLOTS — LEAVE THE "QR1" / "QR2" / "QR3" GOLD TEXT LABELS EXACTLY AS-IS. Do NOT replace them with QR codes, do NOT generate or draw any QR code, and do NOT move, resize, recolor, or remove them. They are positional anchors — the real scannable QR codes are composited in afterwards by a separate post-processing step. (You do not need any QR image.)

FINAL CHECK before output: (1) zero "{{" or "}}" characters anywhere; (2) no marker/label words (TITLE, SUBTITLE, WR, WINS, LOSSES, GAMES, DECK_NAME, DECK_CREATOR, DATA_SOURCE); (3) all 3 panels, rank circles, dividers and flourishes intact; (4) the "QR1"/"QR2"/"QR3" labels still present in the slots. Output: one square PNG identical to the template foreground except for the new background and the exact strings above.{extra_block}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", required=True)
    ap.add_argument("--data-source", default="fabrary.net")
    ap.add_argument("--deck", action="append", required=True,
                    help='"NAME|CREATOR|WR|WINS|LOSSES|GAMES|URL" (x3)')
    ap.add_argument("--bg-theme", default="abstract magical energy, soft bokeh, dark moody fantasy, no characters")
    ap.add_argument("--extra", action="append", default=[],
                    help="User suggestion(s) appended as ADDITIONAL ART DIRECTION. Repeatable.")
    args = ap.parse_args()

    decks = []
    for raw in args.deck:
        parts = [p.strip() for p in raw.split("|")]
        if len(parts) != len(FIELDS):
            sys.exit(f'--deck must be "{"|".join(f.upper() for f in FIELDS)}", got {len(parts)} fields: {raw}')
        decks.append(dict(zip(FIELDS, parts)))
    if len(decks) != 3:
        sys.exit(f"Need exactly 3 --deck entries, got {len(decks)}")

    # Write into a timestamped subfolder so runs don't overwrite each other.
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(args.out, ts)
    os.makedirs(out_dir, exist_ok=True)
    shutil.copy(TEMPLATE_TRANSPARENT, os.path.join(out_dir, "template_transparent.png"))
    shutil.copy(TEMPLATE_GREY, os.path.join(out_dir, "template_grey.png"))
    for i, dk in enumerate(decks, 1):
        make_qr(dk["url"], os.path.join(out_dir, f"qr{i}.png"))

    prompt = build_prompt(args.title, args.subtitle, args.data_source, decks, args.bg_theme, args.extra)
    with open(os.path.join(out_dir, "PROMPT.md"), "w") as f:
        f.write(prompt)

    print(f"\n✅ Generated in {out_dir}:")
    print("   template_transparent.png  template_grey.png  qr1.png  qr2.png  qr3.png  PROMPT.md")
    print(f"\nOpen the folder (copy-paste into the prompt):\n!open {out_dir}\n")
    print("--- PROMPT.md ---\n")
    print(prompt)


if __name__ == "__main__":
    main()
