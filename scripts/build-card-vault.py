#!/usr/bin/env python3
"""build-card-vault.py — generate the card-vault brain's card layer.

One note per card ENTRY (name + pitch variant) in
.claude/identities/card-vault/brain/notes/card-*.md, generated deterministically
from the vendored corpus third_party/flesh-and-blood-cards
(json/english/card.json). NO network, NO fabrary API — local corpus only.

Cards are generated knowledge: NEVER hand-edit or `brain.sh mint` over a card-*
slug. The only hand-curated region is the `## Notes` section at the end of each
note (judge-confirmed rulings/interactions), which this generator PRESERVES
across regenerations. Everything else is overwritten from the corpus.

Slugs: card-<kebab-name>[-red|-yellow|-blue] (pitch 1=red, 2=yellow, 3=blue).
name+pitch is unique corpus-wide (verified), so slugs are stable.

Frontmatter: standard brain keys (tags = the recall surface), then card facts —
name (exact), full-name ("Snatch (red)") + color for pitched cards, stats that
exist for the card's type (hero: health/intelligence; weapon: power; equipment:
defense; ...), classes/talents/types/subtypes, keywords, unique-id, sets.
NO legality data — card legality ALWAYS comes from the live policy page.

Commands:
  build      (default) regenerate all card-* notes + links.json edges + hub note;
             delete card-* notes no longer in the corpus; print a coverage report.
  check      regenerate in memory and diff against disk; exit 1 if stale.

Update path: `git submodule update --remote third_party/flesh-and-blood-cards`,
then `build`, review, commit (knowledge-update convention: direct to main).
"""
import json
import os
import re
import subprocess
import sys
import unicodedata

ROLE = "card-vault"
COLOR = {"1": "red", "2": "yellow", "3": "blue"}
STOPWORDS = {"of", "the", "a", "an", "and", "to", "in", "on", "at", "for", "with", "from"}

CARD_TYPES = ["Action", "Instant", "Attack Reaction", "Defense Reaction", "Hero",
              "Weapon", "Equipment", "Token", "Resource", "Mentor", "Macro",
              "Demi-Hero", "Block", "Companion", "Card", "Event", "Placeholder"]
CLASSES = {"Adjudicator", "Assassin", "Bard", "Brute", "Generic", "Guardian",
           "Illusionist", "Mechanologist", "Merchant", "Necromancer", "Ninja",
           "Pirate", "Ranger", "Runeblade", "Shapeshifter", "Thief", "Warrior",
           "Wizard"}
TALENTS = {"Chaos", "Draconic", "Earth", "Elemental", "Ice", "Light",
           "Lightning", "Mystic", "Royal", "Shadow"}
# corpus typos, normalized on read
TYPO = {"Gaurdian": "Guardian", "Warior": "Warrior", "Warror": "Warrior",
        "Nina": "Ninja"}


def root():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True).strip()
    except Exception:
        return os.getcwd()


ROOT = root()
NOTES = os.path.join(ROOT, ".claude", "identities", ROLE, "brain", "notes")
LINKS = os.path.join(ROOT, ".claude", "identities", ROLE, "brain", "links.json")
CORPUS = os.path.join(ROOT, "third_party", "flesh-and-blood-cards",
                      "json", "english", "card.json")


