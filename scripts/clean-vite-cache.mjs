// Gate hygiene (issue #263): clear stale Vite/Vitest dependency-optimization
// caches before the gate runs, so a recorded gate pass can never be a phantom
// verdict from a stale node_modules/.vite (or .vite-temp) directory.
//
// Root cause (see the issue for the full writeup): vitest v4 writes a
// persistent cross-process cache to <pkg>/node_modules/.vite (deps
// pre-bundling + a `vitest/<hash>/results.json` run-history file) and a
// `.vite-temp` scratch dir used while that cache is (re)built. Under some
// concurrent/interrupted conditions this has been observed to serve a stale
// result through the gate's vitest entry path (`pnpm -r run gate`) even
// though the working tree is byte-identical to a passing state — a
// FABRICATED failure, not a real regression. Deleting these directories
// before the run removes the possibility entirely; there is no reliable way
// to detect "this cache happens to be stale" from outside vitest, so this
// clears unconditionally rather than trying to guess.
//
// Run standalone: `node scripts/clean-vite-cache.mjs` (also `npm run
// clean:vite-cache`). Wired as the first step of the root "gate" script via
// scripts/gate.sh so a recorded gate pass never depends on a runner
// remembering this as a manual precondition.
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Root defaults to this script's own repo (so gate.sh can invoke it from
// anywhere with no cwd dependency); an explicit CLI arg overrides it, which
// scripts/gate-hygiene.test.mjs uses to point the script at a disposable
// fixture tree instead of the real repo's node_modules.
const REPO_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Workspace package list comes from pnpm-workspace.yaml (single source of
// truth — see scripts/workspace.test.mjs's own parsing of the same file) so
// this never drifts from the actual set of packages as they're added/removed.
function workspacePackages() {
  const text = readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  const packagesSection = text.match(/\npackages:\n([\s\S]*?)(\n\S|$)/) ?? text.match(/^packages:\n([\s\S]*?)(\n\S|$)/);
  const body = packagesSection ? packagesSection[1] : text;
  return [...body.matchAll(/-\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
}

function cleanTargetsFor(dir) {
  return [path.join(dir, "node_modules", ".vite"), path.join(dir, "node_modules", ".vite-temp")];
}

function main() {
  const packages = workspacePackages();
  if (packages.length === 0) {
    console.error("clean-vite-cache: could not parse any packages from pnpm-workspace.yaml — refusing to proceed silently.");
    process.exitCode = 1;
    return;
  }

  const dirs = [REPO_ROOT, ...packages.map((p) => path.join(REPO_ROOT, p))];
  const removed = [];
  const failed = [];

  for (const dir of dirs) {
    for (const target of cleanTargetsFor(dir)) {
      if (!existsSync(target)) continue;
      try {
        rmSync(target, { recursive: true, force: true });
        removed.push(path.relative(REPO_ROOT, target));
      } catch (err) {
        failed.push(`${path.relative(REPO_ROOT, target)}: ${err.message}`);
      }
    }
  }

  if (removed.length > 0) {
    console.log(`clean-vite-cache: removed ${removed.length} stale cache dir(s):\n  ${removed.join("\n  ")}`);
  } else {
    console.log("clean-vite-cache: nothing to clean (no node_modules/.vite or .vite-temp present).");
  }
  if (failed.length > 0) {
    console.error(`clean-vite-cache: failed to remove ${failed.length} dir(s):\n  ${failed.join("\n  ")}`);
    process.exitCode = 1;
  }
}

main();
