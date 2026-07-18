import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { collectHelpTree } from "./helpers/cliHelpTree";

/**
 * Proof of zero behavior change for the src/cli.ts -> src/commands/* split
 * (SPEC §6.4): --help output must be byte-identical, for the root command
 * and every subcommand, before vs after the refactor. The fixture was
 * captured from the pre-split tree (see test/helpers/cliHelpTree.ts for the
 * enumerated command paths).
 */
describe("CLI --help output (zero behavior change)", () => {
  const fixturePath = path.join(__dirname, "fixtures", "cli-help-snapshot.json");
  const expected: { path: string[]; output: string }[] = JSON.parse(
    fs.readFileSync(fixturePath, "utf8")
  );

  const actual = collectHelpTree();

  it("covers the same set of command paths as the fixture", () => {
    expect(actual.map((n) => n.path)).toEqual(expected.map((n) => n.path));
  });

  for (let i = 0; i < expected.length; i++) {
    const label = expected[i].path.join(" ") || "<root>";
    it(`matches for: fab-cli ${label} --help`, () => {
      expect(actual[i].output).toBe(expected[i].output);
    });
  }
});
