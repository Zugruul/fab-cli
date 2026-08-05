/**
 * Coverage report for a #268 coverage-mode run: turns a finished
 * CoverageTracker (see coverageTracker.ts) plus the run's card pool into a
 * human/machine-readable summary. #268 AC: the report must distinguish
 * THREE states that must never collapse into one number —
 *
 *   - `covered`: an eligible printing (i.e. its image was actually
 *     available to draw from) that reached `minAppearances` placements.
 *   - `eligibleButNotPlaced`: an eligible printing whose appearance count
 *     fell short of `minAppearances` — a genuine coverage shortfall
 *     (the run's composite budget was too small, or the printing was
 *     never even downloaded/cached — see the PR #269 note below), NOT an
 *     upstream-download problem.
 *   - `unavailableUpstream`: a printing that was EXCLUDED from the
 *     eligible pool entirely because its image download PERMANENTLY
 *     failed (e.g. a real S3 403/404 — see images/downloader.ts's
 *     summarizeFailedDownloads). Supplied by the caller (composites/
 *     cli.ts) from the download-failures manifest.
 *
 * PR #269 review round 1, BLOCKER 1: the partition above is computed
 * against `fullCatalogPrintingIds` — every printing the-fab-cube knows
 * about — NOT against `availableCards` (whatever's cached right now) union
 * `unavailableUpstream` (whatever a manifest happens to record). Those two
 * inputs can each be INCOMPLETE independently (a partial/`--limit`'d
 * `images:download` run caches only some printings AND overwrites the
 * failures manifest with only what it attempted) — a printing that's
 * neither cached nor recorded as failed used to be invisible to every
 * bucket while the report still claimed full coverage. Now every id in
 * `fullCatalogPrintingIds` lands in EXACTLY one bucket: `unavailableUpstream`
 * if it's a known failure, else `covered`/`eligibleButNotPlaced` by its
 * tracked appearance count (0 for "never cached at all" — a printing that
 * was never even attempted was, definitionally, never placed either).
 * `totalCatalogSize` makes the invariant checkable from the artifact alone:
 * `covered + eligibleButNotPlaced.length + unavailableUpstream.length === totalCatalogSize`.
 */
import type { CoverageTracker } from "./coverageTracker.js";
import type { CardImageRef } from "./paramStream.js";

export interface UnavailablePrinting {
  printingId: string;
  /** null when the failure wasn't a clean HTTP status (e.g. a network-level
   * error after retries were exhausted) — see downloader.ts's
   * extractHttpStatus. */
  httpStatus: number | null;
  reason: string;
}

export interface CoverageReport {
  minAppearances: number;
  /** Every distinct printing in the vendored catalog, independent of
   * download/cache state — the exact denominator
   * `covered + eligibleButNotPlaced.length + unavailableUpstream.length`
   * must sum to (#269 review round 1 BLOCKER 1). */
  totalCatalogSize: number;
  /** totalCatalogSize minus unavailableUpstream.length — covered +
   * eligibleButNotPlaced.length always equals this. */
  totalEligible: number;
  covered: number;
  /** printingIds, sorted, that never reached minAppearances — includes
   * both "cached but under-covered" AND "never cached/attempted at all"
   * (a printing this run never even tried to place, distinct from a
   * confirmed upstream failure — see this module's header). */
  eligibleButNotPlaced: string[];
  /** Computed over totalEligible (catalog minus unavailableUpstream), NOT
   * just availableCards — a never-attempted printing counts as 0
   * appearances, same as an under-covered cached one. */
  minObservedAppearances: number;
  maxObservedAppearances: number;
  unavailableUpstream: UnavailablePrinting[];
}

export function buildCoverageReport(
  fullCatalogPrintingIds: string[],
  availableCards: CardImageRef[],
  tracker: CoverageTracker,
  minAppearances: number,
  unavailableUpstream: UnavailablePrinting[],
): CoverageReport {
  const counts = tracker.allAppearanceCounts();
  if (counts.length !== availableCards.length) {
    throw new Error(
      `buildCoverageReport: tracker pool size (${counts.length}) does not match availableCards.length (${availableCards.length}) — ` +
        "the tracker passed here must be the SAME instance planRun consumed for this run's availableCards array",
    );
  }

  const appearanceByPrintingId = new Map<string, number>();
  for (let i = 0; i < availableCards.length; i++) appearanceByPrintingId.set(availableCards[i].printingId, counts[i]);

  // Defensive dedup — extraction shouldn't produce duplicate printingIds,
  // but the partition invariant must hold even if it somehow did.
  const catalogIdSet = new Set(fullCatalogPrintingIds);
  const catalogIds = [...catalogIdSet];

  // A download-failures manifest can, in principle, name a printingId that
  // ISN'T (or is no longer) a catalog member — e.g. a stale manifest from
  // before a the-fab-cube catalog update removed/renamed a printing.
  // Filtering here (rather than trusting the caller's list verbatim) is
  // what keeps the partition invariant exact regardless: every entry in
  // the report's OWN `unavailableUpstream` is guaranteed to be one of the
  // `totalCatalogSize` ids being partitioned.
  const unavailableUpstreamInCatalog = unavailableUpstream.filter((u) => catalogIdSet.has(u.printingId));
  const unavailableIds = new Set(unavailableUpstreamInCatalog.map((u) => u.printingId));

  let covered = 0;
  const eligibleButNotPlaced: string[] = [];
  let minObserved = Infinity;
  let maxObserved = -Infinity;

  for (const id of catalogIds) {
    if (unavailableIds.has(id)) continue; // its own bucket, excluded from eligible entirely

    // 0 for a catalog printing neither cached NOR recorded as a download
    // failure (never even attempted) — see this module's header for why
    // that's folded into eligibleButNotPlaced rather than vanishing.
    const count = appearanceByPrintingId.get(id) ?? 0;
    if (count < minObserved) minObserved = count;
    if (count > maxObserved) maxObserved = count;
    if (count >= minAppearances) covered++;
    else eligibleButNotPlaced.push(id);
  }
  eligibleButNotPlaced.sort();

  const totalEligible = catalogIds.length - unavailableIds.size;

  return {
    minAppearances,
    totalCatalogSize: catalogIds.length,
    totalEligible,
    covered,
    eligibleButNotPlaced,
    minObservedAppearances: totalEligible === 0 ? 0 : minObserved,
    maxObservedAppearances: totalEligible === 0 ? 0 : maxObserved,
    unavailableUpstream: unavailableUpstreamInCatalog,
  };
}
