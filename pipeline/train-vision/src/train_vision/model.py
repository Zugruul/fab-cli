"""OBB detector architecture (APP-027, SPEC-APP.md §8.7c, §5, §13
Invariant 9): a from-scratch, single-class CenterNet-style head on a tiny
custom convolutional backbone.

Architecture decision (recorded here + in licenses.py/manifest.py, per the
issue's AC "license of architecture ... recorded in manifest"):
  - NOT Ultralytics YOLO (AGPL-3.0 — excluded outright by Invariant 9).
  - NOT MMRotate/MMDetection (Apache-2.0 itself, but pulls in mmcv's
    compiled-op ecosystem and a heavier install/export surface than this
    task needs — "prefer boring and exportable over state-of-the-art").
  - NOT a torchvision pretrained backbone — torchvision's own LICENSE is
    BSD-3-Clause, but its hosted pretrained-weight license status is
    documented as unresolved in PyTorch's own forums (see licenses.py's
    doc comment); training from scratch on APP-026's synthetic composites
    sidesteps that ambiguity entirely rather than accepting it.
  - Chosen: a plain, hand-rolled Conv-BN-ReLU stack (stride-2 x3 = stride 8
    total) feeding a single 1x1-conv CenterNet-style head. Zero
    third-party model-definition dependencies — only `torch` itself
    (BSD-3-Clause) is imported. This is the "plain CenterNet/SSD-style
    head with quad regression" candidate from SPEC-APP.md's own backlog
    row (docs/BACKLOG-APP.md ~133-137), picked specifically for its
    minimal, auditable license surface.

Output channels (7 total), all produced by one final 1x1 conv:
  - heatmap (1): sigmoid-activated single-class ("card") object-presence
    probability per grid cell.
  - offset (2): sub-cell (x, y) center offset, in grid-cell units.
  - size (2): log(width), log(height) in pixels (log-space keeps the
    regression well-scaled across the card-size range APP-026's `scale`
    knob produces).
  - angle (2): (sin, cos) of the OBB's rotation — avoids the angle-
    wraparound discontinuity a raw-radians regression target would have.
"""
from typing import Dict

import torch
import torch.nn as nn


class ObbCenterNet(nn.Module):
    def __init__(self, in_channels: int = 3, base_channels: int = 16, stride: int = 8):
        super().__init__()
        if stride not in (2, 4, 8, 16):
            raise ValueError(f"stride must be one of (2, 4, 8, 16), got {stride}")
        num_downsamples = {2: 1, 4: 2, 8: 3, 16: 4}[stride]

        layers = []
        c_in = in_channels
        c_out = base_channels
        for _ in range(num_downsamples):
            layers += [nn.Conv2d(c_in, c_out, kernel_size=3, stride=2, padding=1), nn.BatchNorm2d(c_out), nn.ReLU(inplace=True)]
            c_in, c_out = c_out, c_out * 2
        # One extra same-resolution block at the final stride for capacity.
        layers += [nn.Conv2d(c_in, c_in, kernel_size=3, stride=1, padding=1), nn.BatchNorm2d(c_in), nn.ReLU(inplace=True)]
        self.backbone = nn.Sequential(*layers)
        self.head = nn.Conv2d(c_in, 7, kernel_size=1)
        self.stride = stride

    def forward(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
        feat = self.backbone(x)
        out = self.head(feat)
        return {
            "heatmap": torch.sigmoid(out[:, 0:1]),
            "offset": out[:, 1:3],
            "size": out[:, 3:5],
            "angle": out[:, 5:7],
        }
