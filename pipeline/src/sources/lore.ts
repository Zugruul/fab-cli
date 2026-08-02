import fs from "node:fs";
import path from "node:path";
import { parseNote } from "../frontmatter.js";
import { extractWikilinks } from "../links.js";
import type { Chunk } from "../types.js";

export interface LoreSourceResult {
  chunks: Chunk[];
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

  for (const filePath of walkMarkdownFiles(loreDir)) {
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
  }

  return { chunks };
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
    const raw = fs.readFileSync(filePath, "utf8");
    const { frontmatter } = parseNote(raw);
    if (typeof frontmatter.fablore_commit === "string") {
      return frontmatter.fablore_commit;
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
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield full;
    }
  }
}
