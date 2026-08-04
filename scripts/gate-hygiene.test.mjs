// Gate hygiene (issue #263): stale node_modules/.vite / .vite-temp Vitest
// caches were observed being served through the gate's vitest entry path
// (`pnpm -r run gate`) instead of the current tree, fabricating failures
// that don't exist in the working tree. These tests exercise the actual
// removal/ordering/exit-code behavior of the fix — not just that a script
// file exists — since a shape-only test ("clean-vite-cache.mjs exists")
// would pass for a script that does nothing.
//
// Run: `node --test scripts/*.test.mjs` (root "test:scripts" script).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  realpathSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLEAN_SCRIPT = path.join(REPO_ROOT, "scripts", "clean-vite-cache.mjs");
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "gate.sh");

function makeFixtureWorkspace(packages) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "gate-hygiene-")));
  const yaml = `packages:\n${packages.map((p) => `  - ${p}`).join("\n")}\n`;
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), yaml);
  for (const pkg of packages) {
    mkdirSync(path.join(root, pkg), { recursive: true });
  }
  return root;
}

function seedViteCache(dir) {
  const viteDir = path.join(dir, "node_modules", ".vite", "vitest", "somehash");
  mkdirSync(viteDir, { recursive: true });
  writeFileSync(path.join(viteDir, "results.json"), '{"version":"4.1.10","results":[]}');
  const tempDir = path.join(dir, "node_modules", ".vite-temp");
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(path.join(tempDir, "scratch"), "x");
}

function runClean(root) {
  return spawnSync(process.execPath, [CLEAN_SCRIPT, root], { encoding: "utf8" });
}

test("clean-vite-cache: removes node_modules/.vite and .vite-temp for the root and every workspace package", () => {
  const root = makeFixtureWorkspace(["pkg-a", "pkg-b"]);
  try {
    seedViteCache(root);
    seedViteCache(path.join(root, "pkg-a"));
    seedViteCache(path.join(root, "pkg-b"));

    const result = runClean(root);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);

    for (const dir of [root, path.join(root, "pkg-a"), path.join(root, "pkg-b")]) {
      assert.ok(!existsSync(path.join(dir, "node_modules", ".vite")), `${dir}/node_modules/.vite should be removed`);
      assert.ok(
        !existsSync(path.join(dir, "node_modules", ".vite-temp")),
        `${dir}/node_modules/.vite-temp should be removed`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clean-vite-cache: does not touch node_modules/.vite in a directory that is neither the root nor a listed package", () => {
  const root = makeFixtureWorkspace(["pkg-a"]);
  try {
    const unrelated = path.join(root, "pkg-a", "some-nested-thing");
    mkdirSync(unrelated, { recursive: true });
    seedViteCache(unrelated);
    seedViteCache(path.join(root, "pkg-a"));

    const result = runClean(root);
    assert.equal(result.status, 0);

    assert.ok(
      existsSync(path.join(unrelated, "node_modules", ".vite")),
      "an unrelated nested directory's cache must be left alone — this is scoped cleanup, not a wildcard sweep",
    );
    assert.ok(!existsSync(path.join(root, "pkg-a", "node_modules", ".vite")), "the listed package's cache must still be removed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clean-vite-cache: is idempotent — a second run against an already-clean tree still exits 0", () => {
  const root = makeFixtureWorkspace(["pkg-a"]);
  try {
    seedViteCache(path.join(root, "pkg-a"));
    const first = runClean(root);
    assert.equal(first.status, 0);
    const second = runClean(root);
    assert.equal(second.status, 0, `second run on a clean tree should still exit 0\n${second.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clean-vite-cache: exits non-zero when pnpm-workspace.yaml has no packages section, rather than silently cleaning nothing", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "gate-hygiene-")));
  try {
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "# no packages here\n");
    const result = runClean(root);
    assert.notEqual(result.status, 0, "a config the script can't parse must fail loudly, not report a silent no-op success");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- gate.sh: ordering + exit-code + discriminator-guidance behavior ---
// GATE_CMD overrides the real `pnpm -r --if-present run gate` invocation so
// these tests exercise gate.sh's own control flow (clean-first ordering,
// exit-code propagation, conditional guidance text) without needing an
// actual, expensive workspace gate run.

function runGate(root, gateCmd) {
  return spawnSync("bash", [GATE_SCRIPT], {
    cwd: root,
    env: { ...process.env, GATE_CMD: gateCmd },
    encoding: "utf8",
  });
}

// gate.sh resolves its own directory via BASH_SOURCE and computes ROOT as
// its parent — so to run gate.sh against a fixture tree, the fixture needs
// its own scripts/gate.sh alongside scripts/clean-vite-cache.mjs.
function makeGateFixture(packages) {
  const root = makeFixtureWorkspace(packages);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "scripts", "gate.sh"), "placeholder"); // overwritten below via copy
  return root;
}

function installGateScripts(root) {
  copyFileSync(GATE_SCRIPT, path.join(root, "scripts", "gate.sh"));
  chmodSync(path.join(root, "scripts", "gate.sh"), 0o755);
  copyFileSync(CLEAN_SCRIPT, path.join(root, "scripts", "clean-vite-cache.mjs"));
}

test("gate.sh: clears vite caches before running the configured gate command", () => {
  const root = makeGateFixture(["pkg-a"]);
  try {
    installGateScripts(root);
    seedViteCache(root);
    seedViteCache(path.join(root, "pkg-a"));

    // A gate command that fails unless the caches are already gone by the
    // time it runs — proves clean-first ordering, not just "clean happens
    // somewhere before process exit".
    const gateCmd =
      "test ! -e node_modules/.vite && test ! -e node_modules/.vite-temp && test ! -e pkg-a/node_modules/.vite";
    const result = runGate(root, gateCmd);
    assert.equal(result.status, 0, `expected the ordering check to pass\nstdout:${result.stdout}\nstderr:${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gate.sh: propagates the real gate command's exact exit code on failure", () => {
  const root = makeGateFixture([]);
  try {
    installGateScripts(root);
    const result = runGate(root, "exit 7");
    assert.equal(result.status, 7, "gate.sh must forward the underlying gate command's exit code, not swallow/replace it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gate.sh: prints the nondeterminism + entry-path discriminators when the gate fails", () => {
  const root = makeGateFixture([]);
  try {
    installGateScripts(root);
    const result = runGate(root, "false");
    assert.notEqual(result.status, 0);
    const output = result.stdout + result.stderr;
    assert.match(output, /[Nn]ondeterminism/, "failure guidance must mention the nondeterminism discriminator");
    assert.match(output, /[Ee]ntry-path/, "failure guidance must mention the entry-path-disagreement discriminator");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gate.sh: does NOT print discriminator guidance when the gate passes", () => {
  const root = makeGateFixture([]);
  try {
    installGateScripts(root);
    const result = runGate(root, "true");
    assert.equal(result.status, 0);
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /[Nn]ondeterminism/, "a green gate must not print red-gate guidance text");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
