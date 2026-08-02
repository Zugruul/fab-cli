import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  contentHash,
  readVersionsTxt,
  readLatestSetCode,
  readLegalityPolicyFetchedAt,
} from "../src/manifest.js";
import type { Chunk } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

const chunk = (id: string, text: string): Chunk => ({
  chunk_id: id,
  text,
  title: id,
  source: "test",
  links: [],
  tags: [],
});

describe("contentHash", () => {
  it("is stable across input ordering (order-independent)", () => {
    const a = [chunk("b", "text-b"), chunk("a", "text-a")];
    const b = [chunk("a", "text-a"), chunk("b", "text-b")];
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("changes when a chunk's text changes", () => {
    const a = [chunk("a", "text-a")];
    const b = [chunk("a", "text-a-changed")];
    expect(contentHash(a)).not.toBe(contentHash(b));
  });

  it("is deterministic across repeated calls on the same input", () => {
    const a = [chunk("a", "text-a"), chunk("b", "text-b")];
    expect(contentHash(a)).toBe(contentHash(a));
  });
});

describe("readVersionsTxt", () => {
  it("parses per-document last-modified/lines from VERSIONS.txt", () => {
    const result = readVersionsTxt(path.join(FIXTURES, "fab-rules", "VERSIONS.txt"));
    expect(result).not.toBeNull();
    expect(result!.documentVersions).toEqual([
      { document: "cr", file: "en-fab-cr.txt", lastModified: "Wed, 10 Jun 2026 19:43:38 GMT", lines: 2392 },
      { document: "trp", file: "en-fab-trp.txt", lastModified: "Wed, 10 Jun 2026 19:43:38 GMT", lines: 1079 },
      { document: "ppg", file: "en-fab-ppg.txt", lastModified: "Wed, 10 Jun 2026 19:43:38 GMT", lines: 675 },
    ]);
    expect(result!.crVersion).toBe("Wed, 10 Jun 2026 19:43:38 GMT");
  });

  it("returns null (not a throw) when VERSIONS.txt is absent", () => {
    const result = readVersionsTxt(path.join(FIXTURES, "fab-rules", "does-not-exist.txt"));
    expect(result).toBeNull();
  });
});

describe("readLatestSetCode", () => {
  it("picks the set with the latest printing initial_release_date", () => {
    const code = readLatestSetCode(
      path.join(FIXTURES, "flesh-and-blood-cards", "json", "english", "set.json"),
    );
    expect(code).toBe("OTA");
  });

  it("returns 'unknown' honestly when set.json is absent", () => {
    const code = readLatestSetCode(path.join(FIXTURES, "flesh-and-blood-cards", "does-not-exist.json"));
    expect(code).toBe("unknown");
  });
});

describe("readLegalityPolicyFetchedAt", () => {
  it("returns the legality chunk's fetchedAt from kb/rules/index.json", () => {
    const result = readLegalityPolicyFetchedAt(path.join(FIXTURES, "kb", "rules-with-legality"));
    expect(result).toBe("2026-07-15T10:00:00.000Z");
  });

  it("returns 'unknown' honestly when kb/rules/index.json has no legality entry", () => {
    const result = readLegalityPolicyFetchedAt(path.join(FIXTURES, "kb", "rules"));
    expect(result).toBe("unknown");
  });

  it("returns 'unknown' honestly when kb/rules/index.json is absent", () => {
    const result = readLegalityPolicyFetchedAt(path.join(FIXTURES, "kb", "rules-does-not-exist"));
    expect(result).toBe("unknown");
  });

  it("returns 'unknown' honestly when kb/rules/index.json is corrupt JSON", () => {
    const result = readLegalityPolicyFetchedAt(path.join(FIXTURES, "kb", "rules-corrupt"));
    expect(result).toBe("unknown");
  });
});
