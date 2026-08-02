import path from "node:path";
import { exportBrainNotes } from "./sources/brains.js";
import { exportRulesChunks } from "./sources/rules.js";
import { exportLoreChunks, readFabloreCommitFromLorePages } from "./sources/lore.js";
import { buildManifest, readLoreCommit } from "./manifest.js";
import { applyShippingModes, loadShippingModes } from "./shippingModes.js";
import type { Chunk, CorpusSnapshotManifest, SkippedEntry, SourceManifestEntry } from "./types.js";

const DEFAULT_IDENTITIES = ["judge", "player", "card-vault"];

/**
 * APP-017: the per-source redistribution-rights assessment (SPEC-APP.md
 * §7.10) is now recorded in `docs/rights-assessment.md`, with the modes it
 * settled on mirrored into `pipeline/config/shipping-modes.json` and read
 * here instead of being hardcoded. This note cites the assessment doc +
 * the actually-recorded mode so a manifest reader sees where the mode came
 * from and that user sign-off on it is still outstanding — see
 * "Awaiting user sign-off" in the assessment doc. Replaces the old
 * "placeholder pending assessment" wording now that an assessment exists.
 */
function rightsNote(mode: string): string {
  return `shipping mode: ${mode} — recorded in docs/rights-assessment.md per SPEC-APP.md §7.10 (APP-017); pending user sign-off`;
}

export interface ExportConfig {
  identitiesRoot: string;
  identities?: string[];
  kbRulesDir: string;
  loreDir: string;
  versionsTxtPath: string;
  setJsonPath: string;
  fabloreDir: string;
  /** Path to the committed §7.10 shipping-mode config
   * (`pipeline/config/shipping-modes.json` in the real pipeline). Every
   * source the exporter produces must have an entry here — see
   * `shippingModes.ts`'s `applyShippingModes`. */
  shippingModesPath: string;
  now?: () => string;
}

export interface ExportResult {
  /** The §7.10-enforced, shipped chunk set: stub-mode sources' chunks have
   * their `text` replaced by the stub marker. This is what `chunks.jsonl`
   * carries. */
  chunks: Chunk[];
  /** The unmodified, full-text chunk set — always full text regardless of
   * shipping mode, for pipeline-internal dataset generation and stub-chunk
   * embeddings (see `shippingModes.ts`'s doc comment). This is what
   * `chunks-fulltext.jsonl` carries. */
  chunksFullText: Chunk[];
  manifest: CorpusSnapshotManifest;
}

/**
 * Runs the full corpus export (SPEC-APP.md §7.1-§7.2): brain notes + rules
 * KB chunks + lore pages, normalized into one chunk set with a stamped
 * snapshot manifest. Pure orchestration — each source module owns its own
 * chunk_id scheme and per-entry/per-source graceful-degradation behavior
 * (see brains.ts, rules.ts, lore.ts): a broken symlink, an unreadable file,
 * or a malformed record skips just that one entry, and a whole source being
 * unusable (e.g. kb/rules absent) skips just that source — neither ever
 * aborts the rest of the export.
 */
