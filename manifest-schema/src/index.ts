import {
  CorpusSnapshotManifestSchema,
  type CorpusSnapshotManifest,
} from "./corpusSnapshot.js";
import { ModelPackManifestSchema, type ModelPackManifest } from "./modelPack.js";
import { KnowledgePackManifestSchema, type KnowledgePackManifest } from "./knowledgePack.js";
import { DeltaPackManifestSchema, type DeltaPackManifest } from "./deltaPack.js";
import { RevocationListSchema, type RevocationList } from "./revocationList.js";
import { ConfidenceSchema, type Confidence } from "./confidence.js";
import { EvalScoresSchema, type EvalScores } from "./evalScores.js";
import { BenchmarkResultSchema, type BenchmarkResult } from "./benchmarkResults.js";
import { validate, type ValidationResult } from "./validate.js";

export function validateCorpusSnapshotManifest(
  input: unknown,
): ValidationResult<CorpusSnapshotManifest> {
  return validate(CorpusSnapshotManifestSchema, input);
}

export function validateModelPackManifest(input: unknown): ValidationResult<ModelPackManifest> {
  return validate(ModelPackManifestSchema, input);
}

export function validateKnowledgePackManifest(
  input: unknown,
): ValidationResult<KnowledgePackManifest> {
  return validate(KnowledgePackManifestSchema, input);
}

export function validateDeltaPackManifest(input: unknown): ValidationResult<DeltaPackManifest> {
  return validate(DeltaPackManifestSchema, input);
}

export function validateRevocationList(input: unknown): ValidationResult<RevocationList> {
  return validate(RevocationListSchema, input);
}

export function validateConfidence(input: unknown): ValidationResult<Confidence> {
  return validate(ConfidenceSchema, input);
}

export function validateEvalScores(input: unknown): ValidationResult<EvalScores> {
  return validate(EvalScoresSchema, input);
}

export function validateBenchmarkResult(input: unknown): ValidationResult<BenchmarkResult> {
  return validate(BenchmarkResultSchema, input);
}

export * from "./corpusSnapshot.js";
export * from "./modelPack.js";
export * from "./knowledgePack.js";
export * from "./deltaPack.js";
export * from "./revocationList.js";
export * from "./confidence.js";
export * from "./evalScores.js";
export * from "./benchmarkResults.js";
export * from "./validate.js";
export * from "./fixtures.js";
