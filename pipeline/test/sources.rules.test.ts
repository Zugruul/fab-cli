import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { exportRulesChunks } from "../src/sources/rules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

describe("exportRulesChunks", () => {
  it("exports one chunk per rules KB index entry", () => {
    const result = exportRulesChunks(path.join(FIXTURES, "kb", "rules"));
    expect(result.missing).toBe(false);
    expect(result.chunks).toHaveLength(2);
    const ids = result.chunks.map((c) => c.chunk_id).sort();
    expect(ids).toEqual([
      "rules/cpg/a-player-commits-serious-misconduct",
      "rules/cr/8.3.1",
    ]);
  });

  it("carries title, source url, and text through", () => {
    const result = exportRulesChunks(path.join(FIXTURES, "kb", "rules"));
    const dominate = result.chunks.find((c) => c.chunk_id === "rules/cr/8.3.1")!;
    expect(dominate.title).toBe("Dominate");
    expect(dominate.source).toBe("vendored:third_party/fab-rules/en-fab-cr.txt");
    expect(dominate.text).toContain("Dominate prevents a block");
    expect(dominate.tags).toContain("cr");
  });

  it("degrades gracefully (no throw, no network) when kb/rules is absent", () => {
    const result = exportRulesChunks(path.join(FIXTURES, "kb", "rules-does-not-exist"));
    expect(result.missing).toBe(true);
    expect(result.chunks).toEqual([]);
  });
});
