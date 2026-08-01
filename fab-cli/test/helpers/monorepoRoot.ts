import { join } from "node:path";

// APP-001: fab-cli became a pnpm-workspace package one level below the
// monorepo root. `.claude/` (identities, skills, project.yaml, etc.) stays
// at the monorepo root — it does not move into fab-cli — so any test that
// reads under `.claude/` needs the root, not `process.cwd()` (which vitest
// always runs as the fab-cli package dir, whether invoked directly or via
// `pnpm -r`). fab-cli is a direct child of the root per pnpm-workspace.yaml,
// so one level up is always correct.
export const MONOREPO_ROOT = join(process.cwd(), "..");
