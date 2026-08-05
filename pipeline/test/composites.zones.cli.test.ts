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

// #268 PR #269 review round 1 BLOCKER 2: --coverage on the (single-mode)
// zone-generate command — see generateZoneRun.ts's GenerateZoneRunInput.coverage
// doc for what this does and doesn't cover.
describe("parseZoneGenerateArgs — --coverage (#268)", () => {
  it("defaults coverage to false (pre-#268 behavior unchanged)", () => {
    expect(parseZoneGenerateArgs([]).coverage).toBe(false);
  });

  it("accepts --coverage", () => {
    expect(parseZoneGenerateArgs(["--coverage"]).coverage).toBe(true);
  });
});

// #256 Phase C: `--mode broadcast` is a NEW flag on the SAME zone-generate
// command (builds on the #253 zone-layout machinery per the brief),
// default "single" so every pre-#256 invocation is byte-for-byte
// unaffected — no CLI behavior change unless --mode broadcast is passed
// explicitly.
describe("parseZoneGenerateArgs — --mode broadcast (#256)", () => {
  it("defaults mode to 'single' (pre-#256 behavior, unchanged)", () => {
    expect(parseZoneGenerateArgs([]).mode).toBe("single");
  });

  it("accepts --mode broadcast", () => {
    expect(parseZoneGenerateArgs(["--mode", "broadcast"]).mode).toBe("broadcast");
  });

  it("defaults broadcastLayoutPath to null — a run draws from the FULL rig pool, not one hardcoded rig (#256 correction)", () => {
    const args = parseZoneGenerateArgs([]);
    expect(args.broadcastLayoutPath).toBeNull();
  });

  it("defaults broadcastLayoutsDir to the committed config/broadcast-layouts/ pool (#256 correction)", () => {
    const args = parseZoneGenerateArgs([]);
    expect(args.broadcastLayoutsDir).toMatch(/broadcast-layouts$/);
  });

  it("honors --broadcast-layouts-dir", () => {
    const args = parseZoneGenerateArgs(["--mode", "broadcast", "--broadcast-layouts-dir", "/tmp/rigs"]);
    expect(args.broadcastLayoutsDir).toBe("/tmp/rigs");
  });

  it("defaults broadcastAugmentationPath to the committed broadcast-augmentation.json", () => {
    const args = parseZoneGenerateArgs([]);
    expect(args.broadcastAugmentationPath).toMatch(/broadcast-augmentation\.json$/);
  });

  it("defaults broadcastCount, frameWidth, frameHeight to documented values", () => {
    const args = parseZoneGenerateArgs([]);
    expect(args.broadcastCount).toBeGreaterThan(0);
    expect(args.frameWidth).toBeGreaterThan(args.frameHeight); // landscape
  });

  it("honors --broadcast-layout, --broadcast-augmentation, --broadcast-count, --frame-width, --frame-height overrides", () => {
    const args = parseZoneGenerateArgs([
      "--mode", "broadcast",
      "--broadcast-layout", "/tmp/layout.json",
      "--broadcast-augmentation", "/tmp/aug.json",
      "--broadcast-count", "12",
      "--frame-width", "1000",
      "--frame-height", "600",
    ]);
    expect(args.broadcastLayoutPath).toBe("/tmp/layout.json");
    expect(args.broadcastAugmentationPath).toBe("/tmp/aug.json");
    expect(args.broadcastCount).toBe(12);
    expect(args.frameWidth).toBe(1000);
    expect(args.frameHeight).toBe(600);
  });

  it("defaults --out to a DIFFERENT dir than plain zone-generate's default (out/broadcast-layouts, not out/zone-layouts) when --mode broadcast is passed", () => {
    const args = parseZoneGenerateArgs(["--mode", "broadcast"]);
    expect(args.outDir.split(/[\\/]/)).toContain("broadcast-layouts");
  });
});
