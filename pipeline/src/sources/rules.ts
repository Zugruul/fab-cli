import fs from "node:fs";
import path from "node:path";
import { extractWikilinks } from "../links.js";
import type { Chunk } from "../types.js";

export interface RulesSourceResult {
  chunks: Chunk[];
  /** True when `kb/rules/index.json` was not found — kb/rules is a
   * rebuildable, gitignored cache (`fab-cli rules sync`), so its absence is
   * an expected, gracefully-handled state, never an exporter failure and
   * never a trigger to run a network sync itself. */
  missing: boolean;
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
    return { chunks: [], missing: true };
  }

  const index = JSON.parse(raw) as { chunks: RulesIndexChunk[] };
  const chunks: Chunk[] = index.chunks.map((c) => ({
    chunk_id: `rules/${c.document.toLowerCase()}/${c.section.toLowerCase()}`,
    text: c.text,
    title: c.title,
    source: c.sourceUrl,
    links: extractWikilinks(c.text),
    tags: [c.document.toLowerCase(), "rules"],
  }));

  return { chunks, missing: false };
}
