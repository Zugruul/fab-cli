/**
 * Official card-back fetch + cache (#253c): the DECK zone gets the real
 * card back (https://cdn.fabtcg.com/uploads/2025/06/cardback_3mm_63x88.png),
 * downloaded and cached exactly like a card image — this module reuses
 * images/downloader.ts's retry/backoff/atomic-write machinery WHOLESALE
 * (no reinvention) by treating the card back as "just another printing
 * ref" keyed on a synthetic printingId, since a card back has no real
 * printing `unique_id` of its own. A permanent fetch failure is loud
 * (throws, citing the reason) — never a fabricated/placeholder image
 * silently standing in for it (lesson: boundary-convention-before-first-
 * test, mirrors price-comparison's real-data-only rule).
 */
import { downloadAll } from "../../images/downloader.js";
import { cachePathFor } from "../../images/cache.js";
import type { DownloadDeps } from "../../images/downloader.js";
import type { PrintingImageRef, DownloadOptions } from "../../images/types.js";
import { DEFAULT_DOWNLOAD_OPTIONS } from "../../images/types.js";

export const CARD_BACK_URL = "https://cdn.fabtcg.com/uploads/2025/06/cardback_3mm_63x88.png";
export const CARD_BACK_PRINTING_ID = "__card_back__";

const CARD_BACK_REF: PrintingImageRef = {
  printingId: CARD_BACK_PRINTING_ID,
  printCode: "CARDBACK",
  cardName: "Official Card Back",
  setId: "",
  imageUrl: CARD_BACK_URL,
};

/**
 * Ensures the official card back is present at `cacheDir`, downloading it
 * if necessary, and returns its cache path. `deps`/`options` mirror
 * images/downloader.ts's own injection contract exactly, so tests never
 * touch real files/network (same discipline as every other IO boundary in
 * this pipeline).
 */
export async function ensureCardBackCached(
  cacheDir: string,
  deps: DownloadDeps,
  options: DownloadOptions = { ...DEFAULT_DOWNLOAD_OPTIONS, cacheDir },
): Promise<string> {
  const [outcome] = await downloadAll([CARD_BACK_REF], { ...options, cacheDir }, deps);
  if (outcome.status === "failed") {
    throw new Error(`ensureCardBackCached: failed to fetch the official card back from ${CARD_BACK_URL}: ${outcome.failureReason ?? "unknown error"}`);
  }
  return cachePathFor(cacheDir, CARD_BACK_REF);
}
