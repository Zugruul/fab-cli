import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Config } from "./types";
import { refreshAccessToken } from "./cognito";

const CONFIG_DIR = path.join(os.homedir(), ".config", "fabrary-search");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Refresh 5 minutes before expiry
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function loadConfig(): Config {
  try {
    const data = fs.readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(data) as Config;
  } catch {
    return {};
  }
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getAuthToken(): string | undefined {
  if (process.env.FABRARY_TOKEN) return process.env.FABRARY_TOKEN;
  return loadConfig().authToken;
}

/**
 * Returns a valid access token, auto-refreshing via the stored refresh token
 * if the access token is near expiry or force is requested.
 * Throws if no credentials are stored or forced refresh fails.
 */
export async function getValidToken(opts?: { force?: boolean }): Promise<string> {
  if (process.env.FABRARY_TOKEN) return process.env.FABRARY_TOKEN;

  const cfg = loadConfig();

  if (!cfg.authToken) {
    throw new Error("No auth token. Run: fab login");
  }

  const needsRefresh =
    cfg.refreshToken &&
    (opts?.force ||
      (cfg.tokenExpiry && Date.now() >= cfg.tokenExpiry - EXPIRY_BUFFER_MS));

  if (needsRefresh) {
    try {
      const tokens = await refreshAccessToken(cfg.refreshToken!);
      const updated: Config = {
        ...cfg,
        authToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiry: tokens.expiresAt,
      };
      saveConfig(updated);
      return tokens.accessToken;
    } catch (e) {
      if (opts?.force) throw e;
      // Soft refresh failed — return the existing token; API call may still work
      return cfg.authToken;
    }
  }

  return cfg.authToken;
}
