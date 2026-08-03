"""torch Dataset wrapper for per-card embedder crops (APP-028). Mirrors
torch_data.py's role for the detector exactly: the ONLY module here that
decodes real image bytes (via PIL) and produces torch tensors, wrapping
embed_dataset.py's pure per-card sample list + embed_crop.py's box
geometry + embed_pixels.py's neutral-padding crop.
"""
from typing import Any, Dict, List

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset

from .embed_crop import compute_crop_box
from .embed_pixels import crop_with_neutral_padding


def crop_card_to_tensor(image: Image.Image, corners: List[Any], output_size: int) -> torch.Tensor:
    """Crops `image` to `corners`'s (unclamped) bounding box with neutral
    padding for any out-of-canvas portion, then resizes to a fixed
    `output_size` x `output_size` square. Raises on a degenerate
    (zero-area) box rather than silently returning an empty/garbage
    tensor."""
    arr = np.asarray(image.convert("RGB"), dtype=np.uint8)
    box = compute_crop_box(corners)
    cropped = crop_with_neutral_padding(arr, box)
    if cropped.shape[0] == 0 or cropped.shape[1] == 0:
        raise ValueError(f"crop_card_to_tensor: degenerate crop box {box} produced an empty ({cropped.shape[0]}x{cropped.shape[1]}) crop")
    resized = Image.fromarray(cropped).resize((output_size, output_size), Image.BILINEAR)
    resized_arr = np.asarray(resized, dtype=np.float32) / 255.0
    return torch.from_numpy(resized_arr).permute(2, 0, 1).contiguous()


class PrintingCropDataset(Dataset):
    """Wraps `embed_dataset.build_embed_dataset`'s sample list, decoding
    the composite PNG (real image bytes, via PIL) and cropping to each
    card's quad on `__getitem__`. `class_index` maps printing_id -> a
    stable integer label (embed_dataset.build_class_index)."""

    def __init__(self, samples: List[Dict[str, Any]], class_index: Dict[str, int], output_size: int):
        self.samples = samples
        self.class_index = class_index
        self.output_size = output_size

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        sample = self.samples[idx]
        image = Image.open(sample["image_path"])
        tensor = crop_card_to_tensor(image, sample["corners"], self.output_size)
        return {
            "image": tensor,
            "label": self.class_index[sample["printing_id"]],
            "printing_id": sample["printing_id"],
            "composite_id": sample["composite_id"],
        }


def collate_embed_batch(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "image": torch.stack([it["image"] for it in items]),
        "label": torch.tensor([it["label"] for it in items], dtype=torch.long),
        "printing_id": [it["printing_id"] for it in items],
        "composite_id": [it["composite_id"] for it in items],
    }
