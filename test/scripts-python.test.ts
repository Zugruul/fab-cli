import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Python knowledge generators", () => {
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
  });
});
