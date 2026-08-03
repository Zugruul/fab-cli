"""Per-card dataset adapter for the recognition embedder (APP-028). Reuses
the SAME fixture composites-run/ test_dataset.py already reads (one card
in composite-000, an out-of-canvas card in composite-001, two cards in
composite-002) -- it already has 4 distinct printingId values, which is
exactly what build_class_index needs to be meaningfully exercised, so no
new fixture is needed.
"""
import os

import pytest

from train_vision.embed_dataset import build_class_index, build_embed_dataset

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run")


def test_build_embed_dataset_yields_one_sample_per_card_not_per_composite():
    samples = build_embed_dataset(FIXTURE_DIR)
    # composite-000: 1 card, composite-001: 1 card, composite-002: 2 cards.
    assert len(samples) == 4


def test_build_embed_dataset_carries_printing_id_corners_and_composite_metadata():
    samples = build_embed_dataset(FIXTURE_DIR)
    by_printing_id = {s["printing_id"]: s for s in samples}
    assert set(by_printing_id.keys()) == {"printing-in-canvas", "printing-out-of-canvas", "printing-a", "printing-b"}

    sample = by_printing_id["printing-a"]
    assert sample["composite_id"] == "composite-002"
    assert sample["width"] == 200
    assert sample["height"] == 100
    assert sample["tags"] == ["foil"]
    assert sample["corners"] == [{"x": 10, "y": 10}, {"x": 50, "y": 10}, {"x": 50, "y": 30}, {"x": 10, "y": 30}]


def test_build_embed_dataset_resolves_image_path_relative_to_run_dir():
    samples = build_embed_dataset(FIXTURE_DIR)
    by_printing_id = {s["printing_id"]: s for s in samples}
    expected_path = os.path.join(FIXTURE_DIR, "composite-000.png")
    assert by_printing_id["printing-in-canvas"]["image_path"] == expected_path
    assert os.path.exists(expected_path)


def test_build_embed_dataset_two_cards_in_one_composite_both_carried():
    samples = build_embed_dataset(FIXTURE_DIR)
    from_composite_002 = [s for s in samples if s["composite_id"] == "composite-002"]
    assert len(from_composite_002) == 2
    assert {s["printing_id"] for s in from_composite_002} == {"printing-a", "printing-b"}
    assert {s["card_index"] for s in from_composite_002} == {0, 1}


def test_build_embed_dataset_raises_a_clear_error_when_manifest_is_missing(tmp_path):
    with pytest.raises(FileNotFoundError, match="manifest.json"):
        build_embed_dataset(str(tmp_path))


def test_build_class_index_is_a_deterministic_sorted_mapping():
    samples = build_embed_dataset(FIXTURE_DIR)
    class_index = build_class_index(samples)
    assert class_index == {
        "printing-a": 0,
        "printing-b": 1,
        "printing-in-canvas": 2,
        "printing-out-of-canvas": 3,
    }


def test_build_class_index_deduplicates_repeated_printing_ids():
    samples = [{"printing_id": "p1"}, {"printing_id": "p2"}, {"printing_id": "p1"}]
    class_index = build_class_index(samples)
    assert len(class_index) == 2
    assert set(class_index.values()) == {0, 1}
