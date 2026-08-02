import fs from "node:fs";
import type { Chunk, ShippingMode } from "./types.js";

/**
 * SPEC-APP.md §7.10 per-source shipping-mode config: source name (matching
 * `SourceManifestEntry.name`, e.g. `judge-brain`, `rules-kb`, `lore`) →
 * shipping mode. The committed real config is `pipeline/config/
 * shipping-modes.json`, rationalized per source in `docs/rights-
 * assessment.md` (APP-017) — this module only loads/enforces it, it does
 * not decide modes itself.
 */
export type ShippingModeConfig = Record<string, ShippingMode>;

const VALID_MODES: ShippingMode[] = ["verbatim", "paraphrase", "stub"];

/**
 * Reads a shipping-modes config file. Keys starting with `_` (e.g.
 * `_comment`) are ignored — this mirrors the `_comment` convention already
 * used by `pipeline/config/dataset-build.json` and `rejection-sampling.json`
 * — everything else must be a valid `ShippingMode` string, or this throws
 * immediately: a typo'd mode in committed config should fail loudly at load
 * time, not silently pass an invalid mode through to `applyShippingModes`.
 */
export function loadShippingModes(configPath: string): ShippingModeConfig {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const modes: ShippingModeConfig = {};
  for (const [source, mode] of Object.entries(parsed)) {
    if (source.startsWith("_")) continue;
    if (typeof mode !== "string" || !VALID_MODES.includes(mode as ShippingMode)) {
      throw new Error(
        `${configPath}: source "${source}" has invalid shipping mode ${JSON.stringify(mode)} — must be one of ${VALID_MODES.join(", ")}`,
      );
    }
    modes[source] = mode as ShippingMode;
  }
  return modes;
}

/**
 * Derives the manifest source name (matching `SourceManifestEntry.name`) a
 * chunk belongs to, from its stable `chunk_id` prefix — the same scheme
 * each `sources/*.ts` module documents on its own `chunk_id` construction:
 * `brain/<identity>/<slug>` → `<identity>-brain`, `rules/<document>/
 * <section>` → `rules-kb`, `lore/<path>` → `lore`. Throws on an
 * unrecognized chunk_id scheme rather than guessing — a chunk export.ts
 * doesn't know how to attribute to a source is exactly the kind of gap
 * §7.10 enforcement must not paper over.
 */
export function sourceNameForChunk(chunkId: string): string {
  if (chunkId.startsWith("brain/")) {
    const identity = chunkId.split("/")[1];
    if (!identity) throw new Error(`sourceNameForChunk: malformed brain chunk_id "${chunkId}"`);
    return `${identity}-brain`;
  }
  if (chunkId.startsWith("rules/")) return "rules-kb";
  if (chunkId.startsWith("lore/")) return "lore";
  throw new Error(`sourceNameForChunk: unrecognized chunk_id scheme "${chunkId}"`);
}

/** Stub marker replacing a stub-mode chunk's `text` in the shipped chunk
 * set. Deliberately not the chunk's real text in any form (not truncated,
 * not summarized) — SPEC-APP.md §7.10 says stub mode ships "title + tags +
 * source_url", nothing of the body. */
export const STUB_TEXT_MARKER =
  "[retrieval stub — full text not shipped; source cited via `source`. See SPEC-APP.md §7.10.]";

export interface ShippingModeEnforcementResult {
  /** The chunk set with each source's recorded mode actually applied:
   * stub-mode chunks keep chunk_id/title/tags/source but have their `text`
   * replaced by `STUB_TEXT_MARKER`. This is what ships as `chunks.jsonl` —
   * the file any downstream knowledge-pack build or runtime distribution
   * reads. */
  shipped: Chunk[];
  /** The unmodified input chunk set — every chunk's real text, regardless
   * of shipping mode. Pipeline-internal only (§7.3-§7.9 dataset generation,
   * §7.10 stub-chunk embeddings computed from full text at pack-build
   * time); never the thing that ships. This is what `chunks-fulltext.jsonl`
   * carries. */
  fullText: Chunk[];
}

/**
 * Enforces §7.10 shipping modes on a chunk set for real, not just as a
 * manifest label: every chunk's source is derived (`sourceNameForChunk`)
 * and looked up in `modes`. A chunk whose derived source has no entry in
 * `modes` is a loud failure (thrown, not defaulted to verbatim) — shipping
 * unassessed content verbatim by default would defeat the whole point of
 * the redistribution-rights assessment this enforces
 * (`docs/rights-assessment.md`).
 */
export function applyShippingModes(
  chunks: Chunk[],
  modes: ShippingModeConfig,
): ShippingModeEnforcementResult {
  const shipped: Chunk[] = chunks.map((chunk) => {
    const source = sourceNameForChunk(chunk.chunk_id);
    const mode = modes[source];
    if (!mode) {
      throw new Error(
        `applyShippingModes: no shipping mode configured for source "${source}" ` +
          `(chunk_id "${chunk.chunk_id}") — add it to pipeline/config/shipping-modes.json ` +
          `and record the rationale in docs/rights-assessment.md before it can export`,
      );
    }
    return mode === "stub" ? { ...chunk, text: STUB_TEXT_MARKER } : chunk;
  });
  return { shipped, fullText: chunks };
}
