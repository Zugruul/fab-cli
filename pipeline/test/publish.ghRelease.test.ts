// APP-029 (SPEC-APP.md §8.9, issue #141): the REAL publish path shells out
// to `gh release ...` via an injectable CommandRunner so this suite never
// touches the network — a fake runner records every invocation and
// returns canned exit codes. Re-publishing an existing release tag is
// refused by default (idempotent-by-default convention, mirrors §14
// "Reliability": a corrupted/mismatched re-upload must never silently
// clobber what device tests already fetched) unless `force` is passed.
import { describe, it, expect } from "vitest";
import { publishReleasePlan } from "../src/publish/ghRelease.js";
import type { CommandRunner } from "../src/publish/ghRelease.js";
import type { ReleasePlan } from "../src/publish/types.js";

function fakeRunner(script: (cmd: string, args: string[]) => { status: number; stdout?: string; stderr?: string }) {
  const calls: string[][] = [];
  const runner: CommandRunner = {
    run(cmd, args) {
      calls.push([cmd, ...args]);
      const res = script(cmd, args);
      return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status };
    },
  };
  return { runner, calls };
}

const samplePlan: ReleasePlan = {
  releaseVersion: "1.0.0",
  tag: "pack-1.0.0",
  createdAt: "2026-08-03T00:00:00.000Z",
  assets: [{ assetName: "model-0.6B-merged.gguf", localPath: "/tmp/does-not-matter.gguf", sha256: "a".repeat(64), sizeBytes: 10, kind: "model-pack", label: "0.6B" }],
};

describe("publishReleasePlan", () => {
  it("creates a draft release then uploads assets when the tag doesn't exist yet", () => {
    const { runner, calls } = fakeRunner((_cmd, args) => {
      if (args[0] === "release" && args[1] === "view") return { status: 1, stderr: "release not found" };
      return { status: 0 };
    });

    publishReleasePlan(samplePlan, {}, runner);

    expect(calls[0]).toEqual(["gh", "release", "view", "pack-1.0.0", "--json", "tagName"]);
    expect(calls.some((c) => c[0] === "gh" && c[1] === "release" && c[2] === "create")).toBe(true);
    expect(calls.some((c) => c[0] === "gh" && c[1] === "release" && c[2] === "upload")).toBe(true);
    const createCall = calls.find((c) => c[2] === "create")!;
    expect(createCall).toContain("--draft");
  });

  it("refuses to publish when the release tag already exists and force is not passed", () => {
    const { runner, calls } = fakeRunner((_cmd, args) => {
      if (args[0] === "release" && args[1] === "view") return { status: 0, stdout: '{"tagName":"pack-1.0.0"}' };
      return { status: 0 };
    });

    expect(() => publishReleasePlan(samplePlan, {}, runner)).toThrow(/already exists/);
    expect(calls.some((c) => c[2] === "create")).toBe(false);
    expect(calls.some((c) => c[2] === "upload")).toBe(false);
  });

  it("with force: true, skips create (tag already exists) and re-uploads with --clobber", () => {
    const { runner, calls } = fakeRunner((_cmd, args) => {
      if (args[0] === "release" && args[1] === "view") return { status: 0, stdout: '{"tagName":"pack-1.0.0"}' };
      return { status: 0 };
    });

    publishReleasePlan(samplePlan, { force: true }, runner);

    expect(calls.some((c) => c[2] === "create")).toBe(false);
    const uploadCall = calls.find((c) => c[2] === "upload")!;
    expect(uploadCall).toContain("--clobber");
  });

  it("throws with the real stderr when `gh release upload` fails", () => {
    const { runner } = fakeRunner((_cmd, args) => {
      if (args[0] === "release" && args[1] === "view") return { status: 1 };
      if (args[1] === "upload") return { status: 1, stderr: "network is down" };
      return { status: 0 };
    });

    expect(() => publishReleasePlan(samplePlan, {}, runner)).toThrow(/network is down/);
  });
});
