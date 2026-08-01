import { describe, it, expect } from "vitest";
import { resolveFormat, FORMAT_ALIASES } from "../src/format";

describe("resolveFormat", () => {
  it("resolves known short aliases to their canonical display name", () => {
    expect(resolveFormat("cc")).toBe("Classic Constructed");
    expect(resolveFormat("sa")).toBe("Silver Age");
    expect(resolveFormat("blitz")).toBe("Blitz");
    expect(resolveFormat("ll")).toBe("Living Legend");
    expect(resolveFormat("upf")).toBe("Ultimate Pit Fight");
    expect(resolveFormat("open")).toBe("Open");
    expect(resolveFormat("clash")).toBe("Clash");
  });

  it("is case-insensitive", () => {
    expect(resolveFormat("CC")).toBe("Classic Constructed");
    expect(resolveFormat("Sa")).toBe("Silver Age");
    expect(resolveFormat("UPF")).toBe("Ultimate Pit Fight");
  });

  it("passes through an already-canonical format name unchanged", () => {
    expect(resolveFormat("Classic Constructed")).toBe("Classic Constructed");
  });

  it("passes through an unknown format string unchanged (verbatim, not lowercased)", () => {
    expect(resolveFormat("Some Weird Format")).toBe("Some Weird Format");
    expect(resolveFormat("draft")).toBe("draft");
  });

  it("returns undefined for undefined input", () => {
    expect(resolveFormat(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty string (falsy passthrough)", () => {
    expect(resolveFormat("")).toBeUndefined();
  });

  it("exposes every alias declared in FORMAT_ALIASES", () => {
    for (const [alias, canonical] of Object.entries(FORMAT_ALIASES)) {
      expect(resolveFormat(alias)).toBe(canonical);
    }
  });
});
