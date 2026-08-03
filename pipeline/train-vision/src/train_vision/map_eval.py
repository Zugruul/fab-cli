"""Single-class mean average precision (mAP) over rotated-IoU matches
(APP-027, SPEC-APP.md §8.7c AC: "mAP on synthetic val ... reported").
Standard PASCAL-VOC-style all-point interpolated AP, generalized from
axis-aligned IoU to geometry.rotated_iou so it works identically on
rotated/perspective-skewed boxes.

AMODAL CONTRACT: ground truth boxes are matched via rotated_iou exactly as
given — never clamped to any canvas bound. A card whose true extent falls
partly or fully outside a photo/composite is still a legitimate detection
target here (see encode.py's `raw_obbs`, which is this module's intended
ground-truth source); a correct prediction of that box's true extent must
score as a normal match, not be penalized or special-cased for being
"out of frame".
"""
from typing import Any, Dict, List, Sequence, Tuple

from .geometry import rotated_iou

OBB = Tuple[float, float, float, float, float]


def _cumsum(xs: Sequence[int]) -> List[int]:
    out: List[int] = []
    total = 0
    for x in xs:
        total += x
        out.append(total)
    return out


def _ap_from_pr(recall: List[float], precision: List[float]) -> float:
    """All-point interpolation: precision is replaced by its own envelope
    (max precision achievable at any recall >= r), then AP is the area
    under that monotonically non-increasing envelope on [0, 1]."""
    mrec = [0.0] + recall + [1.0]
    mpre = [0.0] + precision + [0.0]
    for i in range(len(mpre) - 2, -1, -1):
        mpre[i] = max(mpre[i], mpre[i + 1])
    ap = 0.0
    for i in range(len(mrec) - 1):
        if mrec[i + 1] != mrec[i]:
            ap += (mrec[i + 1] - mrec[i]) * mpre[i + 1]
    return ap


def average_precision(preds: List[Dict[str, Any]], gts: Dict[str, List[OBB]], iou_threshold: float) -> float:
    """`preds`: list of {image_id, box: (cx,cy,w,h,theta), score}.
    `gts`: {image_id: [(cx,cy,w,h,theta), ...]}. Greedy highest-score-first
    matching, one prediction claims at most one (best-IoU, not-yet-claimed)
    ground-truth box per image — the standard detection-AP protocol."""
    total_gt = sum(len(boxes) for boxes in gts.values())
    if total_gt == 0 or not preds:
        return 0.0

    sorted_preds = sorted(preds, key=lambda p: -p["score"])
    matched = {image_id: [False] * len(boxes) for image_id, boxes in gts.items()}

    tp: List[int] = []
    fp: List[int] = []
    for pred in sorted_preds:
        image_id = pred["image_id"]
        boxes = gts.get(image_id, [])
        claimed = matched.get(image_id, [])
        best_iou = 0.0
        best_idx = -1
        for i, gt_box in enumerate(boxes):
            if claimed[i]:
                continue
            iou = rotated_iou(pred["box"], gt_box)
            if iou > best_iou:
                best_iou = iou
                best_idx = i
        if best_idx >= 0 and best_iou >= iou_threshold:
            claimed[best_idx] = True
            tp.append(1)
            fp.append(0)
        else:
            tp.append(0)
            fp.append(1)

    cum_tp = _cumsum(tp)
    cum_fp = _cumsum(fp)
    recall = [t / total_gt for t in cum_tp]
    precision = [t / (t + f) if (t + f) > 0 else 0.0 for t, f in zip(cum_tp, cum_fp)]
    return _ap_from_pr(recall, precision)


def compute_map(preds: List[Dict[str, Any]], gts: Dict[str, List[OBB]], iou_thresholds: List[float]) -> Dict[str, Any]:
    """Single-class dataset -> mAP == mean AP across `iou_thresholds` (no
    per-class averaging needed, since this detector has exactly one class:
    "card"). `perThreshold` keys are the threshold's str() so the result is
    directly JSON-serializable into the run manifest."""
    per_threshold = {str(t): average_precision(preds, gts, t) for t in iou_thresholds}
    m = sum(per_threshold.values()) / len(per_threshold) if per_threshold else 0.0
    return {"mAP": m, "perThreshold": per_threshold}
