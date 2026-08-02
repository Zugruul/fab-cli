import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runExport } from "../src/export.js";

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

describe("runExport", () => {
  it("combines brain, rules, and lore chunks with globally unique chunk_ids", () => {
    const { chunks } = runExport(baseConfig());
    // 5 brain (incl. the two-hop symlink chain, deduped) + 2 rules + 2 lore
    // (the broken judge/lore symlinks are skipped, not counted)
    expect(chunks).toHaveLength(9);
    const ids = chunks.map((c) => c.chunk_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stamps a manifest with content hash, document versions, latest set code, and per-source counts", () => {
    const { manifest } = runExport(baseConfig());
    expect(manifest.chunkCount).toBe(9);
    expect(manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.latestSetCode).toBe("OTA");
    expect(manifest.crVersion).toBe("Wed, 10 Jun 2026 19:43:38 GMT");
    expect(manifest.documentVersions).toHaveLength(3);
    // no real fablore checkout under the fixture tree: falls back honestly rather than throwing
    expect(manifest.loreCommit).toBe("92f74367e25b553b922b1fc0cf6ef61570523058");
    // the fixture kb/rules/index.json has no legality chunk: honest "unknown", never fabricated
    expect(manifest.legalityPolicyFetchedAt).toBe("unknown");

    const byName = Object.fromEntries(manifest.sources.map((s) => [s.name, s]));
    expect(byName["judge-brain"].count).toBe(1);
    expect(byName["player-brain"].count).toBe(1);
    expect(byName["card-vault-brain"].count).toBe(3);
    expect(byName["rules-kb"].count).toBe(2);
    expect(byName["lore"].count).toBe(2);

    // shipping mode defaults per SPEC-APP.md §7.10 pending-assessment default
    expect(byName["lore"].shippingMode).toBe("stub");
    expect(byName["judge-brain"].shippingMode).toBe("verbatim");
    expect(byName["rules-kb"].shippingMode).toBe("verbatim");
  });

  it("always records the §7.10 pending-rights-assessment note per source, not just on grace paths", () => {
    const { manifest } = runExport(baseConfig());
    // every source's shipping mode is a placeholder until APP-017 runs the real
    // redistribution-rights assessment — that pending-ness must be visible in the
    // manifest itself (SPEC-APP.md §7.10: "outcome is recorded per source in the
    // corpus snapshot manifest"), not only documented in code comments.
    for (const source of manifest.sources) {
      expect(source.note, `source ${source.name} missing a rights-assessment note`).toMatch(
        /APP-017/,
      );
      expect(source.note).toMatch(/§7\.10|7\.10/);
    }
  });

  it("surfaces per-entry skip counts and reasons in the manifest, not silently", () => {
    const { manifest } = runExport(baseConfig());

    const judgeBrain = manifest.sources.find((s) => s.name === "judge-brain")!;
    expect(judgeBrain.skipped).toBe(1); // the broken kw-ghost.md symlink
    expect(judgeBrain.note).toMatch(/kw-ghost\.md/);
    expect(judgeBrain.note).toMatch(/1/);

    const lore = manifest.sources.find((s) => s.name === "lore")!;
    expect(lore.skipped).toBe(1); // the broken ghost-page.md symlink
    expect(lore.note).toMatch(/ghost-page\.md/);

    // sources with nothing to skip report zero, not an absent field
    const rulesKb = manifest.sources.find((s) => s.name === "rules-kb")!;
    expect(rulesKb.skipped).toBe(0);
  });

  it("degrades gracefully (no throw) when kb/rules' index.json is corrupt JSON", () => {
    const config = baseConfig();
    config.kbRulesDir = path.join(FIXTURES, "kb", "rules-corrupt");
    const { chunks, manifest } = runExport(config);
    expect(chunks.filter((c) => c.chunk_id.startsWith("rules/"))).toHaveLength(0);
    const rulesSource = manifest.sources.find((s) => s.name === "rules-kb")!;
    expect(rulesSource.count).toBe(0);
    expect(rulesSource.note).toMatch(/corrupt|json/i);
  });

  it("produces identical chunk_ids and content hash across two runs of unchanged fixtures", () => {
    const first = runExport(baseConfig());
    const second = runExport(baseConfig());
    expect(second.chunks.map((c) => c.chunk_id).sort()).toEqual(
      first.chunks.map((c) => c.chunk_id).sort(),
    );
    expect(second.manifest.contentHash).toBe(first.manifest.contentHash);
  });

  it("handles an absent kb/rules directory gracefully: no throw, manifest note, no network", () => {
    const config = baseConfig();
    config.kbRulesDir = path.join(FIXTURES, "kb", "rules-does-not-exist");
    const { chunks, manifest } = runExport(config);
    const rulesChunks = chunks.filter((c) => c.chunk_id.startsWith("rules/"));
    expect(rulesChunks).toHaveLength(0);
    const rulesSource = manifest.sources.find((s) => s.name === "rules-kb")!;
    expect(rulesSource.count).toBe(0);
    expect(rulesSource.note).toMatch(/absent/i);
  });

  it("stamps legalityPolicyFetchedAt from the rules KB's legality chunk when present", () => {
    const config = baseConfig();
    config.kbRulesDir = path.join(FIXTURES, "kb", "rules-with-legality");
    const { manifest } = runExport(config);
    expect(manifest.legalityPolicyFetchedAt).toBe("2026-07-15T10:00:00.000Z");
  });
});
