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
import os

import numpy as np
import pytest

from train_vision.embed_export import export_from_config
from train_vision.embed_train import train_from_config

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run")
CROP_SIZE = 16
EMBEDDING_DIM = 8


def _train_a_tiny_checkpoint(output_dir: str) -> str:
    config = {
        "architecture": "arcface-embedder-tiny",
        "seed": 3,
        "datasetDir": FIXTURE_DIR,
        "valFraction": 0.25,
        "cropSize": CROP_SIZE,
        "embeddingDim": EMBEDDING_DIM,
        "arcface": {"margin": 0.3, "scale": 16.0},
        "train": {"epochs": 1, "batchSize": 2, "lr": 0.001},
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
