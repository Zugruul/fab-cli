import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { validateCorpusSnapshotManifest } from "@fab/manifest-schema";
import { runExport } from "../src/export.js";

// APP-016: proves the pipeline's REAL emitted corpus snapshot manifest
// (not a hand-written stand-in) validates against the shared schema
// package — the producer side of "no lane invents its own manifest
// shape" (SPEC-APP.md §7.11).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

function baseConfig() {
  return {
    identitiesRoot: path.join(FIXTURES, "identities"),
    identities: ["judge", "player", "card-vault"],
    kbRulesDir: path.join(FIXTURES, "kb", "rules"),
    loreDir: path.join(FIXTURES, "lore"),
    versionsTxtPath: path.join(FIXTURES, "fab-rules", "VERSIONS.txt"),
    setJsonPath: path.join(FIXTURES, "flesh-and-blood-cards", "json", "english", "set.json"),
    fabloreDir: path.join(FIXTURES, "does-not-exist-submodule"),
  };
}

describe("pipeline's emitted manifest against @fab/manifest-schema", () => {
  it("validates runExport()'s real corpus snapshot manifest against the shared schema", () => {
    const { manifest } = runExport(baseConfig());
    const result = validateCorpusSnapshotManifest(manifest);
    expect(result.success, !result.success ? JSON.stringify(result.errors, null, 2) : undefined).toBe(
      true,
    );
  });
});
