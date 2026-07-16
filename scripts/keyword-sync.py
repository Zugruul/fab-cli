#!/usr/bin/env python3
"""keyword-sync.py — one physical keyword corpus, symlinked into every brain.

The kw-*.md notes and the generated keywords-index.md live PHYSICALLY in the
card-vault brain (.claude/identities/card-vault/brain/notes/). Every other
brain that holds them (judge, player) has RELATIVE SYMLINKS to those files, so
all brains read literally the same bytes — desync between brains is
structurally impossible.

EDITORIAL AUTHORITY is unchanged: only the JUDGE decides keyword content
(confirmed against the official CR). WARNING: writing "through" a symlink
(e.g. `brain.sh mint` over a kw slug in any brain) rewrites the single
physical file — that is why mint/hand-edits on kw-* outside the judge's
editorial process are forbidden. The committed manifest exists to catch
unauthorized content changes. See .claude/identities/KEYWORD-SYNC.md.

Commands:
  check      (default) validate the template on the physical corpus, verify
             the index is fresh, verify every mirror entry is a correct
             symlink, attribute content changes via the manifest. Exit 1 on
             any problem.
  sync       regenerate the index, create/fix mirror symlinks in all brains,
             refresh links.json edges, rewrite the manifest.
  index      regenerate keywords-index.md from the kw notes.
  baseline   rewrite the manifest from the corpus' current state.

Stdlib only. Frontmatter/link handling mirrors spec-workflow's brain.py.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

from entity_index import is_fresh as entity_index_is_fresh
from entity_index import regenerate as regenerate_entity_index

HOME = "card-vault"           # physical home of the corpus
MIRRORS = ["judge", "player"]  # brains that hold relative symlinks to it
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
FM_KEYS = ["tags", "paths", "strength", "source", "graduated", "created", "entities"]

INDEX_PREAMBLE = """# Keywords index — ALL Flesh & Blood keywords (CR chapter 8)

HARD RULE: this index must reference EVERY keyword; each keyword is its own note. When the CR version bumps or a set adds/changes keywords, RE-INDEX: refresh the vendored CR (`fab-cli rules update-docs`), diff chapter 8, update the per-keyword notes under the JUDGE's editorial authority, then run `scripts/keyword-sync.py sync` — this file is generated; never edit it by hand. The corpus lives physically in the card-vault brain and is symlinked into the other brains. Link ruling and interaction knowledge to the relevant [[kw-*]] notes. Contentious-keyword rulings: [[keyword-interaction-rulings]], [[effect-keyword-rulings]]. Document navigation: [[doc-map-cr]]. Sync process: .claude/identities/KEYWORD-SYNC.md."""


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


def rel_target(fn):
    """Expected symlink target inside a mirror's notes dir."""
    return os.path.join("..", "..", "..", HOME, "brain", "notes", fn)


def corpus_files():
    d = notes_dir(HOME)
    if not os.path.isdir(d):
        return []
    files = sorted(f for f in os.listdir(d)
                   if f.startswith("kw-") and f.endswith(".md"))
    if os.path.isfile(os.path.join(d, INDEX + ".md")):
        files.append(INDEX + ".md")
    return files


def mirror_kw_entries(role):
    d = notes_dir(role)
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d)
                  if (f.startswith("kw-") or f == INDEX + ".md") and f.endswith(".md"))


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
    """Return a list of template violations for one physical kw note."""
    errs = []
    fn = os.path.basename(path)
    keys, fm, body = parse_note(open(path, encoding="utf-8").read())
    if keys != FM_KEYS:
        errs.append("frontmatter keys %s != %s" % (keys, FM_KEYS))
        return ["%s: %s" % (fn, e) for e in errs]
    tags = [t.strip() for t in fm["tags"].strip("[]").split(",")]
    kwname = re.sub(r"^token-", "", fn[3:-3])  # kw-<slug>.md -> keyword name tag
    if (len(tags) != 4 or tags[0] != "cr" or tags[1] != "keyword"
            or tags[2] not in CAT_NAMES or tags[3] != kwname):
        errs.append("tags must be [cr, keyword, <%s>, %s], got %s"
                    % ("|".join(CAT_NAMES), kwname, tags))
        return ["%s: %s" % (fn, e) for e in errs]
    expected_entity = "[keyword:%s]" % fn[3:-3]
    if fm["entities"] != expected_entity:
        errs.append("entities must be %s, got %s" % (expected_entity, fm["entities"]))
    m_src = SOURCE_RE.match(fm["source"])
    if not m_src:
        errs.append("source line does not match template: %s" % fm["source"])
    lines = body_lines(body)
    if not lines:
        return ["%s: empty body" % fn]
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
    expected_prefix = dict(CATEGORIES)[tags[2]]
    if m_head and not m_head.group(3).startswith(expected_prefix):
        errs.append("CR section %s not under chapter %s for category %s"
                    % (m_head.group(3), expected_prefix, tags[2]))
    return ["%s: %s" % (fn, e) for e in errs]


