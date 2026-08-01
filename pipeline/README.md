# @fab/pipeline

Stub package. This will hold the training + artifact pipeline described in `SPEC-APP.md`
§7–§8: the corpus exporter (brains + rules KB + lore → normalized chunks), teacher-generated
Q&A/behavior/DPO dataset builders, the Unsloth QLoRA fine-tuning + GGUF export chain for the
Qwen3 model tiers, the eval harness, and the release-bundle publisher for model/knowledge
packs. Scaffolding lands starting with task APP-010.
