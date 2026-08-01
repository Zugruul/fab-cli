import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// APP-001: fab-cli became a pnpm-workspace package one level below the
// monorepo root. `.claude/` (identities, skills, project.yaml, etc.) stays
// at the monorepo root — it does not move into fab-cli — so any test that
// reads under `.claude/` needs the root, not `process.cwd()`. cwd is NOT a
// reliable stand-in for "the fab-cli package dir": it holds for `pnpm -r`
// and for `vitest run` invoked from inside fab-cli/, but not for a
// `--config`-style invocation from repo root (e.g.
// `vitest --config fab-cli/vitest.config.ts run ...` run with cwd = repo
// root), which would then point one level too high. Derive the root from
// this file's own on-disk location instead — this file lives at
// fab-cli/test/helpers/monorepoRoot.ts, three directories below the
// monorepo root, regardless of the process's cwd.
export const MONOREPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
