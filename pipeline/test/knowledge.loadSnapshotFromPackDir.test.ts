// APP-085 (issue #142; review round 1, PR #241): loadSnapshotFromPackDir
// previously did zero runtime validation on the manifest.json it reads
// back — a bare `as KnowledgePackManifest` cast. Failure mode the
// reviewer named: two INDEPENDENTLY drifted/corrupt packs that both
// happen to be missing `textEmbedderVersion` would both read back as
// `undefined`, and `undefined !== undefined` is `false` in JS — so
// buildDeltaPack's embedder-version-changed check would silently NOT
// fire when it must, because the comparison never noticed either side
// was broken in the first place. This suite locks in the fix: the loader
// must refuse (throw) rather than silently produce a snapshot with
// missing/wrong-shaped fields.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validKnowledgePackManifest } from "@fab/manifest-schema";
import { loadSnapshotFromPackDir } from "../src/knowledge/build.js";

function writePackDir(dir: string, manifest: unknown, chunksLines: string[] = [], registry: unknown = { version: "1.0.0", entries: [] }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "chunks-index.jsonl"), chunksLines.length ? chunksLines.join("\n") + "\n" : "");
  fs.writeFileSync(path.join(dir, "printing-registry.json"), JSON.stringify(registry));
}

describe("loadSnapshotFromPackDir", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-knowledge-load-snapshot-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads a real, schema-valid manifest without throwing", () => {
    const dir = path.join(tmpDir, "valid");
    writePackDir(dir, validKnowledgePackManifest);
    const snapshot = loadSnapshotFromPackDir(dir);
    expect(snapshot.version).toBe(validKnowledgePackManifest.version);
    expect(snapshot.textEmbedderVersion).toBe(validKnowledgePackManifest.textEmbedderVersion);
    expect(snapshot.visionEmbedderVersion).toBe(validKnowledgePackManifest.visionEmbedderVersion);
  });

  it("throws when manifest.json fails schema validation (e.g. missing retrievalFloor)", () => {
    const dir = path.join(tmpDir, "malformed");
    const { retrievalFloor: _retrievalFloor, ...malformed } = validKnowledgePackManifest;
    writePackDir(dir, malformed);
    expect(() => loadSnapshotFromPackDir(dir)).toThrow(/retrievalFloor|schema validation/i);
  });

  it("throws when manifest.json is missing textEmbedderVersion entirely (never silently reads back as undefined)", () => {
    const dir = path.join(tmpDir, "missing-text-embedder");
    const { textEmbedderVersion: _textEmbedderVersion, ...malformed } = validKnowledgePackManifest;
    writePackDir(dir, malformed);
    expect(() => loadSnapshotFromPackDir(dir)).toThrow();
  });

  it("throws on a schemaVersion mismatch even when every other field is well-shaped", () => {
    const dir = path.join(tmpDir, "wrong-schema-version");
    writePackDir(dir, { ...validKnowledgePackManifest, schemaVersion: "9.9.9" });
    expect(() => loadSnapshotFromPackDir(dir)).toThrow(/schemaVersion/i);
  });

  // --- THE exact failure mode the reviewer named --------------------------
  it("REGRESSION: two independently-drifted packs BOTH missing textEmbedderVersion never silently compare as \"matching\" — both refuse to load", () => {
    const { textEmbedderVersion: _a, ...fromMalformed } = validKnowledgePackManifest;
    const { textEmbedderVersion: _b, ...toMalformed } = { ...validKnowledgePackManifest, version: "2.0.0" };

    const fromDir = path.join(tmpDir, "from-drifted");
    const toDir = path.join(tmpDir, "to-drifted");
    writePackDir(fromDir, fromMalformed);
    writePackDir(toDir, toMalformed);

    // Before the fix, both of these would have silently returned
    // `textEmbedderVersion: undefined` and a downstream
    // `buildDeltaPack(from, to)` would see `undefined !== undefined`
    // evaluate to `false` — i.e. "no embedder change" — and proceed to
    // build a delta between two broken packs instead of refusing.
    expect(() => loadSnapshotFromPackDir(fromDir)).toThrow();
    expect(() => loadSnapshotFromPackDir(toDir)).toThrow();
  });
});
