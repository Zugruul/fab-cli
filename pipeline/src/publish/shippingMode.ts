/**
 * APP-029 (SPEC-APP.md §7.10, §8.9; issue #141): the publish precondition
 * that "publish dry-run FAILS without the shipping-mode schema field
 * (APP-017's assessment as precondition)". @fab/manifest-schema's
 * CorpusSnapshotManifestSchema already REQUIRES a `shippingMode` on every
 * `sources[]` entry — this module is the publish-time gate that turns that
 * schema failure into a clear, cited refusal, checked BEFORE any pack
 * assembly is attempted (see releasePlan.ts).
 */
import { validateCorpusSnapshotManifest, type CorpusSnapshotManifest } from "@fab/manifest-schema";

export type ShippingModePreconditionResult = { ok: true; manifest: CorpusSnapshotManifest } | { ok: false; reason: string };

export function checkShippingModePrecondition(corpusSnapshotManifestRaw: unknown): ShippingModePreconditionResult {
  const validation = validateCorpusSnapshotManifest(corpusSnapshotManifestRaw);
  if (validation.success) {
    return { ok: true, manifest: validation.data };
  }

  const errorText = JSON.stringify(validation.errors);
  const mentionsShippingMode = errorText.includes("shippingMode");

  const reason = mentionsShippingMode
    ? `publish refused: the corpus snapshot manifest has one or more sources missing a shippingMode ` +
      `(SPEC-APP.md §7.10: no knowledge pack ships without APP-017's per-source redistribution-rights ` +
      `assessment recorded) — schema errors: ${errorText}`
    : `publish refused: the corpus snapshot manifest failed schema validation — schema errors: ${errorText}`;

  return { ok: false, reason };
}
