import { describe, it, expect } from "vitest";
import { parseZoneGenerateArgs } from "../src/composites/zones/cli.js";

describe("parseZoneGenerateArgs", () => {
  it("defaults singleCount to 24 and twoPlayerCount to 1 (the demo-run shape #253 asks for)", () => {
    const args = parseZoneGenerateArgs([]);
    expect(args.singleCount).toBe(24);
    expect(args.twoPlayerCount).toBe(1);
  });

  it("defaults zoneMapPath to the committed reference zone map", () => {
    const args = parseZoneGenerateArgs([]);
    expect(args.zoneMapPath).toMatch(/zone-maps[\\/]combat-chain-playmat\.json$/);
  });

  it("defaults configPath to the committed zone-layout-generation.json", () => {
    const args = parseZoneGenerateArgs([]);
    expect(args.configPath).toMatch(/zone-layout-generation\.json$/);
  });

  it("defaults playmatPath to the staged reference playmat under out/", () => {
    const args = parseZoneGenerateArgs([]);
    expect(args.playmatPath).toMatch(/zone-reference-playmat\.png$/);
  });

  it("honors --single-count, --two-player-count, --seed, --out, --debug-overlay overrides", () => {
    const args = parseZoneGenerateArgs([
      "--single-count",
      "5",
      "--two-player-count",
      "2",
      "--seed",
      "99",
      "--out",
      "/tmp/zone-out",
      "--debug-overlay",
      "/tmp/overlay.png",
    ]);
    expect(args.singleCount).toBe(5);
    expect(args.twoPlayerCount).toBe(2);
    expect(args.seed).toBe(99);
    expect(args.outDir).toBe("/tmp/zone-out");
    expect(args.debugOverlayOut).toBe("/tmp/overlay.png");
  });

  it("debugOverlayOut defaults to null (no overlay written unless requested)", () => {
    const args = parseZoneGenerateArgs([]);
    expect(args.debugOverlayOut).toBeNull();
  });
});