def kebab(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("’", "").replace("'", "").replace("&", " and ")
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-+", "-", s)


def today():
    return subprocess.check_output(["date", "+%Y-%m-%d"], text=True).strip()


def classify_types(types):
    """Split the corpus `types` array into (talents, classes, card_types,
    subtypes, other) using explicit vocabularies. Young is handled separately."""
    talents, classes, ctypes, other = [], [], [], []
    rest = []
    for t in types:
        t = TYPO.get(t, t)
        if t == "Young":
            continue
        if t in TALENTS:
            talents.append(t)
        elif t in CLASSES:
            classes.append(t)
        elif t in CARD_TYPES:
            ctypes.append(t)
        else:
            rest.append(t)
    # whatever follows the card type in the array is a subtype; anything before
    # it that we don't recognize is an "other" supertype (e.g. Revered, Rosetta)
    if ctypes:
        # position-based: types after the FIRST card-type occurrence are subtypes
        seen_ct = False
        rest2, subs = [], []
        for t in types:
            t2 = TYPO.get(t, t)
            if t2 == "Young":
                continue
            if t2 in CARD_TYPES and not seen_ct:
                seen_ct = True
                continue
            if t2 in TALENTS or t2 in CLASSES or (t2 in CARD_TYPES):
                continue
            (subs if seen_ct else rest2).append(t2)
        return talents, classes, ctypes, subs, rest2
    return talents, classes, ctypes, [], rest


def existing_kw_slugs():
    return {f[:-3] for f in os.listdir(NOTES)
            if f.startswith("kw-") and f.endswith(".md")}


def resolve_keyword(kw, kw_slugs):
    """Map a corpus keyword string to an existing kw-* note slug, or None.
    Handles parameterized forms: '<Hero> Specialization', '<Talent> Fusion',
    'Essence of X', 'Channel X', 'X Bond', crowd labels, 'Pairs'."""
    k = kebab(kw)
    if k in ("ice", "earth", "lightning", "and-lightning"):
        return None  # bare talent fragments in the corpus data, not keywords
    cands = ["kw-" + k, "kw-" + re.sub(r"-(x|\d+)$", "", k)]
    if k.endswith("-specialization"):
        cands.append("kw-specialization")
    if "fusion" in k.split("-"):
        cands.append("kw-fusion")
    if k.startswith("essence-of-"):
        cands.append("kw-essence")
    if k.startswith("channel-"):
        cands.append("kw-channel")
    if k.endswith("-bond"):
        cands.append("kw-bond")
    if k in ("the-crowd-boos", "the-crowd-cheers"):
        cands.append("kw-the-crowd-cheers-the-crowd-boos")
    if k == "pairs":
        cands.append("kw-pairs-with-object")
    if k == "lightning-flow":
        cands.append("kw-token-lightning-flow")
    for cand in cands:
        if cand in kw_slugs:
            return cand
    return None


def preserved_notes_section(path):
    """Return existing '## Notes' section content (without heading), or ''."""
    if not os.path.isfile(path):
        return ""
    text = open(path, encoding="utf-8").read()
    m = re.search(r"\n## Notes\n(.*)\Z", text, re.S)
    return m.group(1).strip() if m else ""


def existing_created(path):
    if not os.path.isfile(path):
        return None
    m = re.search(r"^created: (\S+)$", open(path, encoding="utf-8").read(), re.M)
    return m.group(1) if m else None


def fm_list(vals):
    return "[" + ", ".join(str(v) for v in vals) + "]"


def build_note(c, slug, variants, lineage, kw_slugs, date):
    name = c["name"]
    pitch = c.get("pitch", "")
    color = COLOR.get(pitch)
    full_name = "%s (%s)" % (name, color) if color else name
    talents, classes, ctypes, subtypes, other = classify_types(c["types"])
    young = "Young" in c["types"]
    is_hero = "Hero" in c["types"]

    keywords = list(dict.fromkeys(c.get("card_keywords", []) + c.get("granted_keywords", [])))
    kw_links = [s for s in (resolve_keyword(k, kw_slugs) for k in keywords) if s]
    if "Token" in c["types"]:
        tok = "kw-token-" + kebab(name)
        if tok in kw_slugs and tok not in kw_links:
            kw_links.append(tok)

    # ---- tags: the recall surface
    tags = ["card", kebab(name)]
    tags += [w for w in kebab(name).split("-") if w not in STOPWORDS and len(w) > 1]
    tags += [kebab(x) for x in classes + talents + ctypes + subtypes + other]
    if is_hero:
        tags.append("young" if young else "adult")
    tags += [kebab(k) for k in keywords]
    if pitch:
        tags.append("pitch-" + pitch)
    cost = c.get("cost", "")
    if cost and cost.isdigit():
        tags.append("cost-" + cost)
    tags = list(dict.fromkeys(tags))

    # ---- frontmatter
    fm = ["---",
          "tags: " + fm_list(tags),
          "paths: []",
          "strength: 1",
          'source: "third_party/flesh-and-blood-cards json/english/card.json (uid %s) · https://cardvault.fabtcg.com/"' % c["unique_id"],
          "graduated: false",
          "created: %s" % date,
          'name: "%s"' % name.replace('"', "'")]
    if color:
        fm.append('full-name: "%s"' % full_name.replace('"', "'"))
        fm.append("color: %s" % color)
        fm.append("pitch: %s" % pitch)
    if cost != "":
        fm.append("cost: %s" % cost)
    for key, val in (("power", c.get("power", "")), ("defense", c.get("defense", "")),
                     ("health", c.get("health", "")), ("intelligence", c.get("intelligence", ""))):
        if val != "":
            fm.append("%s: %s" % (key, val))
    if is_hero:
        fm.append("hero-version: %s" % ("young" if young else "adult"))
    if classes:
        fm.append("classes: " + fm_list(classes))
    if talents:
        fm.append("talents: " + fm_list(talents))
    fm.append("types: " + fm_list(ctypes if ctypes else c["types"]))
    if subtypes:
        fm.append("subtypes: " + fm_list(subtypes))
    if other:
        fm.append("other-types: " + fm_list(other))
    if keywords:
        fm.append("keywords: " + fm_list(keywords))
    if c.get("traits"):
        fm.append("traits: " + fm_list(c["traits"]))
    fm.append("unique-id: %s" % c["unique_id"])
    sets = list(dict.fromkeys(p.get("set_id", "") for p in c.get("printings", []) if p.get("set_id")))
    fm.append("sets: " + fm_list(sets))
    fm.append("---")

    # ---- body
    stats = []
    if cost != "":
        stats.append("cost %s" % cost)
    if c.get("power", "") != "":
        stats.append("%s power" % c["power"])
    if c.get("defense", "") != "":
        stats.append("%s defense" % c["defense"])
    if c.get("health", "") != "":
        stats.append("%s health" % c["health"])
    if c.get("intelligence", "") != "":
        stats.append("%s int" % c["intelligence"])
    header = "**%s** — %s%s" % (full_name, c["type_text"],
                                (" · " + " · ".join(stats)) if stats else "")
    body = [header, ""]
    text = (c.get("functional_text_plain") or "").strip()
    body.append('"%s"' % text if text else "(no text)")
    body.append("")
    if kw_links:
        body.append("Keywords: " + " · ".join("[[%s]]" % s for s in kw_links))
    if variants:
        body.append("Variants: " + " · ".join("[[%s]]" % v for v in variants))
    if lineage:
        label = "Adult version" if young else "Young version"
        body.append("%s: %s" % (label, " · ".join("[[%s]]" % l for l in lineage)))
    body.append('Rulings: search "%s" at https://cardvault.fabtcg.com/' % name)
    body.append("")
    body.append("## Notes")
    kept = preserved_notes_section(os.path.join(NOTES, slug + ".md"))
    body.append(kept if kept else "")
    out = "\n".join(fm) + "\n\n" + "\n".join(body)
    return out.rstrip("\n") + "\n", kw_links + variants + lineage


HUB = """---
tags: [card, index, hub, map]
paths: []
strength: 1
source: "third_party/flesh-and-blood-cards json/english/card.json · scripts/build-card-vault.py"
graduated: false
created: %s
---

# Card vault map — how to find cards in this brain

Every card entry in the game is a `card-*` note here (one per name+pitch;
pitched slugs end in -red/-yellow/-blue). They are GENERATED from the vendored
corpus by `scripts/build-card-vault.py` — never hand-edit (only the `## Notes`
section of a card survives regeneration; put judge-confirmed rulings there).

Finding cards: recall by tags — name words, class, talent, type, subtype,
keyword, pitch-N, cost-N (e.g. `brain.sh recall card-vault --keywords
"ninja,attack,go-again"`). For text/phrase search over the corpus use
`fab-cli fabrary cards local <terms...>` (offline). Exact text authority:
the corpus JSON + official rulings at https://cardvault.fabtcg.com/.

Keywords: every card links to its [[kw-*]] notes (shared corpus, physical here,
symlinked into judge/player — see .claude/identities/KEYWORD-SYNC.md).
Heroes cross-link young/adult versions. Card legality: NEVER from notes — live
policy page only (https://fabtcg.com/rules-and-policy-center/card-legality-policy/).
"""


def load_corpus():
    cards = json.load(open(CORPUS, encoding="utf-8"))
    by_slug = {}
    by_name = {}
    for c in cards:
        slug = "card-" + kebab(c["name"])
        if c.get("pitch") in COLOR:
            slug += "-" + COLOR[c["pitch"]]
        if slug in by_slug:
            print("FATAL: slug collision %s (%r)" % (slug, c["name"]))
            sys.exit(1)
        by_slug[slug] = c
        by_name.setdefault(c["name"], []).append(slug)
    return by_slug, by_name


def hero_lineage(by_slug):
    """young-slug <-> [adult slugs] by class match + name-prefix extension."""
    heroes = {s: c for s, c in by_slug.items() if "Hero" in c["types"]}
    young = {s: c for s, c in heroes.items() if "Young" in c["types"]}
    adult = {s: c for s, c in heroes.items() if "Young" not in c["types"]}
    out = {}
    for ys, yc in young.items():
        ybase = kebab(yc["name"])
        ycls = set(yc["types"]) & CLASSES
        for as_, ac in adult.items():
            if kebab(ac["name"]).startswith(ybase + "-") and (set(ac["types"]) & CLASSES) == ycls:
                out.setdefault(ys, []).append(as_)
                out.setdefault(as_, []).append(ys)
    return out


def generate_all():
    by_slug, by_name = load_corpus()
    lineage = hero_lineage(by_slug)
    kw_slugs = existing_kw_slugs()
    date = today()
    notes, all_links = {}, {}
    unresolved = set()
    for slug in sorted(by_slug):
        c = by_slug[slug]
        variants = [s for s in by_name[c["name"]] if s != slug]
        created = existing_created(os.path.join(NOTES, slug + ".md")) or date
        text, targets = build_note(c, slug, variants, lineage.get(slug, []), kw_slugs, created)
        notes[slug] = text
        all_links[slug] = targets
        for k in c.get("card_keywords", []) + c.get("granted_keywords", []):
            if not resolve_keyword(k, kw_slugs):
                unresolved.add(k)
    hub_created = existing_created(os.path.join(NOTES, "card-vault-map.md")) or date
    notes["card-vault-map"] = HUB % hub_created
    return notes, all_links, unresolved


def write_links(all_links):
    links = {}
    if os.path.isfile(LINKS):
        links = json.load(open(LINKS, encoding="utf-8"))
    added = 0
    for slug, targets in all_links.items():
        for t in targets:
            key = "%s->%s" % (slug, t)
            if key not in links:
                links[key] = {"weight": 0.5, "fires": 0, "last": None}
                added += 1
    with open(LINKS, "w", encoding="utf-8") as f:
        json.dump(links, f, indent=1, sort_keys=True)
        f.write("\n")
    return added


def cmd_build():
    notes, all_links, unresolved = generate_all()
    written = unchanged = 0
    for slug, text in notes.items():
        p = os.path.join(NOTES, slug + ".md")
        if os.path.isfile(p) and open(p, encoding="utf-8").read() == text:
            unchanged += 1
            continue
        open(p, "w", encoding="utf-8").write(text)
        written += 1
    # remove card notes that left the corpus
    removed = 0
    for f in os.listdir(NOTES):
        if f.startswith("card-") and f.endswith(".md") and f[:-3] not in notes:
            os.remove(os.path.join(NOTES, f))
            removed += 1
    edges = write_links(all_links)
    print("card-vault: %d notes written, %d unchanged, %d removed, %d link edge(s) added"
          % (written, unchanged, removed, edges))
    if unresolved:
        print("keywords with no kw-* note (cards link nothing for these): %s"
              % ", ".join(sorted(unresolved)))
    return 0


def cmd_check():
    notes, _, unresolved = generate_all()
    stale = []
    for slug, text in notes.items():
        p = os.path.join(NOTES, slug + ".md")
        if not os.path.isfile(p) or open(p, encoding="utf-8").read() != text:
            stale.append(slug)
    extra = [f[:-3] for f in os.listdir(NOTES)
             if f.startswith("card-") and f.endswith(".md") and f[:-3] not in notes]
    if stale or extra:
        for s in stale[:20]:
            print("STALE %s" % s)
        if len(stale) > 20:
            print("... and %d more" % (len(stale) - 20))
        for e in extra:
            print("EXTRA %s (not in corpus)" % e)
        print("run: python3 scripts/build-card-vault.py build")
        return 1
    print("OK: %d card notes match the corpus (+ hub)" % (len(notes) - 1))
    if unresolved:
        print("note: unresolved keywords (no kw-* note): %s" % ", ".join(sorted(unresolved)))
    return 0


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    fn = {"build": cmd_build, "check": cmd_check}.get(cmd)
    if not fn:
        print(__doc__)
        return 2
    return fn()


if __name__ == "__main__":
    sys.exit(main())
