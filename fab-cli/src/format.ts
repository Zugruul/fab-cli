// Format alias resolution, shared by the CLI's --format flag handling.
// Extracted from cli.ts into its own module so it can be unit-tested in
// isolation (cli.ts calls program.parseAsync(process.argv) at import time,
// which makes it unsafe to import directly from tests).

export const FORMAT_ALIASES: Record<string, string> = {
  cc: "Classic Constructed",
  sa: "Silver Age",
  blitz: "Blitz",
  ll: "Living Legend",
  upf: "Ultimate Pit Fight",
  open: "Open",
  clash: "Clash",
};

export function resolveFormat(f?: string): string | undefined {
  if (!f) return undefined;
  return FORMAT_ALIASES[f.toLowerCase()] ?? f;
}
