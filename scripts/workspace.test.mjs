// Structural test for the pnpm-workspaces monorepo restructure (APP-001).
// Run from the repo root: `node --test scripts/*.test.mjs` (wired as root
// package.json's "test:scripts" script). Asserts the shape of the restructure,
// not behavior — behavior is covered by each package's own test suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("pnpm-workspace.yaml lists the three workspace packages", () => {
  assert.ok(existsSync("pnpm-workspace.yaml"), "pnpm-workspace.yaml must exist at repo root");
  const text = readFileSync("pnpm-workspace.yaml", "utf8");
  for (const pkg of ["fab-cli", "fab-app", "pipeline"]) {
    assert.match(
      text,
      new RegExp(`(^|\\n)\\s*-\\s*["']?${pkg}["']?\\s*(\\n|$)`),
      `pnpm-workspace.yaml must list "${pkg}"`,
    );
  }
});

test("each workspace package has its own package.json", () => {
  for (const dir of ["fab-cli", "fab-app", "pipeline"]) {
    const pkgPath = `${dir}/package.json`;
    assert.ok(existsSync(pkgPath), `${pkgPath} must exist`);
    const pkg = readJson(pkgPath);
    assert.ok(pkg.name, `${pkgPath} must declare a name`);
  }
});

test("root package.json is private and exposes gate + test scripts", () => {
  assert.ok(existsSync("package.json"), "root package.json must exist");
  const pkg = readJson("package.json");
  assert.equal(pkg.private, true, "root package.json must be private");
  assert.ok(pkg.scripts?.gate, "root package.json must define a gate script");
  assert.ok(
    pkg.scripts?.["test:run"] || pkg.scripts?.test,
    "root package.json must define a test script",
  );
});

test("fab-cli/package.json still declares its bin entry", () => {
  const pkg = readJson("fab-cli/package.json");
  assert.ok(pkg.bin && pkg.bin["fab-cli"], "fab-cli/package.json must keep its bin entry");
});
