import path from "node:path";
import { exportBrainNotes } from "./sources/brains.js";
import { exportRulesChunks } from "./sources/rules.js";
import { exportLoreChunks, readFabloreCommitFromLorePages } from "./sources/lore.js";
import { buildManifest, readLoreCommit } from "./manifest.js";
import type { Chunk, CorpusSnapshotManifest, SkippedEntry, SourceManifestEntry } from "./types.js";

const DEFAULT_IDENTITIES = ["judge", "player", "card-vault"];

// SPEC-APP.md §7.10: "the outcome is recorded per source in the corpus
// snapshot manifest" — every source's shippingMode below is a placeholder
// until APP-017 runs the real per-source redistribution-rights assessment,
// so that pending-ness is stamped into every source's note, always, not
// just left as a code comment a manifest reader would never see.
const PENDING_RIGHTS_NOTE =
  "shipping mode is a placeholder pending the APP-017 per-source redistribution-rights assessment (SPEC-APP.md §7.10)";

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
 * chunk_id scheme and per-entry/per-source graceful-degradation behavior
 * (see brains.ts, rules.ts, lore.ts): a broken symlink, an unreadable file,
 * or a malformed record skips just that one entry, and a whole source being
 * unusable (e.g. kb/rules absent) skips just that source — neither ever
 * aborts the rest of the export.
 */
export function runExport(config: ExportConfig): ExportResult {
  const identities = config.identities ?? DEFAULT_IDENTITIES;
  const brains = exportBrainNotes(config.identitiesRoot, identities);
  const rules = exportRulesChunks(config.kbRulesDir);
  const lore = exportLoreChunks(config.loreDir);

  // Lore chunks intentionally carry their FULL page text at this export
  // stage even though the manifest records lore's default shippingMode as
  // "stub" (§7.10) — §7.3-§7.9 (Q&A/behavior/DPO dataset generation) need
  // the full text to generate against. Truncating to a title+tags+
  // source_url stub happens later, at knowledge-pack build time (§8.8),
  // not here.
  const chunks: Chunk[] = [...brains.chunks, ...rules.chunks, ...lore.chunks];

  const fabloreFallback = readFabloreCommitFromLorePages(config.loreDir);
  const loreCommit = readLoreCommit(config.fabloreDir, fabloreFallback);

  const sources: SourceManifestEntry[] = [
    ...identities.map((identity): SourceManifestEntry => {
      const identitySkipped = brains.skipped.filter((s) =>
        s.path.startsWith(identityNotesDirPrefix(config.identitiesRoot, identity)),
      );
      return {
        name: `${identity}-brain`,
        count: brains.countsByIdentity[identity] ?? 0,
        // Own-authored brain notes default to shipping verbatim.
        shippingMode: "verbatim",
        skipped: identitySkipped.length,
        note: joinNotes([PENDING_RIGHTS_NOTE, skippedNote(identitySkipped)]),
      };
    }),
    rules.missing
      ? {
          name: "rules-kb",
          count: 0,
          shippingMode: "verbatim",
          skipped: 0,
          note: joinNotes([rulesGraceNote(rules.missingReason), PENDING_RIGHTS_NOTE]),
        }
      : {
          name: "rules-kb",
          count: rules.chunks.length,
          shippingMode: "verbatim",
          skipped: rules.skipped.length,
          note: joinNotes([PENDING_RIGHTS_NOTE, skippedNote(rules.skipped)]),
        },
    {
      name: "lore",
      count: lore.chunks.length,
      // §7.10 default pending assessment: lore prose ships as retrieval stubs.
      shippingMode: "stub",
      skipped: lore.skipped.length,
      note: joinNotes([PENDING_RIGHTS_NOTE, skippedNote(lore.skipped)]),
    },
  ];

  const manifest = buildManifest({
    chunks,
    versionsTxtPath: config.versionsTxtPath,
    setJsonPath: config.setJsonPath,
    kbRulesDir: config.kbRulesDir,
    loreCommit,
    sources,
    now: config.now,
  });

  return { chunks, manifest };
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
