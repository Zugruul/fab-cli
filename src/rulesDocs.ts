import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * Vendored official FAB rules documents (verification artifacts).
 * The identity brains are the source of truth for answering; these copies are
 * what answers get double-checked against. Card legality is deliberately NOT
 * vendored — always fetch it live:
 * https://fabtcg.com/rules-and-policy-center/card-legality-policy/
 */

const BASE = "https://rules.fabtcg.com/txt/latest";
const REPO_ROOT = path.resolve(__dirname, "..");
export const RULES_DIR = path.join(REPO_ROOT, "third_party", "fab-rules");

interface DocSpec {
  file: string;
  /** substring that must appear near the top of a genuine download */
  sentinel: string;
  /** minimum plausible size in bytes — guards against truncated/error bodies */
  minBytes: number;
}

const DOCS: DocSpec[] = [
  { file: "en-fab-cr.txt", sentinel: "Comprehensive Rules", minBytes: 200_000 },
  { file: "en-fab-trp.txt", sentinel: "Tournament", minBytes: 50_000 },
  { file: "en-fab-ppg.txt", sentinel: "Penalt", minBytes: 30_000 },
];

export interface DocUpdateResult {
  file: string;
  status: "updated" | "unchanged" | "failed";
  detail: string;
  lastModified?: string;
}

async function fetchDoc(spec: DocSpec): Promise<{ text: string; lastModified: string } | { error: string }> {
  const url = `${BASE}/${spec.file}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e: any) {
    return { error: `network error: ${e?.message ?? e}` };
  }
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const text = await res.text();
  // corruption / bad-download guards: size, sentinel content, no HTML error page
  if (Buffer.byteLength(text) < spec.minBytes) return { error: `too small (${Buffer.byteLength(text)} bytes < ${spec.minBytes})` };
  const head = text.slice(0, 2000);
  if (!text.toLowerCase().includes(spec.sentinel.toLowerCase())) return { error: `sentinel "${spec.sentinel}" not found — not the expected document` };
  if (/<html|<!doctype/i.test(head)) return { error: "response looks like an HTML page, not the txt document" };
  return { text, lastModified: res.headers.get("last-modified") ?? "unknown" };
}

/** Download all docs; only replace a file when the download validates. Returns per-doc results. */
export async function updateRulesDocs(): Promise<DocUpdateResult[]> {
  fs.mkdirSync(RULES_DIR, { recursive: true });
  const results: DocUpdateResult[] = [];
  for (const spec of DOCS) {
    const dest = path.join(RULES_DIR, spec.file);
    const fetched = await fetchDoc(spec);
    if ("error" in fetched) {
      results.push({ file: spec.file, status: "failed", detail: fetched.error });
      continue;
    }
    const existing = fs.existsSync(dest) ? fs.readFileSync(dest, "utf-8") : null;
    if (existing === fetched.text) {
      results.push({ file: spec.file, status: "unchanged", detail: "identical to vendored copy", lastModified: fetched.lastModified });
    } else {
      fs.writeFileSync(dest, fetched.text);
      results.push({ file: spec.file, status: "updated", detail: existing === null ? "first download" : "content changed", lastModified: fetched.lastModified });
    }
  }
  // regenerate VERSIONS.txt only from successful docs
  const ok = results.filter((r) => r.status !== "failed");
  if (ok.length > 0) {
    const lines = [`# Vendored FAB rules documents — refreshed ${new Date().toISOString()}`];
    for (const r of ok) {
      const p = path.join(RULES_DIR, r.file);
      const n = fs.readFileSync(p, "utf-8").split("\n").length;
      lines.push(`${r.file}  last-modified: ${r.lastModified}  lines: ${n}`);
    }
    fs.writeFileSync(path.join(RULES_DIR, "VERSIONS.txt"), lines.join("\n") + "\n");
  }
  return results;
}

/** Commit third_party/fab-rules changes if any doc actually changed. Returns commit hash or null. */
export function commitRulesDocs(results: DocUpdateResult[]): string | null {
  if (!results.some((r) => r.status === "updated")) return null;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
  git("add", "third_party/fab-rules");
  // nothing staged (e.g. only VERSIONS timestamp diff already committed)? bail quietly
  const staged = git("diff", "--cached", "--name-only", "--", "third_party/fab-rules");
  if (!staged) return null;
  const changed = results.filter((r) => r.status === "updated").map((r) => r.file).join(", ");
  git("commit", "-m", `Update vendored FAB rules documents (${changed})`);
  return git("rev-parse", "--short", "HEAD");
}
