import chalk from "chalk";
import type { Command } from "commander";
import { getValidToken } from "../config";

export const int = (v: string) => parseInt(v, 10);

/** True when `--json` was passed anywhere in the command chain (it's a global option). */
export function wantsJson(command: Command): boolean {
  return Boolean((command.optsWithGlobals() as { json?: boolean }).json);
}

/** Emits machine-readable JSON with no ANSI/table decoration. Map values (e.g. stats
 *  distributions) are flattened to plain objects — JSON.stringify would otherwise
 *  silently emit `{}` for them. */
export function printJson(data: unknown): void {
  console.log(
    JSON.stringify(
      data,
      (_key, value) => (value instanceof Map ? Object.fromEntries(value) : value),
      2,
    ),
  );
}

/** Progress-indicator write that's suppressed entirely in --json mode (keeps stdout ANSI-free). */
export function progressWrite(json: boolean, text: string): void {
  if (!json) process.stdout.write(text);
}

/**
 * Calls fn(token), auto-refreshing on 401 (e.g. when a browser session revoked
 * the stored token). Exits with an error message if not logged in at all.
 */
export async function callWithToken<T>(
  fn: (token: string) => Promise<T>,
): Promise<T> {
  let token: string;
  try {
    token = await getValidToken();
  } catch {
    console.error(chalk.red("Not logged in. Run: fab-cli fabrary login"));
    return process.exit(1);
  }
  try {
    return await fn(token);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("401")) {
      let fresh: string;
      try {
        fresh = await getValidToken({ force: true });
      } catch {
        console.error(chalk.red("Session expired. Run: fab-cli fabrary login"));
        return process.exit(1);
      }
      return await fn(fresh);
    }
    throw e;
  }
}
