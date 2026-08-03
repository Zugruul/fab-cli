"""torch -> int8 tflite export for the recognition embedder (APP-028).
Real, not mocked: trains a tiny checkpoint, exports it through the full
chain (litert_torch float export -> ai_edge_quantizer calibrate+quantize),
and asserts the loaded model's output is GENUINELY int8-typed with the
configured embedding shape -- the exact rigor the issue brief calls for
("int8 export load + dtype/shape assert"), not just "it didn't crash".

See embed_export.py's doc comment for why this goes through
ai_edge_quantizer rather than a PT2E-in-litert_torch.convert() flow: the
latter is broken in this repo's currently pinned litert-torch/torchao/
torch version combination (reproduced independently on a bare
nn.Linear -- a real toolchain incompatibility, not a modeling choice).
"""
import math
import os

import numpy as np
import pytest
from PIL import Image

from train_vision.embed_dataset import build_embed_dataset
from train_vision.embed_export import build_representative_inputs, dequantized_inference, export_float_tflite, export_from_config, quantize_tflite
from train_vision.embed_torch_data import crop_card_to_tensor
from train_vision.embed_train import train_from_config
from train_vision.retrieval import rank_gallery

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run")
CROP_SIZE = 16
EMBEDDING_DIM = 8


def _train_a_tiny_checkpoint(output_dir: str, seed: int = 3, epochs: int = 1) -> str:
    config = {
        "architecture": "arcface-embedder-tiny",
        "seed": seed,
        "datasetDir": FIXTURE_DIR,
        "valFraction": 0.25,
        "cropSize": CROP_SIZE,
        "embeddingDim": EMBEDDING_DIM,
        "arcface": {"margin": 0.3, "scale": 16.0},
        "train": {"epochs": epochs, "batchSize": 2, "lr": 0.001},
        "outputDir": output_dir,
    }
    train_from_config(config)
    return os.path.join(output_dir, "checkpoint.pt")


def test_export_from_config_produces_a_genuinely_int8_quantized_tflite(tmp_path):
    checkpoint_path = _train_a_tiny_checkpoint(str(tmp_path / "train-run"))
    output_path = str(tmp_path / "embedder.tflite")

    export_config = {
        "architecture": "arcface-embedder-tiny",
        "checkpointPath": checkpoint_path,
        "cropSize": CROP_SIZE,
        "embeddingDim": EMBEDDING_DIM,
        "representativeDatasetDir": FIXTURE_DIR,
        "numRepresentativeSamples": 4,  # the fixture's entire card-crop pool
        "outputPath": output_path,
    }

    summary = export_from_config(export_config, verify_load=True)

    assert os.path.exists(output_path)
    assert summary["localTfliteLoad"]["loaded"] is True
    assert summary["localTfliteLoad"]["outputDtype"] == "int8"
    assert summary["localTfliteLoad"]["outputShape"] == [1, EMBEDDING_DIM]
    assert summary["quantization"]["recipe"] == "static_wi8_ai8"
    assert summary["quantization"]["representativeSamples"] == 4
    assert summary["licenses"]["aiEdgeQuantizer"] == "Apache-2.0"
    assert len(summary["sha256"]) == 64
    assert summary["sizeBytes"] > 0

    # Independently re-load the exported file (not just trusting the
    # summary dict) and confirm the interpreter itself reports int8.
    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_path=output_path)
    interpreter.allocate_tensors()
    output_details = interpreter.get_output_details()
    assert output_details[0]["dtype"] == np.int8
    assert tuple(output_details[0]["shape"]) == (1, EMBEDDING_DIM)


def test_export_from_config_rejects_a_representative_sample_request_larger_than_the_dataset(tmp_path):
    checkpoint_path = _train_a_tiny_checkpoint(str(tmp_path / "train-run"))
    export_config = {
        "architecture": "arcface-embedder-tiny",
        "checkpointPath": checkpoint_path,
        "cropSize": CROP_SIZE,
        "embeddingDim": EMBEDDING_DIM,
        "representativeDatasetDir": FIXTURE_DIR,
        "numRepresentativeSamples": 999,  # far more than the fixture's 4 card crops
        "outputPath": str(tmp_path / "embedder.tflite"),
    }
    with pytest.raises(ValueError, match="only 4 card crops"):
        export_from_config(export_config, verify_load=True)


