"""torch Dataset wrapper (APP-027): the only module in this package that
imports PIL for real image decoding. `dataset.py`'s `build_dataset` stays
pure/torch-free (metadata + target encoding only); this module bridges
that to a `torch.utils.data.Dataset` a real DataLoader can consume.

`targets_to_tensors` is pulled out as its own tested function (not just
inlined in a Dataset method) so train.py's decode/eval path and any test
can build the exact same tensors from an `encode_targets` result.
"""
from typing import Any, Dict, List

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset


def targets_to_tensors(targets: Dict[str, Any]) -> Dict[str, torch.Tensor]:
    """Converts one `encode_targets(...)` result into per-sample (no batch
    dim) tensors: heatmap (1,H,W), offset/size/angle (2,H,W), mask (1,H,W)
    — `mask` is 1 at exactly the cells `obb_targets` covers, 0 elsewhere,
    so `losses.masked_l1_loss` can gate the regression heads without ever
    touching cells that have no target (including every off-canvas card's
    cell-that-never-existed — see encode.py's amodal doc comment)."""
    grid_h, grid_w = targets["grid_h"], targets["grid_w"]
    heatmap = torch.zeros(1, grid_h, grid_w)
    offset = torch.zeros(2, grid_h, grid_w)
    size = torch.zeros(2, grid_h, grid_w)
    angle = torch.zeros(2, grid_h, grid_w)
    mask = torch.zeros(1, grid_h, grid_w)
    for t in targets["obb_targets"]:
        gy, gx = t["gy"], t["gx"]
        heatmap[0, gy, gx] = 1.0
        offset[0, gy, gx] = t["offset_x"]
        offset[1, gy, gx] = t["offset_y"]
        size[0, gy, gx] = float(np.log(t["w"]))
        size[1, gy, gx] = float(np.log(t["h"]))
        angle[0, gy, gx] = t["sin"]
        angle[1, gy, gx] = t["cos"]
        mask[0, gy, gx] = 1.0
    return {"heatmap": heatmap, "offset": offset, "size": size, "angle": angle, "mask": mask}


class CompositeObbDataset(Dataset):
    """Wraps `dataset.build_dataset`'s sample list, decoding the composite
    PNG (real image bytes, via PIL) on `__getitem__`. `raw_obbs` and
    `composite_id` are carried through verbatim (needed by mAP eval /
    debugging) — `collate_obb_batch` below is what keeps them from being
    mangled by torch's default tensor-stacking collate."""

    def __init__(self, samples: List[Dict[str, Any]]):
        self.samples = samples

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        sample = self.samples[idx]
        image = Image.open(sample["image_path"]).convert("RGB")
        arr = np.asarray(image, dtype=np.float32) / 255.0
        image_tensor = torch.from_numpy(arr).permute(2, 0, 1).contiguous()  # HWC -> CHW

        tensors = targets_to_tensors(sample["targets"])
        return {
            "image": image_tensor,
            "composite_id": sample["composite_id"],
            "raw_obbs": sample["targets"]["raw_obbs"],
            **tensors,
        }


def collate_obb_batch(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Stacks the tensor fields into a batch; keeps `composite_id` and
    `raw_obbs` as plain per-sample lists (variable length across samples,
    so they can't be stacked into a single tensor)."""
    return {
        "image": torch.stack([it["image"] for it in items]),
        "heatmap": torch.stack([it["heatmap"] for it in items]),
        "offset": torch.stack([it["offset"] for it in items]),
        "size": torch.stack([it["size"] for it in items]),
        "angle": torch.stack([it["angle"] for it in items]),
        "mask": torch.stack([it["mask"] for it in items]),
        "composite_id": [it["composite_id"] for it in items],
        "raw_obbs": [it["raw_obbs"] for it in items],
    }
