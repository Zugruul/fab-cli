import fs from "node:fs";
import path from "node:path";
import { extractWikilinks } from "../links.js";
import type { Chunk, SkippedEntry } from "../types.js";

export interface RulesSourceResult {
  chunks: Chunk[];
  /** True when `kb/rules/index.json` could not be used at all — either not
   * found (kb/rules is a rebuildable, gitignored cache — `fab-cli rules
   * sync` — so absence is expected and gracefully handled, never a trigger
   * to run a network sync itself) or found but not valid JSON. */
  missing: boolean;
  /** Why `missing` is true: "absent" vs. "corrupt JSON: <parse error>". */
  missingReason?: string;
  /** Individual `index.json` chunk entries that were malformed (e.g.
   * missing a required field) and were skipped rather than aborting the
   * whole rules source. */
  skipped: SkippedEntry[];
}

interface RulesIndexChunk {
  document: string;
  section: string;
  title: string;
  sourceUrl: string;
  text: string;
}

/**
 * Reads the pre-built `kb/rules/index.json` (produced by `fab-cli rules
 * sync`) and maps each chunk 1:1 to a corpus chunk. chunk_id scheme:
 * `rules/<document>/<section>` (lowercased) — mirrors `fab-cli rules show
 * <document>/<section>`'s own ref format, so ids stay meaningful and stable
 * across re-syncs of unchanged sections.
 */
export function exportRulesChunks(kbRulesDir: string): RulesSourceResult {
  const indexPath = path.join(kbRulesDir, "index.json");
  let raw: string;
  try {
    raw = fs.readFileSync(indexPath, "utf8");
  } catch {
    return { chunks: [], missing: true, missingReason: "absent", skipped: [] };
  }

  let index: { chunks: RulesIndexChunk[] };
  try {
    index = JSON.parse(raw) as { chunks: RulesIndexChunk[] };
  } catch (err) {
    return {
      chunks: [],
      missing: true,
      missingReason: `corrupt JSON: ${errorMessage(err)}`,
      skipped: [],
    };
  }

  const chunks: Chunk[] = [];
  const skipped: SkippedEntry[] = [];

  (index.chunks ?? []).forEach((c, i) => {
    // Isolate each entry: a malformed record (missing a required field,
    // wrong type) skips just that one chunk rather than aborting the whole
    // rules-KB source.
    try {
      if (typeof c.document !== "string" || typeof c.section !== "string") {
        throw new Error(
          `entry missing required "document"/"section" string field (got document=${JSON.stringify(c.document)}, section=${JSON.stringify(c.section)})`,
        );
      }
      chunks.push({
        chunk_id: `rules/${c.document.toLowerCase()}/${c.section.toLowerCase()}`,
        text: c.text,
        title: c.title,
        source: c.sourceUrl,
        links: extractWikilinks(c.text),
        tags: [c.document.toLowerCase(), "rules"],
      });
    } catch (err) {
      skipped.push({ path: `${indexPath}#${i}`, reason: errorMessage(err) });
    }
  });

  return { chunks, missing: false, skipped };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
