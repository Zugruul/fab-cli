// SPEC-APP.md §9.8: "IF the device has < 6 GB RAM or the 1.7B pack fails to
// load THEN THE SYSTEM SHALL run the 0.6B tier automatically and record the
// active tier in settings/diagnostics."
//
// §14: "1.7B tier floor = iPhone 13 Pro class (A15, 6 GB RAM); 0.6B tier
// floor = iPhone 12 / 13 base class (A14/A15, 4 GB RAM)."

import type { DiagnosticsStore, Tier, TierFallbackStore, TierSelectionInput, TierSelectionReason } from "./types";

/** 6 GB, the §14 1.7B tier RAM floor. Devices below this always run 0.6B,
 * without even attempting a 1.7B load. */
export const TIER_1_7B_RAM_FLOOR_BYTES = 6 * 1024 ** 3;

export class TierSelector {
  constructor(
    private readonly fallbackStore: TierFallbackStore,
    private readonly diagnostics: DiagnosticsStore,
  ) {}

  async selectTier(input: TierSelectionInput): Promise<Tier> {
    if (input.totalRamBytes < TIER_1_7B_RAM_FLOOR_BYTES) {
      await this.record("0.6B", "ram-below-floor");
      return "0.6B";
    }

    if (await this.fallbackStore.isFallbackForced()) {
      // A prior load failure persists until the artifacts themselves
      // change (fallbackStore.clearFallback(), called by the artifact
      // installer on a fresh 1.7B pack install) — never re-attempted here.
      await this.record("0.6B", "load-failure-persisted");
      return "0.6B";
    }

    try {
      const loaded = await input.canLoad17B();
      if (loaded === false) {
        throw new Error("1.7B load reported failure");
      }
      await this.record("1.7B", "ok");
      return "1.7B";
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.fallbackStore.recordLoadFailure(reason);
      await this.record("0.6B", "load-failure");
      return "0.6B";
    }
  }

  private async record(tier: Tier, reason: TierSelectionReason): Promise<void> {
    await this.diagnostics.recordActiveTier(tier, reason);
  }
}
