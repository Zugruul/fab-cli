#!/usr/bin/env python3
"""keyword-sync.py — keep keyword knowledge identical across identity brains.

The kw-*.md notes and the generated keywords-index.md must be byte-identical
in every identity brain that holds them (judge, player, card-vault). The judge
brain is CANONICAL: keyword knowledge only changes there (confirmed against the
official CR), then propagates outward. See .claude/identities/KEYWORD-SYNC.md.

Commands:
  check      (default) validate template on canon, regen-compare the index,
             hash-compare every brain against canon, attribute drift via the
             committed manifest. Exit 1 on any problem.
  sync       propagate canon -> all other brains (notes + index + link edges),
             regenerate the index, rewrite the manifest.
  index      regenerate keywords-index.md from canon kw notes (all brains).
  baseline   rewrite the manifest from canon's current state.

Stdlib only. Frontmatter/link handling mirrors spec-workflow's brain.py.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

ROLES = ["judge", "player", "card-vault"]
CANON = "judge"
INDEX = "keywords-index"
MANIFEST = "keywords.manifest.sha256"
DEFAULT_WEIGHT = 0.5

# CR chapter 8 categories, in chapter order. A note's category is its third tag.
CATEGORIES = [
    ("type", "8.1"), ("subtype", "8.2"), ("ability", "8.3"),
    ("label", "8.4"), ("effect", "8.5"), ("token", "8.6"),
]
CAT_NAMES = [c for c, _ in CATEGORIES]

SOURCE_RE = re.compile(
    r'^"https://rules\.fabtcg\.com/txt/latest/en-fab-cr\.txt \(CR ([0-9][0-9a-z.]*)\)'
    r' — vendored: third_party/fab-rules/en-fab-cr\.txt"$')
HEADER_RE = re.compile(
    r'^\*\*(.+)\*\* — (%s) keyword \(CR ([0-9][0-9a-z.]*)\)\.$' % "|".join(CAT_NAMES))
TRAILER_RE = re.compile(
    r'^Index: \[\[keywords-index\]\]\. When ruling, cite CR ([0-9][0-9a-z.]*);'
    r' verify against the vendored artifact\.$')
WIKILINK = re.compile(r"\[\[([^\]]+)\]\]")
FM_KEYS = ["tags", "paths", "strength", "source", "graduated", "created"]

INDEX_PREAMBLE = """# Keywords index — ALL Flesh & Blood keywords (CR chapter 8)

