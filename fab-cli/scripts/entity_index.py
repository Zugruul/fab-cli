"""Deterministic frontmatter-only cross-identity entity index support."""
import json
import os
import re


def parse_list(raw):
    raw = raw.strip()
    if not (raw.startswith("[") and raw.endswith("]")):
        return []
    return [v.strip().strip('"\'') for v in raw[1:-1].split(",") if v.strip()]


def note_entities(path):
    with open(path, encoding="utf-8") as note:
        text = note.read()
    if not text.startswith("---\n"):
        return []
    end = text.find("\n---", 4)
    if end < 0:
        return []
    match = re.search(r"^entities:\s*(.+)$", text[4:end], re.M)
    return parse_list(match.group(1)) if match else []


def collect(identities, entity_kinds=None):
    found = {}
    if not os.path.isdir(identities):
        return {}
    for role in sorted(os.listdir(identities)):
        notes = os.path.join(identities, role, "brain", "notes")
        if not os.path.isdir(notes):
            continue
        for fn in sorted(os.listdir(notes)):
            path = os.path.join(notes, fn)
            if not fn.endswith(".md") or os.path.islink(path):
                continue
            for key in note_entities(path):
                found.setdefault(key, set()).add((role, fn[:-3]))
    result = {}
    for key in sorted(found):
        notes = sorted(found[key])
        home = (entity_kinds or {}).get(key.split(":", 1)[0])
        anchors = [slug for role, slug in notes if role == home]
        result[key] = {
            "anchor": "%s/%s" % (home, anchors[0]) if len(anchors) == 1 else None,
            "notes": [list(note) for note in notes],
        }
    return result


def render(entities):
    if not entities:
        return '{\n  "generated-by": "brain.py entity-index",\n  "entities": {}\n}\n'
    lines = ["{", '  "generated-by": "brain.py entity-index",', '  "entities": {']
    keys = sorted(entities)
    for i, key in enumerate(keys):
        info = entities[key]
        lines.append("    %s: {" % json.dumps(key))
        lines.append('      "anchor": %s,' % json.dumps(info["anchor"]))
        lines.append('      "notes": [')
        for j, note in enumerate(info["notes"]):
            lines.append("        %s%s" % (json.dumps(note), "," if j < len(info["notes"]) - 1 else ""))
        lines.append("      ]")
        lines.append("    }%s" % ("," if i < len(keys) - 1 else ""))
    lines.extend(["  }", "}"])
    return "\n".join(lines) + "\n"


def expected(root, entity_kinds=None):
    identities = os.path.join(root, ".claude", "identities")
    return render(collect(identities, entity_kinds))


def regenerate(root, entity_kinds=None):
    path = os.path.join(root, ".claude", "identities", "entity-index.json")
    content = expected(root, entity_kinds)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def is_fresh(root, entity_kinds=None):
    path = os.path.join(root, ".claude", "identities", "entity-index.json")
    if not os.path.isfile(path):
        return False
    with open(path, encoding="utf-8") as index:
        return index.read() == expected(root, entity_kinds)
