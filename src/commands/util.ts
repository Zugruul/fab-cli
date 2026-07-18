import chalk from "chalk";
import { getValidToken } from "../config";

export const int = (v: string) => parseInt(v, 10);

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
