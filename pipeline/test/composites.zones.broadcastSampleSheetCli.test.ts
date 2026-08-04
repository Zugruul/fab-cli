import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseBroadcastSampleSheetArgs, broadcastSampleSheetCommand } from "../src/composites/zones/cli.js";

// #256 Phase D: `composites broadcast-sample-sheet` CLI wiring — reads a
// completed --mode broadcast run's manifest (synthetic tiles) plus an
// import-captures run's manifest (reference tiles) and writes ONE
// interleaved HTML sheet via broadcastSampleSheet.ts.

describe("parseBroadcastSampleSheetArgs", () => {
  it("defaults runDir under pipeline/out/broadcast-layouts", () => {
    const args = parseBroadcastSampleSheetArgs([]);
    expect(args.runDir.split(/[\\/]/).slice(-2)).toEqual(["out", "broadcast-layouts"]);
  });

  it("defaults capturesDir under pipeline/out/backgrounds/captures", () => {
    const args = parseBroadcastSampleSheetArgs([]);
    expect(args.capturesDir.split(/[\\/]/).slice(-3)).toEqual(["out", "backgrounds", "captures"]);
  });

  it("defaults --out to <run-dir>/broadcast-sample-sheet.html", () => {
    const args = parseBroadcastSampleSheetArgs(["--run-dir", "/tmp/run"]);
    expect(args.out).toBe(path.join("/tmp/run", "broadcast-sample-sheet.html"));
  });

  it("honors --run-dir, --captures-dir, --out, --title, --reference-count overrides", () => {
    const args = parseBroadcastSampleSheetArgs([
      "--run-dir", "/tmp/run",
      "--captures-dir", "/tmp/captures",
      "--out", "/tmp/sheet.html",
      "--title", "My sheet",
      "--reference-count", "5",
    ]);
    expect(args.runDir).toBe("/tmp/run");
    expect(args.capturesDir).toBe("/tmp/captures");
    expect(args.out).toBe("/tmp/sheet.html");
    expect(args.title).toBe("My sheet");
    expect(args.referenceCount).toBe(5);
  });
});

describe("broadcastSampleSheetCommand — real end-to-end (fixture manifests on disk)", () => {
  let runDir: string;
  let capturesDir: string;
  let outPath: string;

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-broadcast-run-"));
    capturesDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-captures-"));
    outPath = path.join(runDir, "broadcast-sample-sheet.html");

    // Minimal fake --mode broadcast run manifest + one label file.
    const label = {
      compositeId: "broadcast-0000",
      fileName: "broadcast-0000.png",
      width: 100,
      height: 60,
      backgroundType: "procedural:solid",
      backgroundHash: null,
      cards: [
        { printingId: "table-card", corners: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }], tags: [], visibleFraction: 1, region: "table" },
        { printingId: "preview-card", corners: [{ x: 80, y: 40 }, { x: 95, y: 40 }, { x: 95, y: 55 }, { x: 80, y: 55 }], tags: [], visibleFraction: 1, region: "preview" },
      ],
      excludedCards: 0,
      cardBacksPlaced: 0,
    };
    fs.writeFileSync(
      path.join(runDir, "manifest.json"),
      JSON.stringify({
        schemaVersion: "0.3.0",
        labelSchemaVersion: "0.5.0",
        buildDate: "2024-01-01T00:00:00.000Z",
        seed: 1,
        generatorConfigHash: "abc",
        compositeCount: 1,
        composites: [{ compositeId: "broadcast-0000", fileName: "broadcast-0000.png", cardCount: 2, excludedCards: 0, cardBacksPlaced: 0, labelFileHash: "x" }],
      }),
    );
    fs.writeFileSync(path.join(runDir, "broadcast-0000.json"), JSON.stringify(label));
    fs.writeFileSync(path.join(runDir, "broadcast-0000.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // Minimal fake import-captures manifest + one imported file.
    fs.writeFileSync(
      path.join(capturesDir, "manifest.json"),
      JSON.stringify({
        imported: [{ sourceFile: "orig.png", outputFileName: "deadbeef00112233.png", contentHash: "deadbeef00112233", width: 2048, height: 1150, dedupedAgainst: null, framing: "full-broadcast" }],
        skipped: [],
      }),
    );
    fs.writeFileSync(path.join(capturesDir, "deadbeef00112233.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(capturesDir, { recursive: true, force: true });
  });

  it("writes an HTML sheet referencing both the synthetic composite and the reference capture, with a REFERENCE marker", () => {
    broadcastSampleSheetCommand(["--run-dir", runDir, "--captures-dir", capturesDir, "--out", outPath]);
    expect(fs.existsSync(outPath)).toBe(true);
    const html = fs.readFileSync(outPath, "utf8");
    expect(html).toContain("broadcast-0000.png");
    expect(html).toContain("deadbeef00112233.png");
    expect(html).toContain("REFERENCE — unlabeled real capture, not training data");
  });

  it("caps reference tiles at --reference-count", () => {
    // Add a second reference file to the manifest.
    const manifest = JSON.parse(fs.readFileSync(path.join(capturesDir, "manifest.json"), "utf8"));
    manifest.imported.push({ sourceFile: "orig2.png", outputFileName: "11223344deadbeef.png", contentHash: "11223344deadbeef", width: 1350, height: 1150, dedupedAgainst: null, framing: "play-area-crop" });
    fs.writeFileSync(path.join(capturesDir, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(capturesDir, "11223344deadbeef.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    broadcastSampleSheetCommand(["--run-dir", runDir, "--captures-dir", capturesDir, "--out", outPath, "--reference-count", "1"]);
    const html = fs.readFileSync(outPath, "utf8");
    expect((html.match(/REFERENCE — unlabeled real capture, not training data/g) ?? []).length).toBe(1);
  });
});
