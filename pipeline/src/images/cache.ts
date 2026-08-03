import path from "node:path";
import type { PrintingImageRef } from "./types.js";

/** Lowercased file extension (including the leading dot) from a URL, with
 * any query string stripped first — "" when the URL has no extension. */
export function extensionFromUrl(url: string): string {
  const withoutQuery = url.split("?")[0];
  const match = /\.([a-zA-Z0-9]+)$/.exec(withoutQuery);
  return match ? `.${match[1].toLowerCase()}` : "";
}

/** Maps a printing to its cache file path, keyed on `printingId` (the
 * printing's own globally-unique identifier — see catalog.ts's doc comment
 * for why this is `unique_id` and not the human-readable print code). */
export function cachePathFor(cacheDir: string, ref: PrintingImageRef): string {
  return path.join(cacheDir, `${ref.printingId}${extensionFromUrl(ref.imageUrl)}`);
}
