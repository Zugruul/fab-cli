---
name: generate-3-top-decks-image
description: Generate all files for an Instagram "Top 3 decks" poster for a Flesh & Blood hero — scannable QR codes, the reusable branded template, and a ready-to-paste ChatGPT image-edit prompt (character-free background). Use when the user wants a social/Instagram post of the best 3 decks for a hero/format.
---

# generate-3-top-decks-image

Produces everything needed to make a 1080×1080 Instagram "Top 3 decks" poster. The
generative step (background art + filling the template) is done by the user inside
**ChatGPT (their subscription)** — this skill prepares the deterministic, must-be-correct
parts: scannable QR codes, the branded template, and a precise fill prompt.

## Pipeline (4 steps)
1. **prep** (this skill): compute the top-3 decks → generate QR codes + copy templates + write the ChatGPT prompt into a timestamped `/tmp` dir.
2. **generate** (user, in ChatGPT): upload a template (`template_transparent.png`, or `template_grey.png` for flat), paste `PROMPT.md`, download the result. **QRs are NOT uploaded** — ChatGPT keeps the gold "QR1/QR2/QR3" text anchors.
3. **post-process** (this skill): composite the real QR codes over the anchors with `postprocess.py` — robust panel detection, guaranteed scannable. This is why ChatGPT placing QRs is no longer needed (it couldn't do it reliably).
4. **verify**: scan each QR in the final image before posting.

### Post-process command
```bash
.venv-img/bin/python .claude/skills/generate-3-top-decks-image/postprocess.py \
  --image <chatgpt_output.png> --dir <timestamped_out_dir> --out <out_dir>/final.png
```
It detects the 3 gold-framed panels in the generated image (resolution-independent) and drops each QR on a white rounded card in the right slot, covering the QRn label. Tuning flags if alignment is ever off: `--xc` (slot x, default 0.853), `--scale` (QR size vs panel height, 0.78), `--card` (white card multiple, 1.14).

## How to run

### 1. Get the top 3 decks
If the user already gave the hero/format (e.g. "top 3 Prism Silver Age"), compute the lists with the project tooling:
```bash
npx tsx scripts/best-decks-by-hero.ts --format <fmt> --top 3 --out json   # then filter to the one hero
```
or for a single hero use `fab-cli fabrary top --hero <slug> --format <fmt> --sort winrate --min-games 30`.
You need, per deck: **name**, **creator/author**, **WR** (number only), **wins**, **losses**, **games**, and the **deck URL** (`https://fabrary.net/decks/<deckId>`).
The creator/author is NOT in `best-decks-by-hero.ts` output — fetch it from Algolia per deckId:
```ts
import { getDeckById } from "./src/algolia.ts";
const d = await getDeckById(deckId); // d.author, d.name
```

### 2. Generate the files
Use the project's image venv (Pillow + qrcode live in `.venv-img`). Pick a hero-appropriate
**character-free** background theme for `--bg-theme` (the user dislikes AI characters — backgrounds must have NO people/faces/figures).

Each `--deck` is `"NAME|CREATOR|WR|WINS|LOSSES|GAMES|URL"` (WR is the number only, no `%`):
```bash
.venv-img/bin/python .claude/skills/generate-3-top-decks-image/generate.py \
  --out /tmp/<hero>-post \
  --title "<HERO>" \
  --subtitle "BEST <FORMAT> DECKS · TOP 3 BY WIN RATE (≥30 GAMES)" \
  --data-source "fabrary.net" \
  --deck "<NAME1>|<CREATOR1>|<WR1>|<WINS1>|<LOSSES1>|<GAMES1>|<URL1>" \
  --deck "<NAME2>|<CREATOR2>|<WR2>|<WINS2>|<LOSSES2>|<GAMES2>|<URL2>" \
  --deck "<NAME3>|<CREATOR3>|<WR3>|<WINS3>|<LOSSES3>|<GAMES3>|<URL3>" \
  --bg-theme "<abstract, no-characters theme matching the hero's element/colors>"
```
If `.venv-img` is missing, create it: `python3 -m venv .venv-img && .venv-img/bin/pip install -q Pillow 'qrcode[pil]'`.

Files are written to a **timestamped subfolder** of `--out`, e.g. `/tmp/<hero>-post/20260617-201530/`, so repeated runs never overwrite each other.

Pass any known user suggestions at generation time with `--extra` (repeatable) — each becomes a bullet under an "ADDITIONAL ART DIRECTION (user suggestions)" section that overrides defaults:
```bash
  --extra "use https://.../BRAVO.jpg as background inspiration, exclude the character" \
  --extra "warmer gold tone on the title"
```

### 3. Hand off to the user
Do NOT re-paste the full prompt in chat — the user opens the folder and drags `PROMPT.md` + `template_transparent.png` into ChatGPT themselves. Just output:
- the copy-paste `!open <out_dir>` line, and
- the top-3 summary (name · creator · WR · record · games).
When they bring back the generated PNG, run `postprocess.py` (pipeline step 3) to composite the QRs, then deliver `final.png`.

### 4. Apply user suggestions AFTER the run (important)
When the user gives feedback/suggestions about the prompt after it's generated (e.g. "make the background darker", "use this reference image", "different subtitle wording"), **update the already-generated `PROMPT.md` in its timestamped folder in place** (use the Edit tool on that file) — add/extend the "ADDITIONAL ART DIRECTION (user suggestions)" section or edit the relevant line — then re-print the updated prompt. Do NOT silently re-run the script for small tweaks (that would create a new timestamped folder and new QR files); only re-run when deck data itself changes. Keep iterating on the same `PROMPT.md` until the user is happy.

## Notes / learnings
- **Templates** live in `assets/` as two variants of the same layout:
  - `template_transparent.png` (1024×1024 RGBA) — foreground only, transparent bg. **Primary**: composite over a generated character-free background.
  - `template_grey.png` (1254×1254 RGB) — flat grey bg. No-AI fallback.
  Tokens: `{TITLE} {SUBTITLE}`, per deck `{DECK_NAME_n} {DECK_CREATOR_n} {WR_n} {WINS_n} {LOSSES_n} {GAMES_n}`, and `{DATA_SOURCE}`. The literals around the stat tokens ("By ", "% WR", "·", "W-", "L", "games", "Data:", "Scan to open decklist") are baked in — only the `{TOKENS}` are replaced. Note: stats are W-L only (no draw field).
  - **QR slots are TEXT labels** "QR1"/"QR2"/"QR3" (gold). The prompt tells ChatGPT to KEEP them as anchors; `postprocess.py` composites the real `qrN.png` over them afterward.
- **Background must be character-free.** The prompt already forbids people/faces/figures and asks for a dark, low-contrast abstract background so text stays legible.
- **QR codes**: image models can't place scannable QRs (confirmed in testing). So the prompt tells ChatGPT to KEEP the "QR1/2/3" gold text anchors, and `postprocess.py` composites the real QR PNGs over them locally — deterministic and always scannable. Never ask ChatGPT to draw/place the QRs.
- **win% = wins/(wins+losses)**; draws shown but excluded from %. Default deck floor is ≥30 games (see `scripts/best-decks-by-hero.ts`).
- "Sage" = Silver Age (`sa`).
