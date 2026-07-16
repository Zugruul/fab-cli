import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[2]


def load_script(name):
    path = ROOT / "scripts" / name
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def card(name, pitch="", uid="uid", types=None):
    return {
        "name": name,
        "pitch": pitch,
        "unique_id": uid,
        "types": types or ["Action"],
        "type_text": "Generic Action",
        "printings": [],
    }


class CardEntityTests(unittest.TestCase):
    def setUp(self):
        self.mod = load_script("build-card-vault.py")

    def test_pitch_variants_share_name_level_entity_and_disambiguator(self):
        for slug, pitch, expected in (
            ("card-scar-for-a-scar-red", "1", "entities: [card:scar-for-a-scar]"),
            ("card-scar-for-a-scar-yellow", "2", "entities: [card:scar-for-a-scar]"),
            ("card-scar-for-a-scar-blue", "3", "entities: [card:scar-for-a-scar]"),
            ("card-namesake-token-red", "1", "entities: [card:namesake-token]"),
        ):
            text, _ = self.mod.build_note(
                card("Scar for a Scar", pitch), slug, [], [], set(), "2026-01-01"
            )
            self.assertIn(expected, text)

    def test_build_is_idempotent_and_check_rejects_removed_entity(self):
        with tempfile.TemporaryDirectory() as td:
            notes = pathlib.Path(td) / "notes"
            notes.mkdir()
            self.mod.NOTES = str(notes)
            self.mod.LINKS = str(pathlib.Path(td) / "links.json")
            generated = {
                "card-alpha": "---\nentities: [card:alpha]\n---\n\nAlpha\n",
                "card-vault-map": "---\ntags: [hub]\n---\n",
            }
            self.mod.generate_all = lambda: (generated, {}, set())
            self.mod.regenerate_entity_index = mock.Mock()
            self.assertEqual(0, self.mod.cmd_build())
            first = {p.name: p.read_bytes() for p in notes.iterdir()}
            self.assertEqual(0, self.mod.cmd_build())
            self.assertEqual(first, {p.name: p.read_bytes() for p in notes.iterdir()})
            (notes / "card-alpha.md").write_text("---\n---\n\nAlpha\n")
            self.assertEqual(1, self.mod.cmd_check())
            self.assertEqual(2, self.mod.regenerate_entity_index.call_count)


class KeywordEntityTests(unittest.TestCase):
    def setUp(self):
        self.mod = load_script("keyword-sync.py")

    def test_physical_keyword_note_requires_slug_entity(self):
        text = """---
tags: [cr, keyword, ability, go-again]
paths: []
strength: 1
source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR 8.3.1) — vendored: third_party/fab-rules/en-fab-cr.txt"
graduated: false
created: 2026-01-01
entities: [keyword:go-again]
---

**Go again** — ability keyword (CR 8.3.1).
Index: [[keywords-index]]. When ruling, cite CR 8.3.1; verify against the vendored artifact.
"""
        with tempfile.TemporaryDirectory() as td:
            path = pathlib.Path(td) / "kw-go-again.md"
            path.write_text(text)
            self.assertEqual([], self.mod.validate_note(str(path)))
            path.write_text(text.replace("entities: [keyword:go-again]\n", ""))
            self.assertTrue(any("entities" in e for e in self.mod.validate_note(str(path))))


class BackfillTests(unittest.TestCase):
    def test_precision_uses_exact_tags_and_long_display_names_only(self):
        mod = load_script("backfill-entities.py")
        cards = {
            "go-again": "Go Again",
            "command-and-conquer": "Command and Conquer",
            "art-of-war": "Art of War",
            "fyendals-spring-tunic": "Fyendal's Spring Tunic",
        }
        text = """---
tags: [interaction, command-and-conquer, unrelated]
---
Art of Warfare is not the card name. Fyendal's Spring Tunic blocks one.
"""
        self.assertEqual(
            ["card:command-and-conquer", "card:fyendals-spring-tunic"],
            mod.propose_entities(text, cards),
        )


class EntityIndexTests(unittest.TestCase):
    def test_regeneration_is_deterministic_and_symlinks_count_once(self):
        entity_index = load_script("entity_index.py")
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            (root / ".claude" / "identities" / "card-vault" / "brain" / "notes").mkdir(parents=True)
            (root / ".claude" / "identities" / "judge" / "brain" / "notes").mkdir(parents=True)
            (root / ".claude" / "project.yaml").write_text(
                "methodology:\n  entityKinds:\n    card: card-vault\n"
            )
            home = root / ".claude" / "identities" / "card-vault" / "brain" / "notes" / "card-alpha.md"
            home.write_text("---\nentities: [card:alpha]\n---\n")
            os.symlink(home, root / ".claude" / "identities" / "judge" / "brain" / "notes" / "card-alpha.md")
            for _ in range(2):
                entity_index.regenerate(str(root), {"card": "card-vault"})
                content = (root / ".claude" / "identities" / "entity-index.json").read_bytes()
                if "first" in locals():
                    self.assertEqual(first, content)
                first = content
            data = json.loads(first)
            self.assertEqual(
                {"anchor": "card-vault/card-alpha", "notes": [["card-vault", "card-alpha"]]},
                data["entities"]["card:alpha"],
            )


if __name__ == "__main__":
    unittest.main()
