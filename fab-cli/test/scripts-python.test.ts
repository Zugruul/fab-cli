import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Python knowledge generators", () => {
  // This is an integration boundary: it spawns the whole python unittest
  // suite (test/scripts/*_test.py), which itself spawns fab-cli/scripts/*.py
  // generator subprocesses. The 120s bound is a hang-guard, not a
  // performance assertion — under load (concurrent gates / parallel lanes)
  // the vitest default 5000ms timeout tripped intermittently even though the
  // suite is correct and fast standalone (issue #209).
  it("pass their isolated entity contract suite", () => {
    expect(() =>
      execFileSync(
        "python3",
        ["-m", "unittest", "discover", "-s", "test/scripts", "-p", "*_test.py"],
        {
          cwd: process.cwd(),
          env: process.env,
          stdio: "pipe",
        },
      ),
    ).not.toThrow();
  }, 120_000);
});
