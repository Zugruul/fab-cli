const WIKILINK_RE = /\[\[([a-zA-Z0-9_-]+)\]\]/g;

/** Deduped, sorted `[[slug]]` zettel references found anywhere in `text`
 * (scanning the full note text — body plus any frontmatter free-text
 * values — covers both the "zettel wikilinks" and "frontmatter" cases
 * SPEC-APP.md §7.1 asks links[] to be derived from). */
export function extractWikilinks(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(WIKILINK_RE)) {
    found.add(match[1]);
  }
  return [...found].sort();
}
