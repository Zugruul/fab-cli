"""ObbCenterNet architecture (APP-027): output-shape contract, plus an
end-to-end CPU overfit test (model + losses.py + encode.py wired together
exactly as train.py would) proving the whole differentiable path actually
learns something, not just that shapes line up. No GPU, no torchvision, no
pretrained weights (see model.py's doc comment for why).
"""
import torch

from train_vision.encode import encode_targets
from train_vision.losses import heatmap_focal_loss, masked_l1_loss
from train_vision.model import ObbCenterNet


def test_forward_pass_output_shapes_match_stride_downsampled_grid():
    model = ObbCenterNet(base_channels=4, stride=8)
    x = torch.zeros(2, 3, 64, 64)
    out = model(x)
    assert out["heatmap"].shape == (2, 1, 8, 8)
    assert out["offset"].shape == (2, 2, 8, 8)
    assert out["size"].shape == (2, 2, 8, 8)
    assert out["angle"].shape == (2, 2, 8, 8)


def test_heatmap_output_is_sigmoid_bounded():
    model = ObbCenterNet(base_channels=4, stride=8)
    x = torch.randn(1, 3, 32, 32) * 10  # large-magnitude input to stress the sigmoid bound
    out = model(x)
    assert torch.all(out["heatmap"] >= 0.0)
    assert torch.all(out["heatmap"] <= 1.0)


def test_different_strides_produce_the_expected_downsample_factor():
    for stride in (2, 4, 8, 16):
        model = ObbCenterNet(base_channels=4, stride=stride)
        x = torch.zeros(1, 3, 64, 64)
        out = model(x)
        assert out["heatmap"].shape[-1] == 64 // stride
        assert out["heatmap"].shape[-2] == 64 // stride


def test_rejects_unsupported_stride():
    import pytest

    with pytest.raises(ValueError, match="stride"):
        ObbCenterNet(stride=7)


def _targets_to_tensors(targets, grid_h, grid_w):
    heatmap = torch.zeros(1, 1, grid_h, grid_w)
    offset = torch.zeros(1, 2, grid_h, grid_w)
    size = torch.zeros(1, 2, grid_h, grid_w)
    angle = torch.zeros(1, 2, grid_h, grid_w)
    mask = torch.zeros(1, 1, grid_h, grid_w)
    for t in targets["obb_targets"]:
        gy, gx = t["gy"], t["gx"]
        heatmap[0, 0, gy, gx] = 1.0
        offset[0, 0, gy, gx] = t["offset_x"]
        offset[0, 1, gy, gx] = t["offset_y"]
        size[0, 0, gy, gx] = torch.log(torch.tensor(t["w"]))
        size[0, 1, gy, gx] = torch.log(torch.tensor(t["h"]))
        angle[0, 0, gy, gx] = t["sin"]
        angle[0, 1, gy, gx] = t["cos"]
        mask[0, 0, gy, gx] = 1.0
    return heatmap, offset, size, angle, mask


def test_model_overfits_a_single_synthetic_sample_within_a_few_steps():
    torch.manual_seed(0)
    canvas = 32
    stride = 8
    quad = {"printingId": "p", "corners": [[8, 8], [24, 8], [24, 24], [8, 24]], "tags": []}
    targets = encode_targets([quad], canvas_width=canvas, canvas_height=canvas, stride=stride)
    grid_h, grid_w = targets["grid_h"], targets["grid_w"]
    heatmap_t, offset_t, size_t, angle_t, mask = _targets_to_tensors(targets, grid_h, grid_w)

    model = ObbCenterNet(base_channels=8, stride=stride)
    x = torch.randn(1, 3, canvas, canvas)
    optimizer = torch.optim.Adam(model.parameters(), lr=5e-3)

    def total_loss():
        out = model(x)
        hm_loss = heatmap_focal_loss(out["heatmap"], heatmap_t)
        off_loss = masked_l1_loss(out["offset"], offset_t, mask.expand_as(offset_t))
        size_loss = masked_l1_loss(out["size"], size_t, mask.expand_as(size_t))
        angle_loss = masked_l1_loss(out["angle"], angle_t, mask.expand_as(angle_t))
        return hm_loss + off_loss + size_loss + angle_loss

    initial = total_loss().item()
    for _ in range(60):
        optimizer.zero_grad()
        loss = total_loss()
        loss.backward()
        optimizer.step()
    final = total_loss().item()

    assert final < initial * 0.5, f"expected substantial overfit improvement, got initial={initial} final={final}"
