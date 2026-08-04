/**
 * Run manifest for a zone-layout generation run (#253) — mirrors
 * composites/manifest.ts's buildCompositeManifest exactly (same reused
 * configHash/sha256, same CompositeDatasetManifest/CompositeManifestEntry
 * shape so write.ts/sampleSheet.ts consume it unchanged), just keyed to
 * ZoneLayoutConfig instead of GeneratorConfig — the two config shapes are
 * different enough (zone-layout has no cardsPerComposite/backgroundTypes/
 * etc.) that forcing buildCompositeManifest's GeneratorConfig-typed
 * signature to accept one wouldn't be a real fit, so this is a small,
 * deliberately parallel function rather than a type-unsafe cast.
 */
import { configHash } from "../../qa/manifest.js";
import { sha256 } from "../../benchmark/manifest.js";
import { COMPOSITE_LABEL_SCHEMA_VERSION } from "../types.js";
import { COMPOSITE_MANIFEST_SCHEMA_VERSION } from "../manifest.js";
import type { CompositeDatasetManifest, CompositeManifestEntry } from "../manifest.js";
import type { CompositeLabel } from "../types.js";
import type { ZoneLayoutConfig } from "./planZoneLayout.js";

export interface BuildZoneCompositeManifestOptions {
  config: ZoneLayoutConfig;
  labels: CompositeLabel[];
  now?: () => string;
}

export function buildZoneCompositeManifest(opts: BuildZoneCompositeManifestOptions): CompositeDatasetManifest {
  const now = opts.now ?? (() => new Date().toISOString());

  const composites: CompositeManifestEntry[] = opts.labels.map((label) => ({
    compositeId: label.compositeId,
    fileName: label.fileName,
    cardCount: label.cards.length,
    excludedCards: label.excludedCards,
    cardBacksPlaced: label.cardBacksPlaced,
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
