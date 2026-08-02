import { z } from "zod";

/**
 * SPEC-APP.md §4 Glossary "Delta pack" / §8.8: removed chunk_ids and
 * printing ids between two knowledge-pack versions. REQUIRED — may be
 * empty arrays, but the field itself must always be present so "nothing
 * was removed" is recorded, not silently omitted.
 */
export const TombstonesSchema = z.object({
  chunkIds: z.array(z.string()),
  printingIds: z.array(z.string()),
});
export type Tombstones = z.infer<typeof TombstonesSchema>;

const DeltaPackManifestShape = z.object({
  schemaVersion: z.string().min(1),
  fromVersion: z.string(),
  toVersion: z.string(),
  addedCount: z.number().int().nonnegative(),
  changedCount: z.number().int().nonnegative(),
  tombstones: TombstonesSchema,
  fromTextEmbedderVersion: z.string(),
  toTextEmbedderVersion: z.string(),
  fromVisionEmbedderVersion: z.string(),
  toVisionEmbedderVersion: z.string(),
});

/**
 * §8.8: "IF the version of EITHER embedder (text embedder or image/
 * recognition embedder) changes between snapshots THEN delta packs SHALL
 * be refused by the builder and a full pack forced." The schema encodes
 * that invariant directly — a delta whose from/to embedder version differs
 * (either embedder) fails validation, with the error attributed to the
 * specific `to*EmbedderVersion` field that changed.
 */
export const DeltaPackManifestSchema = DeltaPackManifestShape.superRefine((delta, ctx) => {
  if (delta.fromTextEmbedderVersion !== delta.toTextEmbedderVersion) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toTextEmbedderVersion"],
      message:
        "text embedder version changed between fromVersion and toVersion — delta packs are refused when either embedder version changes (SPEC-APP.md §8.8); build a full pack instead",
    });
  }
  if (delta.fromVisionEmbedderVersion !== delta.toVisionEmbedderVersion) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toVisionEmbedderVersion"],
      message:
        "vision embedder version changed between fromVersion and toVersion — delta packs are refused when either embedder version changes (SPEC-APP.md §8.8); build a full pack instead",
    });
  }
});
export type DeltaPackManifest = z.infer<typeof DeltaPackManifestShape>;