export function runExport(config: ExportConfig): ExportResult {
  const identities = config.identities ?? DEFAULT_IDENTITIES;
  const modes = loadShippingModes(config.shippingModesPath);
  const brains = exportBrainNotes(config.identitiesRoot, identities);
  const rules = exportRulesChunks(config.kbRulesDir);
  const lore = exportLoreChunks(config.loreDir);

  // Full-text chunk set: every source's real text regardless of shipping
  // mode. This feeds the manifest's contentHash/chunkCount (a source's
  // shipping mode changing is a redistribution-policy decision, not new
  // corpus content, and shouldn't perturb the content hash — see
  // docs/rights-assessment.md's "Exporter enforcement" section) and
  // ExportResult.chunksFullText (chunks-fulltext.jsonl).
  const chunks: Chunk[] = [...brains.chunks, ...rules.chunks, ...lore.chunks];

  const fabloreFallback = readFabloreCommitFromLorePages(config.loreDir);
  const loreCommit = readLoreCommit(config.fabloreDir, fabloreFallback);

  const sources: SourceManifestEntry[] = [
    ...identities.map((identity): SourceManifestEntry => {
      const identitySkipped = brains.skipped.filter((s) =>
        s.path.startsWith(identityNotesDirPrefix(config.identitiesRoot, identity)),
      );
      const name = `${identity}-brain`;
      const mode = requireMode(modes, name, config.shippingModesPath);
      return {
        name,
        count: brains.countsByIdentity[identity] ?? 0,
        shippingMode: mode,
        skipped: identitySkipped.length,
        note: joinNotes([rightsNote(mode), skippedNote(identitySkipped)]),
      };
    }),
    rules.missing
      ? {
          name: "rules-kb",
          count: 0,
          shippingMode: requireMode(modes, "rules-kb", config.shippingModesPath),
          skipped: 0,
          note: joinNotes([
            rulesGraceNote(rules.missingReason),
            rightsNote(requireMode(modes, "rules-kb", config.shippingModesPath)),
          ]),
        }
      : {
          name: "rules-kb",
          count: rules.chunks.length,
          shippingMode: requireMode(modes, "rules-kb", config.shippingModesPath),
          skipped: rules.skipped.length,
          note: joinNotes([
            rightsNote(requireMode(modes, "rules-kb", config.shippingModesPath)),
            skippedNote(rules.skipped),
          ]),
        },
    {
      name: "lore",
      count: lore.chunks.length,
      shippingMode: requireMode(modes, "lore", config.shippingModesPath),
      skipped: lore.skipped.length,
      note: joinNotes([
        rightsNote(requireMode(modes, "lore", config.shippingModesPath)),
        skippedNote(lore.skipped),
      ]),
    },
  ];

  const { shipped, fullText } = applyShippingModes(chunks, modes);

  const manifest = buildManifest({
    chunks,
    shippedChunks: shipped,
    versionsTxtPath: config.versionsTxtPath,
    setJsonPath: config.setJsonPath,
    kbRulesDir: config.kbRulesDir,
    loreCommit,
    sources,
    now: config.now,
  });

  return { chunks: shipped, chunksFullText: fullText, manifest };
}

/**
 * Looks up a source's configured shipping mode, throwing a clear,
 * actionable error (never silently defaulting to verbatim) when it's
 * missing — the manifest-building "config-assessment consistency check":
 * every source the exporter is capable of producing must have an entry in
 * `pipeline/config/shipping-modes.json`, whether or not it produced any
 * chunks this run (an empty rules-kb source still needs a recorded mode).
 */
function requireMode(
  modes: Record<string, string>,
  name: string,
  shippingModesPath: string,
): "verbatim" | "paraphrase" | "stub" {
  const mode = modes[name];
  if (!mode) {
    throw new Error(
      `runExport: no shipping mode configured for source "${name}" in ${shippingModesPath} — ` +
        `add it and record the rationale in docs/rights-assessment.md before it can export (SPEC-APP.md §7.10)`,
    );
  }
  return mode as "verbatim" | "paraphrase" | "stub";
}

function identityNotesDirPrefix(identitiesRoot: string, identity: string): string {
  return path.join(identitiesRoot, identity, "brain", "notes") + path.sep;
}

function rulesGraceNote(missingReason: string | undefined): string {
  if (missingReason === "absent" || !missingReason) {
    return "kb/rules absent (rebuildable via `fab-cli rules sync`) — skipped, no network sync run";
  }
  return `kb/rules/index.json unusable (${missingReason}) — skipped, no network sync run`;
}

function skippedNote(skipped: SkippedEntry[]): string | undefined {
  if (skipped.length === 0) return undefined;
  const shown = skipped
    .slice(0, 5)
    .map((s) => `${s.path} (${s.reason})`)
    .join("; ");
  const more = skipped.length > 5 ? `, +${skipped.length - 5} more` : "";
  return `${skipped.length} entr${skipped.length === 1 ? "y" : "ies"} skipped: ${shown}${more}`;
}

function joinNotes(parts: (string | undefined)[]): string | undefined {
  const filtered = parts.filter((p): p is string => Boolean(p && p.length));
  return filtered.length ? filtered.join(" | ") : undefined;
}
