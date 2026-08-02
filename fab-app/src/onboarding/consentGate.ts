import type { ConsentGateState, NetworkState } from "./types";

/**
 * §9.9 "Wi-Fi-preferred gating": wifi proceeds straight to consent;
 * cellular warns and requires an explicit user override before the same
 * consent proceeds; offline can't download at all, so the screen shows a
 * wait state instead of an unusable consent prompt (offline always wins,
 * even if a cellular override was granted in a prior session — there is
 * nothing to download over). Pure — the caller resolves the current
 * NetworkState via NetworkStateSource beforehand.
 */
export function deriveConsentGate(network: NetworkState, cellularOverrideGranted: boolean): ConsentGateState {
  if (network === "offline") {
    return { kind: "waiting-for-network" };
  }
  if (network === "cellular" && !cellularOverrideGranted) {
    return { kind: "cellular-warning" };
  }
  return { kind: "ready" };
}
