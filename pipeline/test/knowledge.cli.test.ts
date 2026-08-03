// APP-085 (issue #142): pure CLI arg-parsing for the knowledge-pack
// builder, mirroring the rest of the pipeline's *.cli.test.ts convention
// (images.cli.test.ts/dataset.cli.test.ts) — defaults(root) + parseArgs
// (argv, defaults) tested in isolation, no process spawn / real fs.
import path from "node:path";
import { describe, it, expect } from "vitest";
import { defaultFullArgs, parseFullArgs, defaultDeltaArgs, parseDeltaArgs } from "../src/knowledge/cli.js";

const ROOT = "/repo";

describe("knowledge/cli.ts — full mode", () => {
  it("defaults chunks/corpus-manifest/card-json paths under the repo's pipeline/out and fab-cli third_party dirs", () => {
    const defaults = defaultFullArgs(ROOT);
    expect(defaults.chunksPath).toBe(path.join(ROOT, "pipeline", "out", "chunks.jsonl"));
    expect(defaults.corpusManifestPath).toBe(path.join(ROOT, "pipeline", "out", "manifest.json"));
    expect(defaults.outDir).toBe(path.join(ROOT, "pipeline", "out", "knowledge", "full"));
    expect(defaults.printingIdsPath).toBeNull();
    expect(defaults.previousRegistryPath).toBeNull();
    expect(defaults.textEmbeddingsPath).toBeNull();
    expect(defaults.imageEmbeddingsPath).toBeNull();
    expect(defaults.calibrationPath).toBeNull();
    expect(defaults.version).toBeNull();
  });

  it("--version is required-by-convention but not defaulted (null until the caller supplies one)", () => {
    const args = parseFullArgs([], defaultFullArgs(ROOT));
    expect(args.version).toBeNull();
  });

  it("overrides every flag", () => {
    const args = parseFullArgs(
      [
        "--version",
        "1.2.0",
        "--out",
        "/tmp/out",
        "--chunks",
        "/tmp/chunks.jsonl",
        "--previous-registry",
        "/tmp/prev-registry.json",
        "--text-embeddings",
        "/tmp/text.jsonl",
        "--image-embeddings",
        "/tmp/image.jsonl",
        "--calibration",
        "/tmp/calibration.json",
        "--printing-ids",
        "/tmp/printing-ids.json",
      ],
      defaultFullArgs(ROOT),
    );
    expect(args.version).toBe("1.2.0");
    expect(args.outDir).toBe("/tmp/out");
    expect(args.chunksPath).toBe("/tmp/chunks.jsonl");
    expect(args.previousRegistryPath).toBe("/tmp/prev-registry.json");
    expect(args.textEmbeddingsPath).toBe("/tmp/text.jsonl");
    expect(args.imageEmbeddingsPath).toBe("/tmp/image.jsonl");
    expect(args.calibrationPath).toBe("/tmp/calibration.json");
    expect(args.printingIdsPath).toBe("/tmp/printing-ids.json");
  });

  it("registryVersion defaults to null (falls back to --version at build time), but can be overridden independently", () => {
    const defaultVersion = parseFullArgs(["--version", "1.0.0"], defaultFullArgs(ROOT));
    expect(defaultVersion.registryVersion).toBeNull();
    const overridden = parseFullArgs(["--version", "1.0.0", "--registry-version", "9.9.9"], defaultFullArgs(ROOT));
    expect(overridden.registryVersion).toBe("9.9.9");
  });
});

describe("knowledge/cli.ts — delta mode", () => {
  it("defaults outDir under pipeline/out/knowledge/delta, from/to null (no sensible default)", () => {
    const defaults = defaultDeltaArgs(ROOT);
    expect(defaults.outDir).toBe(path.join(ROOT, "pipeline", "out", "knowledge", "delta"));
    expect(defaults.fromDir).toBeNull();
    expect(defaults.toDir).toBeNull();
  });

  it("--from/--to/--out override defaults", () => {
    const args = parseDeltaArgs(["--from", "/tmp/from", "--to", "/tmp/to", "--out", "/tmp/delta"], defaultDeltaArgs(ROOT));
    expect(args.fromDir).toBe("/tmp/from");
    expect(args.toDir).toBe("/tmp/to");
    expect(args.outDir).toBe("/tmp/delta");
  });
});
