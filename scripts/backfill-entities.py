#!/usr/bin/env python3
"""One-shot conservative entity proposal for hand-owned judge/player notes.

Writes only frontmatter declarations, producing an ordinary reviewable git diff.
It never stages or commits changes. Run with --check to report proposals only.
"""
import argparse
import json
import os
import re
import subprocess
import unicodedata

from entity_index import regenerate as regenerate_entity_index


def root():
    return subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()


def kebab(value):
    value = unicodedata.normalize("NFKD", value)
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.replace("’", "").replace("'", "").replace("&", " and ")
    return re.sub(r"-+", "-", re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-")).lower()


def frontmatter(text):
    if not text.startswith("---\n"):
        return None, None
    end = text.find("\n---", 4)
    return (text[4:end], end) if end >= 0 else (None, None)


def list_field(fm, name):
    match = re.search(r"^%s:\s*\[([^]]*)\]" % re.escape(name), fm, re.M)
    return [x.strip() for x in match.group(1).split(",") if x.strip()] if match else []


def propose_entities(text, cards):
    fm, end = frontmatter(text)
    if fm is None:
        return []
    tags = set(list_field(fm, "tags"))
    body = text[end + 4:]
    folded = body.casefold()
    proposals = set()
    for slug, display in cards.items():
        if slug in tags:
            proposals.add("card:" + slug)
            continue
        if len(display) < 6:
            continue
        needle = display.casefold()
        start = folded.find(needle)
        while start >= 0:
            before = folded[start - 1] if start else ""
            after_pos = start + len(needle)
            after = folded[after_pos] if after_pos < len(folded) else ""
            if not before.isalnum() and not after.isalnum():
                proposals.add("card:" + slug)
                break
            start = folded.find(needle, start + 1)
    return sorted(proposals)


def add_entities(text, proposals):
    if not proposals:
        return text
    fm, end = frontmatter(text)
    existing = list_field(fm, "entities")
    merged = sorted(set(existing) | set(proposals))
    line = "entities: [%s]" % ", ".join(merged)
    if re.search(r"^entities:", fm, re.M):
        new_fm = re.sub(r"^entities:.*$", line, fm, flags=re.M)
    else:
        new_fm = fm.rstrip("\n") + "\n" + line + "\n"
    return "---\n" + new_fm + text[end:]


def card_names(repo):
    path = os.path.join(repo, "third_party", "flesh-and-blood-cards", "json", "english", "card.json")
    cards = json.load(open(path, encoding="utf-8"))
    return {kebab(card["name"]): card["name"] for card in cards}


def run(repo, check=False):
    cards = card_names(repo)
    changed = []
    for role in ("judge", "player"):
        directory = os.path.join(repo, ".claude", "identities", role, "brain", "notes")
        for fn in sorted(os.listdir(directory)):
            path = os.path.join(directory, fn)
            if not fn.endswith(".md") or os.path.islink(path):
                continue
            text = open(path, encoding="utf-8").read()
            proposals = propose_entities(text, cards)
            updated = add_entities(text, proposals)
            if updated != text:
                changed.append((role, fn, proposals))
                if not check:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(updated)
    for role, fn, proposals in changed:
        print("%s/%s: %s" % (role, fn, ", ".join(proposals)))
    if not check:
        regenerate_entity_index(repo, {"card": "card-vault", "keyword": "card-vault"})
    print("%d hand-owned note(s) proposed" % len(changed))
    return 1 if check and changed else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report without writing")
    args = parser.parse_args()
    return run(root(), args.check)


if __name__ == "__main__":
    raise SystemExit(main())
