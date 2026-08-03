"""Loss functions (APP-027): a CenterNet-style penalty-reduced focal loss
for the object-presence heatmap, and a mask-gated L1 loss for the offset/
size/angle regression heads (only positive cells contribute — see
encode.py's amodal doc comment for why off-canvas cards never reach a
positive cell in the first place, so the mask itself needs no special
out-of-canvas handling here). Every expected value below is computed by
hand from the closed-form loss definitions, not just shape-asserted.
"""
import math

import pytest
import torch

from train_vision.losses import heatmap_focal_loss, masked_l1_loss


def test_heatmap_focal_loss_hand_computed_small_case():
    # 1x4 "heatmap": one positive cell, three negative cells.
    pred = torch.tensor([[0.5, 0.2, 0.2, 0.2]])
    target = torch.tensor([[1.0, 0.0, 0.0, 0.0]])
    loss = heatmap_focal_loss(pred, target)

    pos_loss = -math.log(0.5) * (1 - 0.5) ** 2
    neg_loss = 3 * (-math.log(1 - 0.2) * (0.2**2))
    expected = (pos_loss + neg_loss) / 1  # normalized by num_pos = 1
    assert loss.item() == pytest.approx(expected, rel=1e-5)


def test_heatmap_focal_loss_is_near_zero_for_a_perfect_prediction():
    pred = torch.tensor([[0.999, 0.001, 0.001]])
    target = torch.tensor([[1.0, 0.0, 0.0]])
    loss = heatmap_focal_loss(pred, target)
    assert loss.item() < 0.001


def test_heatmap_focal_loss_penalizes_a_confident_wrong_prediction_much_more():
    target = torch.tensor([[1.0, 0.0, 0.0]])
    good = heatmap_focal_loss(torch.tensor([[0.9, 0.1, 0.1]]), target)
    bad = heatmap_focal_loss(torch.tensor([[0.1, 0.9, 0.9]]), target)
    assert bad.item() > good.item() * 10


def test_heatmap_focal_loss_normalizes_by_positive_count_not_total_cells():
    # Two positive cells in an 8-cell grid vs one positive cell in a
    # 4-cell grid, otherwise identical per-cell predictions/targets —
    # normalizing by num_pos (not numel) means these should match.
    pred_a = torch.tensor([[0.5, 0.2, 0.2, 0.2]])
    target_a = torch.tensor([[1.0, 0.0, 0.0, 0.0]])
    pred_b = torch.tensor([[0.5, 0.5, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]])
    target_b = torch.tensor([[1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]])
    assert heatmap_focal_loss(pred_a, target_a).item() == pytest.approx(heatmap_focal_loss(pred_b, target_b).item(), rel=1e-5)


def test_heatmap_focal_loss_all_negative_targets_never_divides_by_zero():
    pred = torch.tensor([[0.1, 0.2, 0.3]])
    target = torch.tensor([[0.0, 0.0, 0.0]])
    loss = heatmap_focal_loss(pred, target)
    assert math.isfinite(loss.item())
    assert loss.item() > 0


def test_masked_l1_loss_hand_computed():
    pred = torch.tensor([1.0, 5.0, 10.0])
    target = torch.tensor([0.0, 5.0, 2.0])
    mask = torch.tensor([1.0, 0.0, 1.0])
    loss = masked_l1_loss(pred, target, mask)
    # |1-0|*1 + |5-5|*0 + |10-2|*1 = 1 + 0 + 8 = 9, divided by mask.sum()=2
    assert loss.item() == pytest.approx(9.0 / 2.0)


def test_masked_l1_loss_ignores_unmasked_positions_entirely():
    pred_a = torch.tensor([1.0, 999.0])
    pred_b = torch.tensor([1.0, -999.0])
    target = torch.tensor([1.0, 0.0])
    mask = torch.tensor([1.0, 0.0])
    assert masked_l1_loss(pred_a, target, mask).item() == pytest.approx(masked_l1_loss(pred_b, target, mask).item())
    assert masked_l1_loss(pred_a, target, mask).item() == pytest.approx(0.0)


def test_masked_l1_loss_all_zero_mask_returns_zero_not_nan():
    pred = torch.tensor([5.0, 5.0])
    target = torch.tensor([1.0, 1.0])
    mask = torch.tensor([0.0, 0.0])
    loss = masked_l1_loss(pred, target, mask)
    assert math.isfinite(loss.item())
    assert loss.item() == pytest.approx(0.0)