HARD RULE: this index must reference EVERY keyword; each keyword is its own note. When the CR version bumps or a set adds/changes keywords, RE-INDEX: refresh the vendored CR (`fab-cli rules update-docs`), diff chapter 8, mint/update per-keyword notes in the JUDGE brain, then run `scripts/keyword-sync.py sync` — never edit this file or any kw-* note by hand outside the judge brain. Link ruling and interaction knowledge to the relevant [[kw-*]] notes. Contentious-keyword rulings: [[keyword-interaction-rulings]], [[effect-keyword-rulings]]. Document navigation: [[doc-map-cr]]. Sync process: .claude/identities/KEYWORD-SYNC.md."""


def root():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True).strip()
    except Exception:
        return os.getcwd()


ROOT = root()
IDENT = os.path.join(ROOT, ".claude", "identities")


def notes_dir(role):
    return os.path.join(IDENT, role, "brain", "notes")


def brain_dir(role):
    return os.path.join(IDENT, role, "brain")


def existing_roles():
    return [r for r in ROLES if os.path.isdir(notes_dir(r))]


def kw_files(role):
    d = notes_dir(role)
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d)
                  if f.startswith("kw-") and f.endswith(".md"))


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def parse_note(text):
    """(ordered fm key list, fm dict, body). Values kept as raw strings."""
    if not text.startswith("---"):
        return [], {}, text
    lines = text.split("\n")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return [], {}, text
    keys, fm = [], {}
    for line in lines[1:end]:
        if not line.strip() or ":" not in line:
            continue
        k, _, v = line.partition(":")
        keys.append(k.strip())
        fm[k.strip()] = v.strip()
    body = "\n".join(lines[end + 1:]).lstrip("\n")
    return keys, fm, body


def body_lines(body):
    return [l for l in body.split("\n") if l.strip()]


# ------------------------------------------------------------ template check
def validate_note(path):
    """Return a list of template violations for one canon kw note."""
    errs = []
    fn = os.path.basename(path)
    keys, fm, body = parse_note(open(path, encoding="utf-8").read())
    if keys != FM_KEYS:
        errs.append("frontmatter keys %s != %s" % (keys, FM_KEYS))
        return errs
    tags = [t.strip() for t in fm["tags"].strip("[]").split(",")]
    if len(tags) != 3 or tags[0] != "cr" or tags[1] != "keyword" or tags[2] not in CAT_NAMES:
        errs.append("tags must be [cr, keyword, <%s>], got %s" % ("|".join(CAT_NAMES), tags))
        return errs
    m_src = SOURCE_RE.match(fm["source"])
    if not m_src:
        errs.append("source line does not match template: %s" % fm["source"])
    lines = body_lines(body)
    if not lines:
        return errs + ["empty body"]
    m_head = HEADER_RE.match(lines[0])
    if not m_head:
        errs.append("header line does not match template: %s" % lines[0])
    m_tail = TRAILER_RE.match(lines[-1])
    if not m_tail:
        errs.append("trailer line does not match template: %s" % lines[-1])
    if m_head and tags[2] != m_head.group(2):
        errs.append("category tag %r != header category %r" % (tags[2], m_head.group(2)))
    secs = {g.group(i) for g, i in
            ((m_src, 1), (m_head, 3), (m_tail, 1)) if g}
    if len(secs) > 1:
        errs.append("CR section disagrees across source/header/trailer: %s" % sorted(secs))
    chap = tags[2]
    expected_prefix = dict(CATEGORIES)[chap]
    if m_head and not m_head.group(3).startswith(expected_prefix):
        errs.append("CR section %s not under chapter %s for category %s"
                    % (m_head.group(3), expected_prefix, chap))
    return ["%s: %s" % (fn, e) for e in errs]


def validate_canon():
    errs = []
    for f in kw_files(CANON):
        errs += validate_note(os.path.join(notes_dir(CANON), f))
    return errs


# ------------------------------------------------------------ index generation
def sec_key(sec):
    parts = re.split(r"\.", sec)
    out = []
    for p in parts:
        m = re.match(r"(\d+)([a-z]?)", p)
        out.append((int(m.group(1)), m.group(2)) if m else (0, p))
    return out


def generate_index():
    """Deterministic keywords-index.md content from canon kw notes."""
    by_cat = {c: [] for c in CAT_NAMES}
    for f in kw_files(CANON):
        _, fm, body = parse_note(open(os.path.join(notes_dir(CANON), f), encoding="utf-8").read())
        tags = [t.strip() for t in fm["tags"].strip("[]").split(",")]
        cat = tags[2]
        m = HEADER_RE.match(body_lines(body)[0])
        sec = m.group(3) if m else "9999"
        by_cat[cat].append((sec_key(sec), f[:-3]))

    # preserve strength/created from the canon's existing index if present
    strength, created = "1", None
    ipath = os.path.join(notes_dir(CANON), INDEX + ".md")
    if os.path.isfile(ipath):
        _, ifm, _ = parse_note(open(ipath, encoding="utf-8").read())
        strength = ifm.get("strength", "1")
        created = ifm.get("created")
    if not created:
        created = subprocess.check_output(["date", "+%Y-%m-%d"], text=True).strip()

    out = ["---",
           "tags: [cr, keyword, index, hub]",
           "paths: []",
           "strength: %s" % strength,
           'source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR 8) — vendored: third_party/fab-rules/en-fab-cr.txt"',
           "graduated: false",
           "created: %s" % created,
           "---", "", INDEX_PREAMBLE, ""]
    for cat, chap in CATEGORIES:
        slugs = [s for _, s in sorted(by_cat[cat])]
        out.append("## %s keywords (CR %s) (%d)" % (cat.capitalize(), chap, len(slugs)))
        out.append("")
        out.append(" · ".join("[[%s]]" % s for s in slugs))
        out.append("")
    return "\n".join(out).rstrip("\n") + "\n"


# ------------------------------------------------------------ links.json edges
def add_link_edges(role, slugs):
    """Mirror brain.py mint: add missing wikilink edges for these notes,
    only toward targets that exist in this brain. Never touch existing."""
    lpath = os.path.join(brain_dir(role), "links.json")
    links = {}
    if os.path.isfile(lpath):
        links = json.load(open(lpath, encoding="utf-8"))
    have = {f[:-3] for f in os.listdir(notes_dir(role)) if f.endswith(".md")}
    added = 0
    for slug in slugs:
        _, _, body = parse_note(open(os.path.join(notes_dir(role), slug + ".md"), encoding="utf-8").read())
        for target in WIKILINK.findall(body):
            target = target.strip()
            key = "%s->%s" % (slug, target)
            if target in have and key not in links:
                links[key] = {"weight": DEFAULT_WEIGHT, "fires": 0, "last": None}
                added += 1
    with open(lpath, "w", encoding="utf-8") as f:
        json.dump(links, f, indent=1, sort_keys=True)
        f.write("\n")
    return added


# ------------------------------------------------------------------- manifest
def manifest_path():
    return os.path.join(IDENT, MANIFEST)


def read_manifest():
    m = {}
    if os.path.isfile(manifest_path()):
        for line in open(manifest_path(), encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            h, fn = line.split(None, 1)
            m[fn.strip()] = h
    return m


def canon_hashes():
    files = kw_files(CANON) + [INDEX + ".md"]
    return {f: sha256(os.path.join(notes_dir(CANON), f))
            for f in files if os.path.isfile(os.path.join(notes_dir(CANON), f))}


def write_manifest():
    hashes = canon_hashes()
    with open(manifest_path(), "w", encoding="utf-8") as f:
        f.write("# canonical keyword-note hashes (source: %s brain). Regenerate: scripts/keyword-sync.py baseline\n" % CANON)
        for fn in sorted(hashes):
            f.write("%s  %s\n" % (hashes[fn], fn))
    return hashes


# ------------------------------------------------------------------- commands
def cmd_check():
    problems = []
    infos = []

    if not os.path.isdir(notes_dir(CANON)):
        print("FATAL: canonical brain %r not found" % CANON)
        return 1

    # 1. canon template validation
    terrs = validate_canon()
    problems += ["TEMPLATE %s" % e for e in terrs]

    # 2. index freshness (regenerate and compare)
    ipath = os.path.join(notes_dir(CANON), INDEX + ".md")
    if not os.path.isfile(ipath):
        problems.append("INDEX %s missing in canon" % INDEX)
    elif open(ipath, encoding="utf-8").read() != generate_index():
        problems.append("INDEX %s is stale in canon (regenerate: keyword-sync.py index)" % INDEX)

    # 3. cross-brain comparison
    canon = canon_hashes()
    roles = existing_roles()
    for r in ROLES:
        if r not in roles:
            infos.append("note: brain %r does not exist yet — skipped" % r)
    for r in roles:
        if r == CANON:
            continue
        theirs = {f: sha256(os.path.join(notes_dir(r), f))
                  for f in kw_files(r) + [INDEX + ".md"]
                  if os.path.isfile(os.path.join(notes_dir(r), f))}
        for f in sorted(set(canon) - set(theirs)):
            problems.append("MISSING %s lacks %s" % (r, f))
        for f in sorted(set(theirs) - set(canon)):
            problems.append("EXTRA %s has %s (not in canon)" % (r, f))
        for f in sorted(set(canon) & set(theirs)):
            if canon[f] != theirs[f]:
                problems.append("DIVERGENT %s/%s != canon" % (r, f))

    # 4. drift attribution via manifest
    manifest = read_manifest()
    if not manifest:
        infos.append("note: no manifest yet — run `keyword-sync.py baseline` after the first sync")
    else:
        canon_changed = sorted(f for f in canon if manifest.get(f) not in (None, canon[f]))
        canon_new = sorted(f for f in canon if f not in manifest)
        canon_gone = sorted(f for f in manifest if f not in canon)
        if canon_changed:
            infos.append("canon changed since baseline (judge updated — verify against CR, then `sync`): %s"
                         % ", ".join(canon_changed))
        if canon_new:
            infos.append("new in canon since baseline: %s" % ", ".join(canon_new))
        if canon_gone:
            infos.append("removed from canon since baseline: %s" % ", ".join(canon_gone))

    for i in infos:
        print(i)
    if problems:
        print("\n%d problem(s):" % len(problems))
        for p in problems:
            print("  " + p)
        print("\nResolution protocol: .claude/identities/KEYWORD-SYNC.md")
        print("  - non-canon drift  -> inspect (`git diff`); if it holds NEW knowledge, route it")
        print("    through the judge (confirm vs CR, mint in judge), then `keyword-sync.py sync`.")
        print("  - canon changed    -> verify vs vendored CR, then `keyword-sync.py sync`.")
        print("  - template errors  -> fix the judge note to the template, then `sync`.")
        return 1
    print("OK: keyword notes identical across %s (%d notes + index)"
          % ("/".join(roles), len(kw_files(CANON))))
    return 0


def cmd_index():
    content = generate_index()
    for r in existing_roles():
        with open(os.path.join(notes_dir(r), INDEX + ".md"), "w", encoding="utf-8") as f:
            f.write(content)
        add_link_edges(r, [INDEX])
        print("wrote %s/%s.md" % (r, INDEX))
    return 0


def cmd_sync():
    terrs = validate_canon()
    if terrs:
        print("REFUSING to sync: canon violates the template:")
        for e in terrs:
            print("  " + e)
        return 1
    # regenerate index in canon first so it propagates like any other note
    content = generate_index()
    with open(os.path.join(notes_dir(CANON), INDEX + ".md"), "w", encoding="utf-8") as f:
        f.write(content)
    canon_files = kw_files(CANON) + [INDEX + ".md"]
    slugs = [f[:-3] for f in canon_files]
    add_link_edges(CANON, slugs)

    for r in existing_roles():
        if r == CANON:
            continue
        copied = removed = 0
        for f in canon_files:
            src = os.path.join(notes_dir(CANON), f)
            dst = os.path.join(notes_dir(r), f)
            data = open(src, "rb").read()
            if not os.path.isfile(dst) or open(dst, "rb").read() != data:
                open(dst, "wb").write(data)
                copied += 1
        for f in kw_files(r):
            if f not in canon_files:
                os.remove(os.path.join(notes_dir(r), f))
                removed += 1
        edges = add_link_edges(r, slugs)
        print("synced %s: %d file(s) updated, %d removed, %d link edge(s) added"
              % (r, copied, removed, edges))
    write_manifest()
    print("manifest rewritten: %s" % os.path.relpath(manifest_path(), ROOT))
    return cmd_check()


def cmd_baseline():
    write_manifest()
    print("manifest written from canon (%d entries)" % len(read_manifest()))
    return 0


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    fn = {"check": cmd_check, "sync": cmd_sync,
          "index": cmd_index, "baseline": cmd_baseline}.get(cmd)
    if not fn:
        print(__doc__)
        return 2
    return fn()


if __name__ == "__main__":
    sys.exit(main())
