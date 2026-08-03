"""Single-class mAP (average precision) over rotated IoU matches (APP-027,
SPEC-APP.md §8.7c AC: "mAP on synthetic val ... reported"). Ground truth
here always comes from encode.py's `raw_obbs` (unclamped, amodal) — see
this module's doc comment for why matching must never clamp either side.
"""
import pytest

from train_vision.map_eval import average_precision, compute_map


def test_average_precision_perfect_predictions_is_one():
    # One image, one GT box, one prediction that exactly matches it.
    gts = {"img1": [(50.0, 50.0, 20.0, 10.0, 0.0)]}
    preds = [{"image_id": "img1", "box": (50.0, 50.0, 20.0, 10.0, 0.0), "score": 0.9}]
    ap = average_precision(preds, gts, iou_threshold=0.5)
    assert ap == pytest.approx(1.0)


def test_average_precision_no_predictions_is_zero():
    gts = {"img1": [(50.0, 50.0, 20.0, 10.0, 0.0)]}
    ap = average_precision([], gts, iou_threshold=0.5)
    assert ap == pytest.approx(0.0)


def test_average_precision_false_positive_with_no_matching_gt_hurts_precision():
    gts = {"img1": [(50.0, 50.0, 20.0, 10.0, 0.0)]}
    preds = [
        {"image_id": "img1", "box": (50.0, 50.0, 20.0, 10.0, 0.0), "score": 0.9},
        {"image_id": "img1", "box": (500.0, 500.0, 20.0, 10.0, 0.0), "score": 0.8},  # spurious FP, far away
    ]
    ap = average_precision(preds, gts, iou_threshold=0.5)
    # First (higher-score) prediction is a true positive (precision=1,
    # recall=1); second is a false positive with no GT left to match
    # (precision=0.5, recall stays 1). AP = area under a PR curve of
    # points (recall=1, precision=1) then (recall=1, precision=0.5) using
    # the standard "precision envelope" integration: max precision at
    # recall>=r for every recall level. At recall=1 the max precision seen
    # so far (either point) is 1.0, so AP == 1.0 exactly — a real detector
    # is never penalized in AP for a low-confidence FP that doesn't reduce
    # achievable recall.
    assert ap == pytest.approx(1.0)


def test_average_precision_missed_gt_caps_recall_below_one():
    gts = {"img1": [(50.0, 50.0, 20.0, 10.0, 0.0), (200.0, 200.0, 20.0, 10.0, 0.0)]}
    preds = [{"image_id": "img1", "box": (50.0, 50.0, 20.0, 10.0, 0.0), "score": 0.9}]
    ap = average_precision(preds, gts, iou_threshold=0.5)
    # Only 1 of 2 GTs ever gets matched -> recall tops out at 0.5, so AP
    # (area under the PR curve, recall axis in [0,1]) must be well below 1.
    assert ap == pytest.approx(0.5)


def test_average_precision_low_iou_match_below_threshold_counts_as_false_positive():
    gts = {"img1": [(50.0, 50.0, 20.0, 10.0, 0.0)]}
    # Shifted far enough that IoU < 0.5 against the GT box.
    preds = [{"image_id": "img1", "box": (70.0, 50.0, 20.0, 10.0, 0.0), "score": 0.9}]
    ap = average_precision(preds, gts, iou_threshold=0.5)
    assert ap == pytest.approx(0.0)


def test_average_precision_out_of_canvas_ground_truth_matches_normally():
    # Amodal contract: a GT box with negative coordinates (a card cropped
    # by the canvas edge) must match a correctly-negative-coordinate
    # prediction exactly like any in-canvas box — no special-casing, no
    # clamping either side of the comparison.
    gts = {"img1": [(-30.0, 50.0, 20.0, 10.0, 0.0)]}
    preds = [{"image_id": "img1", "box": (-30.0, 50.0, 20.0, 10.0, 0.0), "score": 0.9}]
    ap = average_precision(preds, gts, iou_threshold=0.5)
    assert ap == pytest.approx(1.0)


def test_average_precision_higher_score_predictions_ranked_first():
    # Two images, each with one GT; a low-score correct prediction and a
    # high-score correct prediction — order must not affect the perfect-AP
    # result, since both are true positives at any threshold.
    gts = {"img1": [(0.0, 0.0, 10.0, 10.0, 0.0)], "img2": [(100.0, 100.0, 10.0, 10.0, 0.0)]}
    preds = [
        {"image_id": "img2", "box": (100.0, 100.0, 10.0, 10.0, 0.0), "score": 0.2},
        {"image_id": "img1", "box": (0.0, 0.0, 10.0, 10.0, 0.0), "score": 0.95},
    ]
    ap = average_precision(preds, gts, iou_threshold=0.5)
    assert ap == pytest.approx(1.0)


def test_compute_map_is_single_class_average_precision_at_default_threshold():
    gts = {"img1": [(50.0, 50.0, 20.0, 10.0, 0.0)]}
    preds = [{"image_id": "img1", "box": (50.0, 50.0, 20.0, 10.0, 0.0), "score": 0.9}]
    result = compute_map(preds, gts, iou_thresholds=[0.5, 0.75])
    assert result["mAP"] == pytest.approx(1.0)
    assert result["perThreshold"]["0.5"] == pytest.approx(1.0)
    assert result["perThreshold"]["0.75"] == pytest.approx(1.0)


def test_compute_map_stricter_threshold_can_reduce_ap_for_an_imperfect_match():
    gts = {"img1": [(50.0, 50.0, 20.0, 10.0, 0.0)]}
    # Slightly offset prediction: IoU is decent but not perfect.
    preds = [{"image_id": "img1", "box": (52.0, 50.0, 20.0, 10.0, 0.0), "score": 0.9}]
    result = compute_map(preds, gts, iou_thresholds=[0.5, 0.95])
    assert result["perThreshold"]["0.5"] == pytest.approx(1.0)
    assert result["perThreshold"]["0.95"] == pytest.approx(0.0)
    assert result["mAP"] == pytest.approx(0.5)


def test_compute_map_handles_images_with_no_ground_truth_and_no_predictions():
    result = compute_map([], {}, iou_thresholds=[0.5])
    assert result["mAP"] == pytest.approx(0.0)
