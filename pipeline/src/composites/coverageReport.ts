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
 *     (the run's composite budget was too small), NOT a download problem.
 *   - `unavailableUpstream`: a printing that was EXCLUDED from the
 *     eligible pool entirely because its image download failed (e.g. a
 *     real S3 403/404 — see images/downloader.ts's
 *     summarizeFailedDownloads). This bucket is supplied by the caller
 *     (composites/cli.ts), since this module only ever sees the pool it
 *     was actually given — it doesn't know what didn't make the pool.
 *
 * `covered + eligibleButNotPlaced.length` always equals `totalEligible`
 * (the two eligible-pool buckets partition it exactly);
 * `unavailableUpstream` is deliberately outside that partition — it was
 * never part of "eligible" in the first place.
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
  /** Size of the pool coverage selection actually drew from — printings
   * whose images were available. Excludes unavailableUpstream entirely. */
  totalEligible: number;
  covered: number;
  /** printingIds, sorted, that never reached minAppearances (includes
   * printings that appeared zero times, in the same bucket — both are
   * "the run's budget didn't get them there," a single explanation). */
  eligibleButNotPlaced: string[];
  minObservedAppearances: number;
  maxObservedAppearances: number;
  unavailableUpstream: UnavailablePrinting[];
}

export function buildCoverageReport(
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

  let covered = 0;
  const eligibleButNotPlaced: string[] = [];
  let minObserved = Infinity;
  let maxObserved = -Infinity;
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i];
    if (count < minObserved) minObserved = count;
    if (count > maxObserved) maxObserved = count;
    if (count >= minAppearances) covered++;
    else eligibleButNotPlaced.push(availableCards[i].printingId);
  }
  eligibleButNotPlaced.sort();

  return {
    minAppearances,
    totalEligible: availableCards.length,
    covered,
    eligibleButNotPlaced,
    minObservedAppearances: counts.length === 0 ? 0 : minObserved,
    maxObservedAppearances: counts.length === 0 ? 0 : maxObserved,
    unavailableUpstream,
  };
}
