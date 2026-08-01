#!/usr/bin/env node
/**
 * postinstall — make sure ALL git submodules are initialized and updated to
 * their pinned commits whenever the package is installed:
 *   - third_party/fablore                  (lore source, legendarystories.net)
 *   - third_party/flesh-and-blood-cards    (full card corpus; the card-vault
 *     brain's card-* notes are generated from it — pinned commit matches them)
 *
 * Pinned on purpose (no --remote): a fresh clone reproduces exactly the corpus
 * the committed knowledge was generated from. Freshness bumps are explicit:
 * `git submodule update --remote <path>` + regenerate + commit.
 *
 * Best-effort: silently no-ops outside a git checkout (e.g. a plain global copy
 * with no .git), and never fails the install. The lore index is built lazily on
 * the first `fab-cli lore` command, and refreshed periodically thereafter.
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Only attempt when this is a real git checkout (dev/linked install). fab-cli
// lives as a workspace package inside a monorepo, so its own .git/.gitmodules
// don't exist here — `git` itself walks up to find the repo root (or the
// superproject root when fab-cli sits inside a submodule), so ask it directly
// instead of checking for .git/.gitmodules next to this file.
try {
  execSync("git rev-parse --is-inside-work-tree", { cwd: root, stdio: "ignore" });
} catch {
  process.exit(0);
}

try {
  execSync("git submodule update --init --recursive", { cwd: root, stdio: "ignore" });
  console.log("[fab-cli] git submodules initialized/updated (fablore, flesh-and-blood-cards).");
} catch {
  // No git, no network, or not a checkout — fine. Lore degrades gracefully.
}
