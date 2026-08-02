import { compareVersions, satisfiesRange } from "../semver";

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });
});

describe("satisfiesRange", () => {
  it("accepts any version with the same major and >= the base for a caret range", () => {
    expect(satisfiesRange("1.0.0", "^1.0.0")).toBe(true);
    expect(satisfiesRange("1.4.2", "^1.0.0")).toBe(true);
    expect(satisfiesRange("1.99.99", "^1.0.0")).toBe(true);
  });

  it("rejects a different major version for a caret range", () => {
    expect(satisfiesRange("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesRange("0.9.0", "^1.0.0")).toBe(false);
  });

  it("rejects a same-major version below the caret base", () => {
    expect(satisfiesRange("1.0.0", "^1.2.0")).toBe(false);
  });

  it("treats a bare version range as an exact match", () => {
    expect(satisfiesRange("1.0.0", "1.0.0")).toBe(true);
    expect(satisfiesRange("1.0.1", "1.0.0")).toBe(false);
  });
});
