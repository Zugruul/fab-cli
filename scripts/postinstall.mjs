#!/usr/bin/env node
/**
 * postinstall — make sure git submodules (notably third_party/fablore, the lore
 * source) are initialized and updated whenever the package is installed.
 *
 * Best-effort: silently no-ops outside a git checkout (e.g. a plain global copy
 * with no .git), and never fails the install. The lore index is built lazily on
 * the first `fab-cli lore` command, and refreshed periodically thereafter.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Only attempt when this is a real git checkout (dev/linked install).
if (!existsSync(join(root, ".git")) && !existsSync(join(root, ".gitmodules"))) {
  process.exit(0);
}

try {
  execSync("git submodule update --init --recursive", { cwd: root, stdio: "ignore" });
  console.log("[fab-cli] fablore submodule initialized/updated.");
} catch {
  // No git, no network, or not a checkout — fine. Lore degrades gracefully.
}
