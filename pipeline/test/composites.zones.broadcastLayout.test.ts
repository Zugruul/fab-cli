import { describe, it, expect } from "vitest";
import { validateBroadcastLayoutConfig, CHROME_KINDS } from "../src/composites/zones/broadcastLayout.js";
import type { BroadcastLayoutConfig, ChromeRegion } from "../src/composites/zones/broadcastLayout.js";

// #256 Phase B: measured broadcast-layout config validation. Mirrors
// zoneMap.ts's validate*Config style (collect every violation, never stop
// at the first) and reuses its zoneRectsOverlap for the one overlap
// invariant that actually matters here: the play area and any chrome
// region must never overlap (nesting WITHIN chrome — e.g. a webcam pane
// nested inside its sidebar — is intentional and NOT checked, unlike
// zoneMap.ts's zone-vs-zone pairwise check).

function rect(overrides: Partial<{ xFrac: number; yFrac: number; wFrac: number; hFrac: number }> = {}) {
  return { xFrac: 0, yFrac: 0, wFrac: 0.2, hFrac: 0.2, ...overrides };
}

function chromeRegion(overrides: Partial<ChromeRegion> = {}): ChromeRegion {
  return { kind: "scoreboard", rect: rect({ xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 0.058 }), ...overrides };
}

function validConfig(overrides: Partial<BroadcastLayoutConfig> = {}): BroadcastLayoutConfig {
  return {
    name: "test broadcast rig",
    playArea: rect({ xFrac: 0.2, yFrac: 0.06, wFrac: 0.6, hFrac: 0.94 }),
    chrome: [
      chromeRegion({ kind: "scoreboard", rect: rect({ xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 0.058 }) }),
      chromeRegion({ kind: "sidebar", side: "left", rect: rect({ xFrac: 0, yFrac: 0.058, wFrac: 0.2, hFrac: 0.942 }) }),
      chromeRegion({ kind: "sidebar", side: "right", rect: rect({ xFrac: 0.8, yFrac: 0.058, wFrac: 0.2, hFrac: 0.942 }) }),
      chromeRegion({ kind: "card-preview", side: "right", rect: rect({ xFrac: 0.81, yFrac: 0.56, wFrac: 0.18, hFrac: 0.4 }) }),
    ],
    ...overrides,
  };
}

describe("CHROME_KINDS", () => {
  it("includes every chrome region kind the rig brief names", () => {
    expect(CHROME_KINDS).toEqual(
      expect.arrayContaining(["scoreboard", "sidebar", "webcam", "info-stack", "card-preview"]),
    );
  });
});

describe("validateBroadcastLayoutConfig — structural validity", () => {
  it("accepts a well-formed config", () => {
    const result = validateBroadcastLayoutConfig(validConfig());
    expect(result.valid).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(validateBroadcastLayoutConfig(null).valid).toBe(false);
    expect(validateBroadcastLayoutConfig([]).valid).toBe(false);
  });

  it("rejects a missing/empty name", () => {
    const result = validateBroadcastLayoutConfig({ ...validConfig(), name: "" });
    expect(result.valid).toBe(false);
  });

  it("rejects a missing playArea", () => {
    const raw = validConfig() as unknown as Record<string, unknown>;
    delete raw.playArea;
    expect(validateBroadcastLayoutConfig(raw).valid).toBe(false);
  });

  it("rejects an empty chrome array", () => {
    const result = validateBroadcastLayoutConfig({ ...validConfig(), chrome: [] });
    expect(result.valid).toBe(false);
  });

  it("rejects a chrome entry with an unrecognized kind", () => {
    const result = validateBroadcastLayoutConfig({
      ...validConfig(),
      chrome: [chromeRegion({ kind: "not-a-real-kind" as ChromeRegion["kind"] })],
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.some((e) => e.includes("kind"))).toBe(true);
  });

  it("rejects a chrome rect that extends past the canvas edge", () => {
    const result = validateBroadcastLayoutConfig({
      ...validConfig(),
      chrome: [chromeRegion({ rect: rect({ xFrac: 0.5, yFrac: 0, wFrac: 0.6, hFrac: 0.1 }) })],
    });
    expect(result.valid).toBe(false);
  });
});

describe("validateBroadcastLayoutConfig — play-area/chrome overlap invariant", () => {
  it("rejects a chrome region that overlaps the play area", () => {
    const result = validateBroadcastLayoutConfig(
      validConfig({
        playArea: rect({ xFrac: 0.2, yFrac: 0.06, wFrac: 0.6, hFrac: 0.94 }),
        chrome: [chromeRegion({ kind: "sidebar", side: "left", rect: rect({ xFrac: 0.15, yFrac: 0.06, wFrac: 0.2, hFrac: 0.9 }) })], // overlaps playArea's left edge
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.some((e) => e.toLowerCase().includes("overlap"))).toBe(true);
  });

  it("accepts chrome regions that only touch the play area edge-to-edge (no overlap)", () => {
    const result = validateBroadcastLayoutConfig(validConfig());
    expect(result.valid).toBe(true);
  });

  // #256: webcam/info-stack nested WITHIN their sidebar is intentional —
  // this must NOT be flagged, unlike the playArea-vs-chrome check above.
  it("does NOT flag a webcam region nested inside its own sidebar as an overlap", () => {
    const result = validateBroadcastLayoutConfig(
      validConfig({
        chrome: [
          chromeRegion({ kind: "sidebar", side: "left", rect: rect({ xFrac: 0, yFrac: 0.058, wFrac: 0.2, hFrac: 0.942 }) }),
          chromeRegion({ kind: "webcam", side: "left", rect: rect({ xFrac: 0.01, yFrac: 0.09, wFrac: 0.18, hFrac: 0.4 }) }),
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });
});

describe("the committed reference broadcast layout (config/broadcast-layouts/calling-edinburgh.json)", () => {
  it("is valid and covers every documented chrome kind, measured against real imported captures", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const raw = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "..", "config", "broadcast-layouts", "calling-edinburgh.json"), "utf8"),
    );
    const result = validateBroadcastLayoutConfig(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      const kinds = new Set(result.config.chrome.map((c) => c.kind));
      expect(kinds).toEqual(new Set(CHROME_KINDS));
      // Sanity check on the measured numbers (not a re-derivation of them):
      // at the real captures' own resolution (~2048px wide), the play area
      // itself reads as landscape, matching "landscape table" (#256 brief).
      const FRAME_W = 2048;
      const FRAME_H = 1154;
      const playAreaPxW = result.config.playArea.wFrac * FRAME_W;
      const playAreaPxH = result.config.playArea.hFrac * FRAME_H;
      expect(playAreaPxW).toBeGreaterThan(playAreaPxH);
      // Left/right sidebars are roughly symmetric (same rig, mirrored).
      const left = result.config.chrome.find((c) => c.kind === "sidebar" && c.side === "left")!;
      const right = result.config.chrome.find((c) => c.kind === "sidebar" && c.side === "right")!;
      expect(Math.abs(left.rect.wFrac - right.rect.wFrac)).toBeLessThan(0.02);
    }
  });
});
