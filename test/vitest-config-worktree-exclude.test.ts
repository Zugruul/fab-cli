import { describe, expect, it } from "vitest";
import vitestConfig from "../vitest.config.ts";

describe("vitest.config.ts exclude", () => {
  it("excludes .claude/** so stray worktree test files are never picked up", async () => {
    const resolved =
      typeof vitestConfig === "function"
        ? await vitestConfig({ mode: "test", command: "serve" } as never)
        : vitestConfig;
    const exclude = resolved.test?.exclude ?? [];
    expect(exclude).toContain(".claude/**");
  });
});
