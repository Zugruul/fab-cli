// APP-029 (issue #141): publish CLI argv parsing — pure functions only
// (mirrors knowledge/cli.ts's parseFullArgs/defaultFullArgs convention),
// so this is unit-tested without touching argv/process/gh at all. The real
// publish path is guarded behind an explicit --yes flag (never on by
// default), per the brief's "guard it behind an explicit --yes/--publish
// flag" requirement.
import { describe, it, expect } from "vitest";
import { parseDryRunArgs, defaultDryRunArgs, parsePublishArgs, defaultPublishArgs } from "../src/publish/cli.js";

describe("parseDryRunArgs", () => {
  it("parses --release-version, --out, and --tier (repeatable)", () => {
    const args = parseDryRunArgs(
      ["--release-version", "1.0.0", "--out", "/tmp/out", "--tier", "0.6B", "--tier", "1.7B"],
      defaultDryRunArgs("/repo"),
    );
    expect(args.releaseVersion).toBe("1.0.0");
    expect(args.outDir).toBe("/tmp/out");
    expect(args.tiers).toEqual(["0.6B", "1.7B"]);
  });

  it("defaults to zero tiers and the repo-relative out dir when nothing is passed", () => {
    const args = defaultDryRunArgs("/repo");
    expect(args.tiers).toEqual([]);
    expect(args.outDir).toContain("/repo");
    expect(args.outDir).toContain("publish");
  });
});

describe("parsePublishArgs", () => {
  it("requires --yes to be explicitly set — never defaults to true", () => {
    const withoutYes = parsePublishArgs(["--release-version", "1.0.0"], defaultPublishArgs("/repo"));
    expect(withoutYes.yes).toBe(false);

    const withYes = parsePublishArgs(["--release-version", "1.0.0", "--yes"], defaultPublishArgs("/repo"));
    expect(withYes.yes).toBe(true);
  });

  it("parses --force independently of --yes", () => {
    const args = parsePublishArgs(["--yes", "--force"], defaultPublishArgs("/repo"));
    expect(args.force).toBe(true);
  });
});