def validate_corpus():
    errs = []
    for f in corpus_files():
        if f == INDEX + ".md":
            continue
        errs += validate_note(os.path.join(notes_dir(HOME), f))
    return errs


def emit_entity_declarations():
    """Normalize generator-owned kw notes before validation/symlinking."""
    changed = 0
    for f in corpus_files():
        if f == INDEX + ".md":
            continue
        path = os.path.join(notes_dir(HOME), f)
        text = open(path, encoding="utf-8").read()
        keys, fm, _ = parse_note(text)
        expected = "[keyword:%s]" % f[3:-3]
        if fm.get("entities") == expected and keys == FM_KEYS:
            continue
        if "entities" in fm:
            updated = re.sub(r"^entities:.*$", "entities: " + expected, text, flags=re.M)
        else:
            updated = re.sub(r"^(created:.*)$", r"\1\nentities: " + expected, text, count=1, flags=re.M)
        with open(path, "w", encoding="utf-8") as out:
            out.write(updated)
        changed += 1
    return changed


# ------------------------------------------------------------ index generation
def sec_key(sec):
    out = []
    for p in sec.split("."):
        m = re.match(r"(\d+)([a-z]?)", p)
        out.append((int(m.group(1)), m.group(2)) if m else (0, p))
    return out


def generate_index():
    """Deterministic keywords-index.md content from the physical kw notes."""
    by_cat = {c: [] for c in CAT_NAMES}
    for f in corpus_files():
        if f == INDEX + ".md":
            continue
        _, fm, body = parse_note(open(os.path.join(notes_dir(HOME), f), encoding="utf-8").read())
        tags = [t.strip() for t in fm["tags"].strip("[]").split(",")]
        m = HEADER_RE.match(body_lines(body)[0])
        sec = m.group(3) if m else "9999"
        by_cat[tags[2]].append((sec_key(sec), f[:-3]))

    strength, created = "1", None
    ipath = os.path.join(notes_dir(HOME), INDEX + ".md")
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
        p = os.path.join(notes_dir(role), slug + ".md")
        if not os.path.isfile(p):
            continue
        _, _, body = parse_note(open(p, encoding="utf-8").read())
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


def corpus_hashes():
    return {f: sha256(os.path.join(notes_dir(HOME), f)) for f in corpus_files()}


def write_manifest():
    hashes = corpus_hashes()
    with open(manifest_path(), "w", encoding="utf-8") as f:
        f.write("# canonical keyword-corpus hashes (physical home: %s brain; editorial authority: judge).\n" % HOME)
        f.write("# Regenerate: scripts/keyword-sync.py baseline\n")
        for fn in sorted(hashes):
            f.write("%s  %s\n" % (hashes[fn], fn))
    return hashes


