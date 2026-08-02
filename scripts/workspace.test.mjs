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

test("pnpm-workspace.yaml lists the four workspace packages", () => {
  assert.ok(existsSync("pnpm-workspace.yaml"), "pnpm-workspace.yaml must exist at repo root");
  const text = readFileSync("pnpm-workspace.yaml", "utf8");
  for (const pkg of ["fab-cli", "fab-app", "pipeline", "manifest-schema"]) {
    assert.match(
      text,
      new RegExp(`(^|\\n)\\s*-\\s*["']?${pkg}["']?\\s*(\\n|$)`),
      `pnpm-workspace.yaml must list "${pkg}"`,
    );
  }
});

test("each workspace package has its own package.json", () => {
  for (const dir of ["fab-cli", "fab-app", "pipeline", "manifest-schema"]) {
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

// Per-package licensing (APP-004): fab-cli stays GPL-3.0 (human decision,
// recorded 2026-08-01, docs/spec-deltas/APP-004.md); fab-app and pipeline are
// MIT (App-Store-bound). Each package's license field must match its LICENSE
// file, and the root LICENSE.md must no longer make a repo-wide GPL claim.

test("fab-cli/package.json declares GPL-3.0-only and has a matching LICENSE file", () => {
  const pkg = readJson("fab-cli/package.json");
  assert.equal(pkg.license, "GPL-3.0-only", "fab-cli/package.json license field must be GPL-3.0-only");
  assert.ok(existsSync("fab-cli/LICENSE"), "fab-cli/LICENSE must exist");
  const text = readFileSync("fab-cli/LICENSE", "utf8");
  assert.match(text, /GNU GENERAL PUBLIC LICENSE/, "fab-cli/LICENSE must be GPL-3.0 text");
  assert.match(text, /Version 3/, "fab-cli/LICENSE must be GPL version 3");
});

for (const dir of ["fab-app", "pipeline", "manifest-schema"]) {
  test(`${dir}/package.json declares MIT and has a matching LICENSE file`, () => {
    const pkg = readJson(`${dir}/package.json`);
    assert.equal(pkg.license, "MIT", `${dir}/package.json license field must be MIT`);
    assert.ok(existsSync(`${dir}/LICENSE`), `${dir}/LICENSE must exist`);
    const text = readFileSync(`${dir}/LICENSE`, "utf8");
    assert.match(text, /MIT License/, `${dir}/LICENSE must be MIT text`);
  });
}

test("root LICENSE.md is a per-package pointer, not a repo-wide GPL claim", () => {
  const text = readFileSync("LICENSE.md", "utf8");
  assert.doesNotMatch(
    text,
    /GNU GENERAL PUBLIC LICENSE/,
    "root LICENSE.md must not contain the full GPL text (that belongs to fab-cli/LICENSE only)",
  );
  for (const pkg of ["fab-cli", "fab-app", "pipeline", "manifest-schema"]) {
    assert.match(text, new RegExp(pkg), `root LICENSE.md must mention ${pkg}`);
  }
  assert.match(text, /GPL-3\.0/, "root LICENSE.md must note fab-cli's GPL-3.0-only license");
  assert.match(text, /MIT/, "root LICENSE.md must note fab-app/pipeline's MIT license");
});

test("root package.json has no repo-wide license claim (private monorepo root)", () => {
  const pkg = readJson("package.json");
  assert.ok(
    pkg.license === undefined || pkg.license === "SEE LICENSE IN LICENSE.md",
    'root package.json license field must be absent or "SEE LICENSE IN LICENSE.md" (private, never published)',
  );
});

test("GPL isolation: fab-app, pipeline, and manifest-schema must never depend on fab-cli (workspace or otherwise)", () => {
  const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const forbidden = ["fab-cli", "fabrary-search"];
  for (const dir of ["fab-app", "pipeline", "manifest-schema"]) {
    const pkg = readJson(`${dir}/package.json`);
    for (const field of depFields) {
      const deps = pkg[field];
      if (!deps) continue;
      // Check both the dependency name (key) and its spec (value) — pnpm
      // aliasing lets a dependency point at fab-cli under an unrelated key,
      // e.g. {"cliTools": "npm:fabrary-search@workspace:*"} or a raw
      // link:/file: path — so the key check alone is bypassable.
      for (const [name, spec] of Object.entries(deps)) {
        assert.ok(
          !forbidden.includes(name),
          `${dir}/package.json ${field} must not depend on fab-cli (GPL isolation, App-Store-bound MIT packages)`,
        );
        assert.ok(
          !forbidden.some((f) => String(spec).includes(f)),
          `${dir}/package.json ${field}["${name}"] must not reference fab-cli in its spec (GPL isolation) — got "${spec}"`,
        );
      }
    }
  }
});

// APP-003: after APP-001 moved the pre-existing specs' files into fab-cli/,
// .claude/project.yaml's specs[] paths must be updated to match — a stale
// specPath/backlogPath silently breaks the board tooling for that spec.

test("every spec in .claude/project.yaml has specPath and backlogPath pointing at files that exist on disk", () => {
  const text = readFileSync(".claude/project.yaml", "utf8");
  const specsSectionMatch = text.match(/\nspecs:\n([\s\S]*?)\ncommands:\n/);
  assert.ok(specsSectionMatch, ".claude/project.yaml must have a specs: section followed by commands:");
  const specBlocks = [...specsSectionMatch[1].matchAll(/-\s{3}id:\s*(\S+)[\s\S]*?(?=\n-\s{3}id:|$)/g)];
  assert.ok(specBlocks.length > 0, "expected at least one spec entry under specs:");
  for (const block of specBlocks) {
    const id = block[1];
    const specPath = block[0].match(/specPath:\s*(\S+)/)?.[1];
    const backlogPath = block[0].match(/backlogPath:\s*(\S+)/)?.[1];
    assert.ok(specPath, `spec "${id}" must declare specPath`);
    assert.ok(backlogPath, `spec "${id}" must declare backlogPath`);
    assert.ok(
      existsSync(specPath),
      `spec "${id}" specPath "${specPath}" must exist on disk (relative to repo root)`,
    );
    assert.ok(
      existsSync(backlogPath),
      `spec "${id}" backlogPath "${backlogPath}" must exist on disk (relative to repo root)`,
    );
  }
});
