"""Dataset adapter (APP-027): reads a composites-generator run directory
(APP-026's output — manifest.json + <id>.png + <id>.json per composite,
see pipeline/src/composites/write.ts) and produces per-sample OBB training
targets via encode.py. Fixture run lives at tests/fixtures/composites-run/
and deliberately includes an out-of-canvas quad (composite-001) so the
amodal contract is exercised end-to-end through the real manifest/label
file-reading path, not just encode.py's own unit tests.
"""
import os

import pytest

from train_vision.dataset import build_dataset, split_dataset

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run")


def test_build_dataset_reads_every_composite_from_the_manifest():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    assert len(samples) == 3
    ids = {s["composite_id"] for s in samples}
    assert ids == {"composite-000", "composite-001", "composite-002"}


def test_build_dataset_resolves_image_path_relative_to_run_dir():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    by_id = {s["composite_id"]: s for s in samples}
    assert by_id["composite-000"]["image_path"] == os.path.join(FIXTURE_DIR, "composite-000.png")
    assert os.path.exists(by_id["composite-000"]["image_path"])


def test_build_dataset_carries_width_height_from_the_label():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    for s in samples:
        assert s["width"] == 200
        assert s["height"] == 100


def test_build_dataset_in_canvas_composite_has_one_heatmap_peak_and_one_raw_obb():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    by_id = {s["composite_id"]: s for s in samples}
    targets = by_id["composite-000"]["targets"]
    assert len(targets["obb_targets"]) == 1
    assert len(targets["raw_obbs"]) == 1


def test_build_dataset_out_of_canvas_composite_has_zero_heatmap_peaks_but_one_raw_obb():
    # composite-001's only card is the out-of-canvas fixture (center at
    # x=-10) — this is the amodal case: no trainable heatmap peak, but the
    # ground truth must still be present for mAP evaluation.
    samples = build_dataset(FIXTURE_DIR, stride=8)
    by_id = {s["composite_id"]: s for s in samples}
    targets = by_id["composite-001"]["targets"]
    assert targets["obb_targets"] == []
    assert len(targets["raw_obbs"]) == 1
    cx, cy, w, h, theta = targets["raw_obbs"][0]
    assert cx == pytest.approx(-10.0)


def test_build_dataset_composite_with_two_cards():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    by_id = {s["composite_id"]: s for s in samples}
    targets = by_id["composite-002"]["targets"]
    assert len(targets["raw_obbs"]) == 2
    assert len(targets["obb_targets"]) == 2  # both cards fixture-002 uses are in-canvas


def test_build_dataset_raises_a_clear_error_when_manifest_is_missing(tmp_path):
    with pytest.raises(FileNotFoundError, match="manifest.json"):
        build_dataset(str(tmp_path), stride=8)


def test_split_dataset_is_deterministic_given_the_same_seed():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    train_a, val_a = split_dataset(samples, val_fraction=1 / 3, seed=7)
    train_b, val_b = split_dataset(samples, val_fraction=1 / 3, seed=7)
    assert [s["composite_id"] for s in train_a] == [s["composite_id"] for s in train_b]
    assert [s["composite_id"] for s in val_a] == [s["composite_id"] for s in val_b]


def test_split_dataset_partitions_every_sample_exactly_once():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    train, val = split_dataset(samples, val_fraction=1 / 3, seed=1)
    assert len(train) + len(val) == len(samples)
    assert set(s["composite_id"] for s in train).isdisjoint(s["composite_id"] for s in val)


def test_split_dataset_different_seeds_can_yield_different_val_sets():
    # A synthetic, independently-constructed sample pool (not derived from
    # the 3-item fixture) so the shuffle has enough entries to plausibly
    # differ between seeds.
    samples = [{"composite_id": f"synthetic-{i}"} for i in range(12)]
    _, val_seed_1 = split_dataset(samples, val_fraction=0.5, seed=1)
    _, val_seed_2 = split_dataset(samples, val_fraction=0.5, seed=2)
    assert [s["composite_id"] for s in val_seed_1] != [s["composite_id"] for s in val_seed_2]


def test_split_dataset_zero_val_fraction_keeps_everything_in_train():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    train, val = split_dataset(samples, val_fraction=0.0, seed=1)
    assert len(val) == 0
    assert len(train) == len(samples)
