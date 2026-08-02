import { exportBrainNotes } from "./sources/brains.js";
import { exportRulesChunks } from "./sources/rules.js";
import { exportLoreChunks, readFabloreCommitFromLorePages } from "./sources/lore.js";
import { buildManifest, readLoreCommit } from "./manifest.js";
import type { Chunk, CorpusSnapshotManifest, SourceManifestEntry } from "./types.js";

const DEFAULT_IDENTITIES = ["judge", "player", "card-vault"];

export interface ExportConfig {
  identitiesRoot: string;
  identities?: string[];
  kbRulesDir: string;
  loreDir: string;
  versionsTxtPath: string;
  setJsonPath: string;
  fabloreDir: string;
  now?: () => string;
}

export interface ExportResult {
  chunks: Chunk[];
  manifest: CorpusSnapshotManifest;
}

/**
 * Runs the full corpus export (SPEC-APP.md §7.1-§7.2): brain notes + rules
 * KB chunks + lore pages, normalized into one chunk set with a stamped
 * snapshot manifest. Pure orchestration — each source module owns its own
 * chunk_id scheme and graceful-degradation behavior (see brains.ts,
 * rules.ts, lore.ts).
 */
export function runExport(config: ExportConfig): ExportResult {
  const identities = config.identities ?? DEFAULT_IDENTITIES;
  const brains = exportBrainNotes(config.identitiesRoot, identities);
  const rules = exportRulesChunks(config.kbRulesDir);
  const lore = exportLoreChunks(config.loreDir);

  const chunks: Chunk[] = [...brains.chunks, ...rules.chunks, ...lore.chunks];

  const fabloreFallback = readFabloreCommitFromLorePages(config.loreDir);
  const loreCommit = readLoreCommit(config.fabloreDir, fabloreFallback);

  const sources: SourceManifestEntry[] = [
    ...identities.map(
      (identity): SourceManifestEntry => ({
        name: `${identity}-brain`,
        count: brains.countsByIdentity[identity] ?? 0,
        // Placeholder pending APP-017's per-source redistribution-rights
        // assessment (SPEC-APP.md §7.10) — own-authored brain notes default
        // to shipping verbatim.
        shippingMode: "verbatim",
      }),
    ),
    rules.missing
      ? {
          name: "rules-kb",
          count: 0,
          shippingMode: "verbatim",
          note: "kb/rules absent (rebuildable via `fab-cli rules sync`) — skipped, no network sync run",
        }
      : { name: "rules-kb", count: rules.chunks.length, shippingMode: "verbatim" },
    {
      name: "lore",
      count: lore.chunks.length,
      // §7.10 default pending assessment: lore prose ships as retrieval stubs.
      shippingMode: "stub",
    },
  ];

  const manifest = buildManifest({
    chunks,
    versionsTxtPath: config.versionsTxtPath,
    setJsonPath: config.setJsonPath,
    loreCommit,
    sources,
    now: config.now,
  });

  return { chunks, manifest };
}
