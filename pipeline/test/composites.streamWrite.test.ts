import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { beginCompositeRun } from "../src/composites/write.js";
import { buildCompositeManifest } from "../src/composites/manifest.js";
import type { GeneratorConfig } from "../src/composites/config.js";
import type { CompositeLabel } from "../src/composites/types.js";
import type { RawImage } from "../src/composites/rawImage.js";

let tmpDir: string;
let outDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-composites-streamwrite-test-"));
  outDir = path.join(tmpDir, "run");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function config(): GeneratorConfig {
  return {
    seed: 1,
    outputSize: { width: 4, height: 4 },
    compositesPerRun: 1,
    cardsPerComposite: { min: 1, max: 1 },
    baseCardHeightFraction: 0.25,
    scale: { min: 1, max: 1 },
    rotationDeg: { min: 0, max: 0 },
    overlapProbability: 0,
    overlapOffsetFraction: { min: 0.1, max: 0.2 },
    perspectiveProbability: 0,
    perspectiveStrength: { min: 0, max: 0.1 },
    glareProbability: 0,
    sleeveProbability: 0,
    lighting: { brightnessDelta: { min: 0, max: 0 }, contrastDelta: { min: 0, max: 0 } },
    backgroundTypes: ["solid"],
    backgroundsDir: null,
    externalBackgroundProbability: 0,
    minVisibleFraction: 0.15,
  };
}

function label(id: string): CompositeLabel {
  return {
    compositeId: id,
    fileName: `${id}.png`,
    width: 4,
    height: 4,
    backgroundType: "procedural:solid",
    backgroundHash: null,
    cards: [],
    excludedCards: 0,
    cardBacksPlaced: 0,
  };
}

function tinyImage(): RawImage {
  return { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };
}

// #272: the batch writeCompositeRun (build-everything-in-a-hidden-tmp-dir-
// then-rename) requires holding every composite's rendered pixels in
// memory for the whole run — that's the write-side half of the O(composites)
// memory bug. beginCompositeRun streams instead: each composite is encoded
// and written to outDir the moment it's produced, and the caller can drop
// its RawImage immediately after. manifest.json — written only by
// finalize() — is the run's completion marker: its ABSENCE after a killed
// run is what distinguishes "partial" from "done", replacing the old
// tmp-dir-rename's atomicity signal.
describe("beginCompositeRun (streaming writer)", () => {
  it("writes a composite's PNG + label.json immediately — visible on disk before finalize() is ever called", async () => {
    const writer = beginCompositeRun(outDir, async () => Buffer.from("fake-png-bytes"));
    await writer.writeComposite(tinyImage(), label("composite-0000"));

    expect(fs.readFileSync(path.join(outDir, "composite-0000.png"))).toEqual(Buffer.from("fake-png-bytes"));
    expect(fs.existsSync(path.join(outDir, "composite-0000.json"))).toBe(true);
    // The defining streaming property: no manifest yet, but the composite
    // is already real, readable output.
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(false);
  });

  it("writes each label.json in the exact byte format the manifest's labelFileHash was computed against", async () => {
    const labels = [label("composite-0000")];
    const manifest = buildCompositeManifest({ config: config(), labels });

    const writer = beginCompositeRun(outDir, async () => Buffer.from("x"));
    await writer.writeComposite(tinyImage(), labels[0]);
    writer.finalize(manifest);

    const onDisk = fs.readFileSync(path.join(outDir, "composite-0000.json"));
    const { sha256 } = await import("../src/benchmark/manifest.js");
    expect(sha256(onDisk)).toBe(manifest.composites[0].labelFileHash);
  });

  it("clears a stale existing outDir before the first write — a leftover from a previous run never survives into the new one", async () => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "stale-leftover.json"), "{}");

    const writer = beginCompositeRun(outDir, async () => Buffer.from("x"));
    await writer.writeComposite(tinyImage(), label("composite-0000"));

    expect(fs.existsSync(path.join(outDir, "stale-leftover.json"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "composite-0000.png"))).toBe(true);
  });

  it("writes composites in call order, each producing its own files as soon as writeComposite resolves — not batched at the end", async () => {
    const writeOrder: string[] = [];
    const writer = beginCompositeRun(outDir, async () => Buffer.from("x"));

    await writer.writeComposite(tinyImage(), label("composite-0000"));
    writeOrder.push(...fs.readdirSync(outDir));
    await writer.writeComposite(tinyImage(), label("composite-0001"));
    writeOrder.push(...fs.readdirSync(outDir));

    // After the FIRST writeComposite call, only composite-0000's two files
    // exist — composite-0001 hasn't been written yet, proving files land
    // one composite at a time rather than all at once.
    expect(writeOrder.slice(0, 2).sort()).toEqual(["composite-0000.json", "composite-0000.png"]);
    expect(fs.readdirSync(outDir).sort()).toEqual(["composite-0000.json", "composite-0000.png", "composite-0001.json", "composite-0001.png"]);
  });

  it("finalize() writes manifest.json — the completion marker — only once the caller has written every composite it intends to", () => {
    const manifest = buildCompositeManifest({ config: config(), labels: [] });
    const writer = beginCompositeRun(outDir, async () => Buffer.from("x"));

    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(false);
    writer.finalize(manifest);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"))).toEqual(manifest);
  });

  it("leaves no .tmp-* sibling directories behind — there is no hidden staging dir in the streaming design", async () => {
    const writer = beginCompositeRun(outDir, async () => Buffer.from("x"));
    await writer.writeComposite(tinyImage(), label("composite-0000"));
    writer.finalize(buildCompositeManifest({ config: config(), labels: [label("composite-0000")] }));

    const siblings = fs.readdirSync(path.dirname(outDir));
    expect(siblings.some((s) => s.includes(".tmp-"))).toBe(false);
  });
});
