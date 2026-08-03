"""Training/export config schema for the recognition embedder (APP-028).
Mirrors config.py's role for the detector (collect every violation, a
closed architecture enum) but is a SEPARATE module/enum from config.py's
KNOWN_ARCHITECTURES — the embedder's config shape (cropSize, embeddingDim,
arcface.{margin,scale}) shares nothing with the detector's (stride,
canvasSize), so sharing one validator/enum between the two jobs would
only create false coupling. Reuses config.py's ConfigResult dataclass
directly (a generic {valid, config, errors} shape with no detector-
specific assumptions).
"""
from typing import Any, List, Union

from .config import ConfigResult

EMBEDDER_ARCHITECTURES = {"arcface-embedder-tiny"}


def _err(errors: List[str], msg: str) -> None:
    errors.append(msg)


def validate_embed_config(raw: Union[dict, Any]) -> ConfigResult:
    errors: List[str] = []
    if not isinstance(raw, dict):
        return ConfigResult(valid=False, errors=["config is not a JSON object"])

    architecture = raw.get("architecture")
    if architecture not in EMBEDDER_ARCHITECTURES:
        _err(errors, f'"architecture" must be one of {sorted(EMBEDDER_ARCHITECTURES)} (got {architecture!r})')

    seed = raw.get("seed")
    if not isinstance(seed, int) or isinstance(seed, bool):
        _err(errors, '"seed" must be an integer')

    dataset_dir = raw.get("datasetDir")
    if not isinstance(dataset_dir, str) or dataset_dir == "":
        _err(errors, '"datasetDir" must be a non-empty string')

    val_fraction = raw.get("valFraction")
    if not isinstance(val_fraction, (int, float)) or isinstance(val_fraction, bool) or not (0.0 <= val_fraction < 1.0):
        _err(errors, '"valFraction" must be a number in [0, 1)')

    crop_size = raw.get("cropSize")
    if not isinstance(crop_size, int) or isinstance(crop_size, bool) or crop_size <= 0:
        _err(errors, '"cropSize" must be a positive integer')

    embedding_dim = raw.get("embeddingDim")
    if not isinstance(embedding_dim, int) or isinstance(embedding_dim, bool) or embedding_dim <= 0:
        _err(errors, '"embeddingDim" must be a positive integer')

    arcface = raw.get("arcface")
    if not isinstance(arcface, dict):
        _err(errors, '"arcface" must be an object {margin, scale}')
    else:
        margin = arcface.get("margin")
        if not isinstance(margin, (int, float)) or isinstance(margin, bool) or margin < 0:
            _err(errors, '"arcface.margin" must be a non-negative number')
        scale = arcface.get("scale")
        if not isinstance(scale, (int, float)) or isinstance(scale, bool) or scale <= 0:
            _err(errors, '"arcface.scale" must be a positive number')

    train = raw.get("train")
    if not isinstance(train, dict):
        _err(errors, '"train" must be an object {epochs, batchSize, lr}')
    else:
        epochs = train.get("epochs")
        if not isinstance(epochs, int) or isinstance(epochs, bool) or epochs <= 0:
            _err(errors, '"train.epochs" must be a positive integer')
        batch_size = train.get("batchSize")
        if not isinstance(batch_size, int) or isinstance(batch_size, bool) or batch_size <= 0:
            _err(errors, '"train.batchSize" must be a positive integer')
        lr = train.get("lr")
        if not isinstance(lr, (int, float)) or isinstance(lr, bool) or lr <= 0:
            _err(errors, '"train.lr" must be a positive number')

    output_dir = raw.get("outputDir")
    if not isinstance(output_dir, str) or output_dir == "":
        _err(errors, '"outputDir" must be a non-empty string')

    if errors:
        return ConfigResult(valid=False, errors=errors)
    return ConfigResult(valid=True, config=raw)


def validate_embed_export_config(raw: Union[dict, Any]) -> ConfigResult:
    """Config schema for embed_export.py's torch -> int8 tflite chain: an
    already-trained checkpoint, the crop size/embedding dim the checkpoint
    was trained with, a representative-dataset dir + sample count for
    int8 calibration, and where to write the .tflite file."""
    errors: List[str] = []
    if not isinstance(raw, dict):
        return ConfigResult(valid=False, errors=["config is not a JSON object"])

    architecture = raw.get("architecture")
    if architecture not in EMBEDDER_ARCHITECTURES:
        _err(errors, f'"architecture" must be one of {sorted(EMBEDDER_ARCHITECTURES)} (got {architecture!r})')

    checkpoint_path = raw.get("checkpointPath")
    if not isinstance(checkpoint_path, str) or checkpoint_path == "":
        _err(errors, '"checkpointPath" must be a non-empty string')

    crop_size = raw.get("cropSize")
    if not isinstance(crop_size, int) or isinstance(crop_size, bool) or crop_size <= 0:
        _err(errors, '"cropSize" must be a positive integer')

    embedding_dim = raw.get("embeddingDim")
    if not isinstance(embedding_dim, int) or isinstance(embedding_dim, bool) or embedding_dim <= 0:
        _err(errors, '"embeddingDim" must be a positive integer')

    representative_dataset_dir = raw.get("representativeDatasetDir")
    if not isinstance(representative_dataset_dir, str) or representative_dataset_dir == "":
        _err(errors, '"representativeDatasetDir" must be a non-empty string')

    num_representative_samples = raw.get("numRepresentativeSamples")
    if not isinstance(num_representative_samples, int) or isinstance(num_representative_samples, bool) or num_representative_samples <= 0:
        _err(errors, '"numRepresentativeSamples" must be a positive integer')

    output_path = raw.get("outputPath")
    if not isinstance(output_path, str) or output_path == "":
        _err(errors, '"outputPath" must be a non-empty string')

    if errors:
        return ConfigResult(valid=False, errors=errors)
    return ConfigResult(valid=True, config=raw)
