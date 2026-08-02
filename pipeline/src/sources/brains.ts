import fs from "node:fs";
import path from "node:path";
import { parseNote } from "../frontmatter.js";
import { extractWikilinks } from "../links.js";
import type { Chunk } from "../types.js";

export interface BrainSourceResult {
  chunks: Chunk[];
  /** Notes counted per OWNING identity — a symlinked note (e.g. a kw-*
   * keyword note mirrored into judge/player) counts once, against the
   * identity that physically holds the file, never against the identity
   * dir it was merely seen through (SPEC-APP.md §7.1 dedupe rule). */
  countsByIdentity: Record<string, number>;
}

const IDENTITY_FROM_REALPATH_RE = /identities[\\/]([^\\/]+)[\\/]brain[\\/]notes[\\/]/;

/**
 * Reads `<identitiesRoot>/<identity>/brain/notes/*.md` for each identity,
 * resolving symlinks to their real target before building each chunk so a
 * note physically owned by one identity (e.g. card-vault's kw-* keyword
 * corpus, symlinked into judge/player per KEYWORD-SYNC.md) is exported
 * exactly once, attributed to its owning identity — regardless of which
 * identity directory the exporter happened to encounter it through first.
 *
 * chunk_id scheme: `brain/<owning-identity>/<slug>` where `<slug>` is the
 * note's filename without `.md`. This is content-independent (survives body
 * edits) and stable across re-exports since it's derived purely from the
 * resolved file's location.
 */
export function exportBrainNotes(identitiesRoot: string, identities: string[]): BrainSourceResult {
  const chunks: Chunk[] = [];
  const countsByIdentity: Record<string, number> = {};
  const seenRealPaths = new Set<string>();

  for (const identity of identities) {
    countsByIdentity[identity] = countsByIdentity[identity] ?? 0;
    const notesDir = path.join(identitiesRoot, identity, "brain", "notes");
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(notesDir, { withFileTypes: true });
    } catch {
      continue; // identity has no notes directory — nothing to export
    }

    for (const entry of entries) {
      if (!entry.name.endsWith(".md")) continue;
      const filePath = path.join(notesDir, entry.name);
      const realPath = fs.realpathSync(filePath);
      if (seenRealPaths.has(realPath)) continue;
      seenRealPaths.add(realPath);

      const owningIdentity = identityFromRealPath(realPath) ?? identity;
      const slug = entry.name.replace(/\.md$/, "");
      const raw = fs.readFileSync(realPath, "utf8");
      const { frontmatter, body } = parseNote(raw);

      const tags = Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [];
      const source = typeof frontmatter.source === "string" ? frontmatter.source : "";
      const title =
        typeof frontmatter.title === "string" ? frontmatter.title : firstHeadingOrSlug(body, slug);

      chunks.push({
        chunk_id: `brain/${owningIdentity}/${slug}`,
        text: body.trim(),
        title,
        source,
        links: extractWikilinks(raw),
        tags,
      });

      countsByIdentity[owningIdentity] = (countsByIdentity[owningIdentity] ?? 0) + 1;
    }
  }

  return { chunks, countsByIdentity };
}

function identityFromRealPath(realPath: string): string | null {
  const match = IDENTITY_FROM_REALPATH_RE.exec(realPath);
  return match ? match[1] : null;
}

function firstHeadingOrSlug(body: string, slug: string): string {
  const match = /^#{1,6}\s+(.+)$/m.exec(body);
  if (match) return match[1].trim();
  const boldMatch = /^\*\*(.+?)\*\*/m.exec(body);
  if (boldMatch) return boldMatch[1].trim();
  return slug;
}
