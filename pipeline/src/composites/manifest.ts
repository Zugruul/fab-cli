/**
 * Dataset manifest for one synthetic-composite generation run (SPEC-APP.md
 * §8.7b, APP-026 AC: "dataset manifest" — generator config hash, seed,
 * counts, per-composite label-file hashes). Mirrors benchmark/manifest.ts
 * and dataset/manifest.ts's conventions: reuse configHash (qa/manifest.ts)
 * and sha256 (benchmark/manifest.ts) rather than reinventing hashing.
 */
import { configHash } from "../qa/manifest.js";
import { sha256 } from "../benchmark/manifest.js";
import { COMPOSITE_LABEL_SCHEMA_VERSION } from "./types.js";
import type { GeneratorConfig } from "./config.js";
import type { CompositeLabel } from "./types.js";

export const COMPOSITE_MANIFEST_SCHEMA_VERSION = "0.1.0";

export interface CompositeManifestEntry {
  compositeId: string;
  fileName: string;
  cardCount: number;
  /** sha256 of the label file's exact on-disk bytes (write.ts writes
   * `JSON.stringify(label, null, 2) + "\n"` — the same bytes hashed here). */
  labelFileHash: string;
}

export interface CompositeDatasetManifest {
  schemaVersion: string;
  /** The COMPOSITE_LABEL_SCHEMA_VERSION every label in this run was
   * written under (PR #246 review round 1, mirrors benchmark/manifest.ts's
   * labelSchemaVersion) — stamped so a future reader can tell which label
   * shape ("procedural:<type>"/"external" backgroundType + backgroundHash,
   * #244) a run's label files were produced with, without inspecting any
   * individual label. No read-time version branching is added here — this
   * only makes the version observable in the artifact. */
  labelSchemaVersion: string;
  buildDate: string;
  seed: number;
  /** SHA-256 of the committed composites-generation.json (or whatever
   * config object was actually used) — reuses qa/manifest.ts's
   * configHash, same as dataset/manifest.ts and behavior/manifest.ts. */
  generatorConfigHash: string;
  compositeCount: number;
  composites: CompositeManifestEntry[];
}

export interface BuildCompositeManifestOptions {
  config: GeneratorConfig;
  labels: CompositeLabel[];
  now?: () => string;
}

export function buildCompositeManifest(opts: BuildCompositeManifestOptions): CompositeDatasetManifest {
  const now = opts.now ?? (() => new Date().toISOString());

  const composites: CompositeManifestEntry[] = opts.labels.map((label) => ({
    compositeId: label.compositeId,
    fileName: label.fileName,
    cardCount: label.cards.length,
    labelFileHash: sha256(Buffer.from(JSON.stringify(label, null, 2) + "\n")),
  }));

  return {
    schemaVersion: COMPOSITE_MANIFEST_SCHEMA_VERSION,
    labelSchemaVersion: COMPOSITE_LABEL_SCHEMA_VERSION,
    buildDate: now(),
    seed: opts.config.seed,
    generatorConfigHash: configHash(opts.config),
    compositeCount: composites.length,
    composites,
  };
}