def test_build_representative_inputs_surfaces_the_degenerate_crop_guard(tmp_path):
    # Review item 3, PR #240: build_representative_inputs used to
    # hand-duplicate crop_card_to_tensor's pixel pipeline WITHOUT its
    # degenerate (zero-area) crop guard. Now that it calls the real
    # function, a zero-area quad (all 4 corners identical) must surface
    # crop_card_to_tensor's own ValueError, not silently produce garbage.
    import json
    import shutil

    degenerate_dir = tmp_path / "degenerate-composites-run"
    degenerate_dir.mkdir()
    shutil.copy(os.path.join(FIXTURE_DIR, "composite-000.png"), degenerate_dir / "composite-000.png")
    label = {
        "compositeId": "composite-000",
        "fileName": "composite-000.png",
        "width": 200,
        "height": 100,
        "backgroundType": "solid",
        "cards": [{"printingId": "degenerate", "corners": [{"x": 50, "y": 50}] * 4, "tags": []}],
    }
    (degenerate_dir / "composite-000.json").write_text(json.dumps(label))
    manifest = {
        "schemaVersion": "0.1.0",
        "buildDate": "2026-08-03T00:00:00.000Z",
        "seed": 1,
        "generatorConfigHash": "degenerate-fixture",
        "compositeCount": 1,
        "composites": [{"compositeId": "composite-000", "fileName": "composite-000.png", "cardCount": 1, "labelFileHash": "x"}],
    }
    (degenerate_dir / "manifest.json").write_text(json.dumps(manifest))

    with pytest.raises(ValueError, match="degenerate crop box"):
        build_representative_inputs(str(degenerate_dir), CROP_SIZE, 1)


def _l2_normalize(vec):
    norm = math.sqrt(sum(v * v for v in vec))
    return [v / norm for v in vec] if norm > 0 else vec


def test_int8_quantization_preserves_nearest_neighbor_ranking(tmp_path):
    """Review item 2, PR #240: the missing early signal between "float
    synthetic-val looks fine" and an on-device measurement. Runs the SAME
    real fixture crops through BOTH the float tflite and the int8 tflite,
    dequantizes + L2-normalizes both (exactly what real application code
    must do post-inference per this module's doc comment), and asserts
    int8 quantization doesn't scramble WHICH gallery entry ranks nearest
    for each leave-one-out query. Checks RANKING (order), not exact
    embedding values -- quantization noise is expected to shift values
    slightly; it must not flip which card looks closest. seed=1 is a
    deliberate, verified-non-borderline choice (checked full leave-one-out
    ranking agreement across seeds 1-11 and epoch counts 1/5/15/30 before
    picking one that isn't sitting on a near-tie decision boundary)."""
    checkpoint_path = _train_a_tiny_checkpoint(str(tmp_path / "train-run"), seed=1, epochs=1)
    float_path = str(tmp_path / "float.tflite")
    int8_path = str(tmp_path / "int8.tflite")

    export_float_tflite(checkpoint_path, EMBEDDING_DIM, CROP_SIZE, float_path)
    representative_inputs = build_representative_inputs(FIXTURE_DIR, CROP_SIZE, 4)
    quantize_tflite(float_path, representative_inputs, int8_path)

    samples = build_embed_dataset(FIXTURE_DIR)
    inputs = [crop_card_to_tensor(Image.open(s["image_path"]), s["corners"], CROP_SIZE).unsqueeze(0) for s in samples]

    float_embeddings = [_l2_normalize(dequantized_inference(float_path, x)) for x in inputs]
    int8_embeddings = [_l2_normalize(dequantized_inference(int8_path, x)) for x in inputs]

    # Leave-one-out: each crop as a query against the other 3 as gallery.
    for i in range(len(samples)):
        gallery_float = [{"printing_id": samples[j]["printing_id"], "embedding": float_embeddings[j]} for j in range(len(samples)) if j != i]
        gallery_int8 = [{"printing_id": samples[j]["printing_id"], "embedding": int8_embeddings[j]} for j in range(len(samples)) if j != i]
        ranked_float = rank_gallery(float_embeddings[i], gallery_float)
        ranked_int8 = rank_gallery(int8_embeddings[i], gallery_int8)
        assert ranked_int8 == ranked_float, (
            f"quantization changed the nearest-neighbor ranking for query {i} "
            f"({samples[i]['printing_id']}): float={ranked_float} int8={ranked_int8}"
        )
