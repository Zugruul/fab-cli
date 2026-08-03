"""Loss functions for the OBB CenterNet-style head (APP-027).

`heatmap_focal_loss` is a penalty-reduced focal loss over HARD 0/1 targets
(a documented simplification vs. full CenterNet, which Gaussian-splats
target peaks around each object center for partial credit near a true
center — not needed for this task's single, small "card" class and kept
out to stay boring/simple/easy-to-verify-by-hand, per the issue brief's
"prefer boring... over state-of-the-art").

`masked_l1_loss` backs every regression head (offset/size/angle): only
cells with mask=1 (i.e. encode.py's positive/in-canvas cells) contribute,
matching the amodal contract that an off-canvas card was never placed in
the heatmap in the first place and so has no regression target to fit.
"""
import torch


def heatmap_focal_loss(pred: torch.Tensor, target: torch.Tensor, alpha: float = 2.0, eps: float = 1e-6) -> torch.Tensor:
    """`pred`: post-sigmoid probabilities in (0, 1) (clamped defensively).
    `target`: hard 0/1 tensor, same shape. Normalized by the number of
    positive cells (not total cell count) — with zero positive cells in a
    composite (a synthetic image with no cards, theoretically possible but
    never emitted by APP-026's generator) this falls back to normalizing
    by 1 so the loss stays finite rather than dividing by zero.
    """
    pred = pred.clamp(min=eps, max=1.0 - eps)
    pos_mask = target.eq(1).float()
    neg_mask = 1.0 - pos_mask

    pos_loss = -torch.log(pred) * (1 - pred).pow(alpha) * pos_mask
    neg_loss = -torch.log(1 - pred) * pred.pow(alpha) * neg_mask

    num_pos = pos_mask.sum()
    total = pos_loss.sum() + neg_loss.sum()
    denom = num_pos.clamp(min=1.0)
    return total / denom


def masked_l1_loss(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Mean absolute error over positions where `mask` is 1; returns exactly
    0.0 (not NaN) when the mask is entirely zero (no positive cells in this
    batch element — nothing to regress against)."""
    diff = (pred - target).abs() * mask
    denom = mask.sum()
    if denom.item() == 0:
        return torch.zeros((), dtype=pred.dtype)
    return diff.sum() / denom
