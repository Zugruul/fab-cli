/**
 * APP-029 (SPEC-APP.md §8.9; issue #141): the REAL publish path — shells
 * out to the `gh` CLI via an injectable CommandRunner so callers (and
 * every test in this repo) never touch the network directly. Draft/
 * prerelease by default; re-publishing an existing tag is refused unless
 * `force` is passed (idempotent-by-default, mirrors releasePlan.ts's
 * outDir-reuse convention — see that module's doc comment).
 */
import { spawnSync } from "node:child_process";
import type { ReleasePlan } from "./types.js";

export interface CommandRunner {
  run(cmd: string, args: string[]): { stdout: string; stderr: string; status: number };
}

export const realCommandRunner: CommandRunner = {
  run(cmd, args) {
    const result = spawnSync(cmd, args, { encoding: "utf8" });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
  },
};

export function releaseExists(tag: string, runner: CommandRunner): boolean {
  const result = runner.run("gh", ["release", "view", tag, "--json", "tagName"]);
  return result.status === 0;
}

function createDraftRelease(tag: string, runner: CommandRunner): void {
  const result = runner.run("gh", [
    "release",
    "create",
    tag,
    "--draft",
    "--prerelease",
    "--title",
    tag,
    "--notes",
    "Assembled by pipeline/src/publish (APP-029, SPEC-APP.md §8.9). Model + knowledge packs consumed by fab-app's artifact manager (APP-031).",
  ]);
  if (result.status !== 0) {
    throw new Error(`gh release create failed for tag "${tag}": ${result.stderr}`);
  }
}

function uploadAssets(tag: string, assets: { assetName: string; localPath: string }[], force: boolean, runner: CommandRunner): void {
  if (assets.length === 0) return;
  const args = ["release", "upload", tag, ...assets.map((a) => `${a.localPath}#${a.assetName}`)];
  if (force) args.push("--clobber");
  const result = runner.run("gh", args);
  if (result.status !== 0) {
    throw new Error(`gh release upload failed for tag "${tag}": ${result.stderr}`);
  }
}

export function publishReleasePlan(plan: ReleasePlan, opts: { force?: boolean }, runner: CommandRunner): void {
  const exists = releaseExists(plan.tag, runner);
  if (exists && !opts.force) {
    throw new Error(
      `publish refused: release "${plan.tag}" already exists — pass force to re-upload (idempotent-by-default convention, ` +
        "SPEC-APP.md §14 Reliability: a mismatched re-publish must never silently clobber what a device already fetched)",
    );
  }
  if (!exists) {
    createDraftRelease(plan.tag, runner);
  }
  uploadAssets(plan.tag, plan.assets, Boolean(opts.force), runner);
}