# ------------------------------------------------------------------- commands
def cmd_check():
    problems = []
    infos = []

    if not os.path.isdir(notes_dir(HOME)):
        print("FATAL: corpus home brain %r not found" % HOME)
        return 1

    # 1. template validation on the physical corpus
    problems += ["TEMPLATE %s" % e for e in validate_corpus()]

    # 2. index freshness
    ipath = os.path.join(notes_dir(HOME), INDEX + ".md")
    if not os.path.isfile(ipath):
        problems.append("INDEX %s missing in %s" % (INDEX, HOME))
    elif open(ipath, encoding="utf-8").read() != generate_index():
        problems.append("INDEX %s is stale (regenerate: keyword-sync.py index)" % INDEX)

    # 3. mirrors: every corpus file must be a correct relative symlink
    files = corpus_files()
    for r in MIRRORS:
        if not os.path.isdir(notes_dir(r)):
            infos.append("note: brain %r does not exist — skipped" % r)
            continue
        entries = set(mirror_kw_entries(r))
        for f in files:
            p = os.path.join(notes_dir(r), f)
            if f not in entries:
                problems.append("MISSING %s lacks symlink %s" % (r, f))
            elif not os.path.islink(p):
                problems.append("NOT-A-SYMLINK %s/%s is a regular file (drifted copy?)" % (r, f))
            elif os.readlink(p) != rel_target(f):
                problems.append("BAD-TARGET %s/%s -> %s (expected %s)"
                                % (r, f, os.readlink(p), rel_target(f)))
        for f in sorted(entries - set(files)):
            problems.append("EXTRA %s has %s (not in corpus)" % (r, f))

    # 4. content-change attribution via manifest
    manifest = read_manifest()
    hashes = corpus_hashes()
    if not manifest:
        infos.append("note: no manifest yet — run `keyword-sync.py baseline`")
    else:
        changed = sorted(f for f in hashes if manifest.get(f) not in (None, hashes[f]))
        new = sorted(f for f in hashes if f not in manifest)
        gone = sorted(f for f in manifest if f not in hashes)
        if changed:
            infos.append("corpus changed since baseline (judge-authorized? verify vs CR, then `sync`): %s"
                         % ", ".join(changed))
        if new:
            infos.append("new in corpus since baseline: %s" % ", ".join(new))
        if gone:
            infos.append("removed from corpus since baseline: %s" % ", ".join(gone))

    if not entity_index_is_fresh(ROOT, {"card": HOME, "keyword": HOME}):
        problems.append("ENTITY-INDEX stale or missing (regenerate: keyword-sync.py sync)")

    for i in infos:
        print(i)
    if problems:
        print("\n%d problem(s):" % len(problems))
        for p in problems:
            print("  " + p)
        print("\nResolution protocol: .claude/identities/KEYWORD-SYNC.md")
        print("  - NOT-A-SYMLINK/BAD-TARGET/MISSING/EXTRA -> inspect; if the stray file holds NEW")
        print("    knowledge, route it through the judge (confirm vs CR, fold into the corpus),")
        print("    then `keyword-sync.py sync` to restore the links.")
        print("  - corpus changed -> verify vs vendored CR (judge editorial), then `sync`.")
        print("  - TEMPLATE errors -> fix the physical note to the template, then `sync`.")
        return 1
    n = len([f for f in files if f != INDEX + ".md"])
    live = [HOME] + [r for r in MIRRORS if os.path.isdir(notes_dir(r))]
    print("OK: single keyword corpus (%d notes + index) in %s, symlinked into %s"
          % (n, HOME, "/".join(live[1:]) or "(no mirrors)"))
    return 0


def cmd_index():
    with open(os.path.join(notes_dir(HOME), INDEX + ".md"), "w", encoding="utf-8") as f:
        f.write(generate_index())
    add_link_edges(HOME, [INDEX])
    print("wrote %s/%s.md" % (HOME, INDEX))
    return 0


def cmd_sync():
    emitted = emit_entity_declarations()
    if emitted:
        print("emitted entities on %d physical keyword note(s)" % emitted)
    terrs = validate_corpus()
    if terrs:
        print("REFUSING to sync: corpus violates the template:")
        for e in terrs:
            print("  " + e)
        return 1
    cmd_index()
    files = corpus_files()
    slugs = [f[:-3] for f in files]
    add_link_edges(HOME, slugs)

    for r in MIRRORS:
        if not os.path.isdir(notes_dir(r)):
            print("skipped %s (brain does not exist)" % r)
            continue
        created = fixed = 0
        for f in files:
            p = os.path.join(notes_dir(r), f)
            if os.path.islink(p):
                if os.readlink(p) != rel_target(f):
                    os.remove(p)
                    os.symlink(rel_target(f), p)
                    fixed += 1
            elif os.path.exists(p):
                # regular file where a symlink belongs: only replace if identical
                if sha256(p) == sha256(os.path.join(notes_dir(HOME), f)):
                    os.remove(p)
                    os.symlink(rel_target(f), p)
                    fixed += 1
                else:
                    print("ERROR: %s/%s is a DIVERGENT regular file — route its content through"
                          " the judge, then remove it and re-run sync" % (r, f))
                    return 1
            else:
                os.symlink(rel_target(f), p)
                created += 1
        removed = 0
        for f in mirror_kw_entries(r):
            if f not in files:
                os.remove(os.path.join(notes_dir(r), f))
                removed += 1
        edges = add_link_edges(r, slugs)
        print("synced %s: %d symlink(s) created, %d fixed, %d removed, %d link edge(s) added"
              % (r, created, fixed, removed, edges))
    write_manifest()
    regenerate_entity_index(ROOT, {"card": HOME, "keyword": HOME})
    print("manifest rewritten: %s" % os.path.relpath(manifest_path(), ROOT))
    return cmd_check()


def cmd_baseline():
    write_manifest()
    print("manifest written from corpus (%d entries)" % len(read_manifest()))
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
