import { deriveConsentGate } from "../consentGate";

describe("deriveConsentGate (§9.9 Wi-Fi-preferred gating)", () => {
  it("wifi always proceeds straight to ready, with or without a prior cellular override", () => {
    expect(deriveConsentGate("wifi", false)).toEqual({ kind: "ready" });
    expect(deriveConsentGate("wifi", true)).toEqual({ kind: "ready" });
  });

  it("cellular without an override shows the cellular warning, requiring explicit override", () => {
    expect(deriveConsentGate("cellular", false)).toEqual({ kind: "cellular-warning" });
  });

  it("cellular with an explicit override proceeds to ready", () => {
    expect(deriveConsentGate("cellular", true)).toEqual({ kind: "ready" });
  });

  it("offline always waits, even if a cellular override was previously granted", () => {
    expect(deriveConsentGate("offline", false)).toEqual({ kind: "waiting-for-network" });
    expect(deriveConsentGate("offline", true)).toEqual({ kind: "waiting-for-network" });
  });
});
