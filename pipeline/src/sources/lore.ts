import fs from "node:fs";
import path from "node:path";
import { parseNote } from "../frontmatter.js";
import { extractWikilinks } from "../links.js";
import type { Chunk, SkippedEntry } from "../types.js";

export interface LoreSourceResult {
  chunks: Chunk[];
  /** Pages that failed to export (broken symlink, unreadable file) and
   * were skipped instead of crashing the whole export. */
  skipped: SkippedEntry[];
}

/**
 * Walks the committed `lore/**\/*.md` OKF tree and maps each page 1:1 to a
 * corpus chunk. chunk_id scheme: `lore/<path-relative-to-lore-dir-without-
 * extension>` (e.g. `lore/other-characters/lord-sutcliffe`) — lore's
 * frontmatter `section` field is only the top-level category (not unique
 * per page, per legendarystories.net/fablore's OKF generator), so the file
 * path is the stable identity instead.
 *
 * Pages under `lore/archive/**` (superseded/possibly-outdated lore per
 * fab-cli's CLAUDE.md) are tagged `archive` so downstream consumers can
 * filter or de-prioritize them without excluding them from the corpus.
 */
export function exportLoreChunks(loreDir: string): LoreSourceResult {
  const chunks: Chunk[] = [];
  const skipped: SkippedEntry[] = [];

  for (const filePath of walkMarkdownFiles(loreDir)) {
    // Isolate each page: a broken symlink or a file that vanishes mid-walk
    // skips just that one page rather than aborting the whole lore source.
    try {
      const relPath = path.relative(loreDir, filePath).replace(/\\/g, "/");
      const id = relPath.replace(/\.md$/, "");
      const raw = fs.readFileSync(filePath, "utf8");
      const { frontmatter, body } = parseNote(raw);

      const title = typeof frontmatter.title === "string" ? frontmatter.title : id;
      const source = typeof frontmatter.source_url === "string" ? frontmatter.source_url : "";
      const section = typeof frontmatter.section === "string" ? frontmatter.section : null;

      const tags = new Set<string>(["lore"]);
      if (section) tags.add(section);
      if (id.startsWith("archive/")) tags.add("archive");

      chunks.push({
        chunk_id: `lore/${id}`,
        text: body.trim(),
        title,
        source,
        links: extractWikilinks(raw),
        tags: [...tags],
      });
    } catch (err) {
      skipped.push({ path: filePath, reason: errorMessage(err) });
    }
  }

  return { chunks, skipped };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fallback lore-commit lookup used when the `fablore` git submodule isn't
 * checked out (e.g. a CI checkout without submodules): every committed OKF
 * page embeds the fablore commit it was generated from in its own
 * frontmatter, so the corpus can self-report provenance even without git
 * access to the submodule.
 */
export function readFabloreCommitFromLorePages(loreDir: string): string | null {
  for (const filePath of walkMarkdownFiles(loreDir)) {
    // A page unreadable here (e.g. the same broken symlink exportLoreChunks
    // would skip) just isn't a candidate for the fallback — keep scanning
    // rather than letting one bad page abort the lookup.
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const { frontmatter } = parseNote(raw);
      if (typeof frontmatter.fablore_commit === "string") {
        return frontmatter.fablore_commit;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function* walkMarkdownFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdownFiles(full);
    } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) {
      // Symlinks are included (not just entry.isFile()) so a linked page —
      // or a broken link, per the try/catch above/in exportLoreChunks —
      // is actually attempted and its failure recorded, rather than
      // silently vanishing because readdir reports its dirent type as
      // DT_LNK instead of DT_REG.
      yield full;
    }
  }
}
