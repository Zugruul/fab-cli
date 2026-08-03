"""torch Dataset wrapper (APP-027): real image decoding + batch collation,
exercised against the same fixture composites run used by test_dataset.py
(includes the out-of-canvas amodal case)."""
import os

import torch

from train_vision.dataset import build_dataset
from train_vision.torch_data import CompositeObbDataset, collate_obb_batch, targets_to_tensors

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run")


def test_targets_to_tensors_places_the_positive_cell_correctly():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    by_id = {s["composite_id"]: s for s in samples}
    tensors = targets_to_tensors(by_id["composite-000"]["targets"])
    assert tensors["heatmap"].shape == (1, 12, 25)
    assert tensors["heatmap"].sum().item() == 1.0
    gy, gx = (tensors["heatmap"][0] == 1.0).nonzero()[0].tolist()
    assert (gy, gx) == (7, 12)
    assert tensors["mask"].sum().item() == 1.0


def test_targets_to_tensors_out_of_canvas_sample_has_all_zero_heatmap_and_mask():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    by_id = {s["composite_id"]: s for s in samples}
    tensors = targets_to_tensors(by_id["composite-001"]["targets"])
    assert tensors["heatmap"].sum().item() == 0.0
    assert tensors["mask"].sum().item() == 0.0


def test_dataset_getitem_decodes_a_real_image_tensor():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    ds = CompositeObbDataset(samples)
    item = ds[0]
    assert item["image"].shape == (3, 100, 200)  # CHW, matches the 200x100 fixture PNGs
    assert item["image"].dtype == torch.float32
    assert item["image"].min() >= 0.0 and item["image"].max() <= 1.0


def test_dataset_getitem_carries_composite_id_and_raw_obbs():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    ds = CompositeObbDataset(samples)
    by_id = {ds[i]["composite_id"]: ds[i] for i in range(len(ds))}
    assert len(by_id["composite-001"]["raw_obbs"]) == 1  # the out-of-canvas card, unclamped


def test_collate_obb_batch_stacks_tensors_and_keeps_lists_as_lists():
    samples = build_dataset(FIXTURE_DIR, stride=8)
    ds = CompositeObbDataset(samples)
    batch = collate_obb_batch([ds[0], ds[1]])
    assert batch["image"].shape == (2, 3, 100, 200)
    assert batch["heatmap"].shape == (2, 1, 12, 25)
    assert isinstance(batch["composite_id"], list) and len(batch["composite_id"]) == 2
    assert isinstance(batch["raw_obbs"], list) and len(batch["raw_obbs"]) == 2
