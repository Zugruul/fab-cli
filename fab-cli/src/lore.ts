/**
 * lore.ts — Flesh & Blood lore knowledge base, sourced from the `fablore` submodule
 * (https://github.com/nathaneastwood/fablore, published at legendarystories.net).
 *
 * The submodule under third_party/fablore is the source of truth (raw mdBook markdown).
 * We build a retrieval index (lore/index.json) and OKF files (lore/**.md with frontmatter)
 * from it, and search over it. Every result carries its source URL so answers can cite.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "..");
export const SUBMODULE_DIR = path.join(REPO_ROOT, "third_party", "fablore");
export const SRC_DIR = path.join(SUBMODULE_DIR, "src");
export const LORE_DIR = path.join(REPO_ROOT, "lore");
export const INDEX_PATH = path.join(LORE_DIR, "index.json");
export const STATE_PATH = path.join(LORE_DIR, ".sync-state.json");
export const SITE_BASE = "https://legendarystories.net";

// How long to trust the last upstream pull before auto-refreshing (env override).
export const SYNC_TTL_MS = Number(process.env.FAB_LORE_TTL_MS) || 24 * 60 * 60 * 1000;

// SUMMARY.md and browse.md are navigation, not lore content.
const SKIP_FILES = new Set(["SUMMARY.md", "browse.md"]);

export interface LoreDoc {
  path: string;       // relative to src, e.g. "heroes-of-rathe/arakni-about.md"
  sourceUrl: string;  // legendarystories.net/.../arakni-about.html
  title: string;
  section: string;    // top-level dir, e.g. "heroes-of-rathe"
  headings: string[];
  text: string;       // cleaned plaintext (for search + snippets)
}

export interface LoreIndex {
  builtAt: string;
  commit: string;     // submodule HEAD at build time
  count: number;
  docs: LoreDoc[];
}

// ── submodule freshness ───────────────────────────────────────────────────────

function git(args: string[], cwd = REPO_ROOT): string {
  // stdio: capture stdout, silence stderr (git submodule prints progress there).
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function submoduleCommit(): string {
  try { return git(["rev-parse", "HEAD"], SUBMODULE_DIR); } catch { return ""; }
}

interface SyncState { lastPullAt?: number }
function readState(): SyncState {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return {}; }
}
function writeState(s: SyncState): void {
  try { fs.mkdirSync(LORE_DIR, { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(s)); } catch { /* ignore */ }
}

/** True when the last successful upstream pull is older than the TTL (or never). */
export function isPullStale(ttlMs = SYNC_TTL_MS): boolean {
  const { lastPullAt } = readState();
  return !lastPullAt || Date.now() - lastPullAt > ttlMs;
}

/** Pull the latest upstream lore into the submodule. Tolerant of being offline. */
export function updateSubmodule(): { updated: boolean; commit: string; error?: string } {
  const before = submoduleCommit();
  try {
    git(["submodule", "update", "--remote", "--init", "third_party/fablore"]);
    writeState({ lastPullAt: Date.now() });
    const after = submoduleCommit();
    return { updated: before !== after, commit: after };
  } catch (e) {
    return { updated: false, commit: before, error: (e as Error).message };
  }
}

// ── parsing ───────────────────────────────────────────────────────────────────

function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "assets") continue;
      out.push(...walk(path.join(dir, entry.name), r));
    } else if (entry.name.endsWith(".md") && !SKIP_FILES.has(entry.name)) {
      out.push(r);
    }
  }
  return out;
}

/** Map "src/<rel>.md" → published URL "<base>/<rel>.html". */
export function sourceUrlFor(rel: string): string {
  return `${SITE_BASE}/${rel.replace(/\.md$/, ".html")}`;
}

/** Parse SUMMARY.md into a path→title map (authoritative titles/casing). */
function parseSummaryTitles(): Map<string, string> {
  const map = new Map<string, string>();
  const summary = path.join(SRC_DIR, "SUMMARY.md");
  if (!fs.existsSync(summary)) return map;
  const re = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
  const text = fs.readFileSync(summary, "utf8");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) map.set(m[2].replace(/^\.\//, ""), m[1].trim());
  return map;
}

/** Strip mdBook/HTML/markdown syntax down to readable plaintext. */
export function toPlainText(md: string): string {
  return md
    .replace(/<video[\s\S]*?<\/video>/gi, " ")
    .replace(/:::[a-z-]+[^\n]*/gi, " ")        // ::: directive openers
    .replace(/:::/g, " ")                       // directive closers
    .replace(/<[^>]+>/g, " ")                   // remaining HTML tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")      // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")    // links → text
    .replace(/^#{1,6}\s+/gm, "")                // heading markers
    .replace(/[*_`>]/g, "")                     // emphasis/code/quote marks
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHeadings(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[1].trim());
    const h = /<h[1-3][^>]*>([^<]+)<\/h[1-3]>/i.exec(line);
    if (h) out.push(h[1].trim());
  }
  return [...new Set(out)];
}

export function buildDocs(): LoreDoc[] {
  const titles = parseSummaryTitles();
  const files = walk(SRC_DIR).sort();
  const docs: LoreDoc[] = [];
  for (const rel of files) {
    const md = fs.readFileSync(path.join(SRC_DIR, rel), "utf8");
    const headings = extractHeadings(md);
    const title = titles.get(rel) || headings[0] || path.basename(rel, ".md");
    docs.push({
      path: rel,
      sourceUrl: sourceUrlFor(rel),
      title,
      section: rel.split("/")[0],
      headings,
      text: toPlainText(md),
    });
  }
  return docs;
}

// ── index build + OKF emit ─────────────────────────────────────────────────────

/** Build lore/index.json and OKF markdown files. Returns the index. */
export function buildIndex(opts: { emitOkf?: boolean } = {}): LoreIndex {
  const docs = buildDocs();
  const index: LoreIndex = {
    builtAt: new Date().toISOString(),
    commit: submoduleCommit(),
    count: docs.length,
    docs,
  };
  fs.mkdirSync(LORE_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
  if (opts.emitOkf) emitOkf(docs, index.commit);
  return index;
}

function yamlList(items: string[]): string {
  return items.length ? "\n" + items.map((h) => `  - ${JSON.stringify(h)}`).join("\n") : " []";
}

/** Write OKF (markdown + frontmatter) files mirroring the source tree. */
function emitOkf(docs: LoreDoc[], commit: string): void {
  for (const d of docs) {
    const body = fs.readFileSync(path.join(SRC_DIR, d.path), "utf8");
    const fm =
      `---\n` +
      `title: ${JSON.stringify(d.title)}\n` +
      `source_url: ${d.sourceUrl}\n` +
      `section: ${d.section}\n` +
      `headings:${yamlList(d.headings)}\n` +
      `fablore_commit: ${commit}\n` +
      `---\n\n`;
    const out = path.join(LORE_DIR, d.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, fm + body);
  }
}

export function loadIndex(): LoreIndex | null {
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as LoreIndex; }
  catch { return null; }
}

/**
 * Ensure the index reflects current lore. `update` controls the upstream pull:
 *   true   — always pull   ·   false — never pull   ·   "auto" — pull only if stale (TTL)
 * Rebuilds the index when missing or when the submodule commit changed.
 */
export function ensureIndex(opts: { update?: boolean | "auto"; emitOkf?: boolean; ttlMs?: number } = {}): {
  index: LoreIndex; rebuilt: boolean; pulled: boolean; skipped: boolean; offline?: string;
} {
  let offline: string | undefined;
  let pulled = false;
  const wantPull = opts.update === "auto" ? isPullStale(opts.ttlMs) : !!opts.update;
  if (wantPull) {
    const r = updateSubmodule();
    if (r.error) offline = r.error; else pulled = true;
  }
  const current = submoduleCommit();
  let index = loadIndex();
  let rebuilt = false;
  if (!index || index.commit !== current) {
    index = buildIndex({ emitOkf: opts.emitOkf });
    rebuilt = true;
  }
  return { index, rebuilt, pulled, skipped: opts.update === "auto" && !wantPull, offline };
}

// ── search ──────────────────────────────────────────────────────────────────

const STOP = new Set("the a an and or of to in is are was were be on for with at by from as into".split(" "));

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9']+/g) || []).filter((t) => t.length > 1 && !STOP.has(t));
}

function countOccurrences(haystack: string, term: string): number {
  let n = 0, i = 0;
  while ((i = haystack.indexOf(term, i)) !== -1) { n++; i += term.length; }
  return n;
}

export interface LoreHit {
  title: string;
  sourceUrl: string;
  path: string;
  section: string;
  score: number;
  snippet: string;
}

/**
 * Search the lore. By default the `archive/` section is EXCLUDED — it holds older,
 * superseded story that may no longer be canon. Pass includeArchive to opt in.
 */
export function search(
  index: LoreIndex,
  query: string,
  opts: { limit?: number; includeArchive?: boolean } = {}
): LoreHit[] {
  const limit = opts.limit ?? 8;
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const hits: LoreHit[] = [];
  for (const d of index.docs) {
    if (!opts.includeArchive && d.section === "archive") continue;
    const title = d.title.toLowerCase();
    const headings = d.headings.join(" \n ").toLowerCase();
    const text = d.text.toLowerCase();
    let score = 0, matched = 0;
    for (const t of terms) {
      const inTitle = countOccurrences(title, t);
      const inHead = countOccurrences(headings, t);
      const inText = countOccurrences(text, t);
      if (inTitle + inHead + inText > 0) matched++;
      score += inTitle * 8 + inHead * 4 + inText;
    }
    if (!matched) continue;
    score += matched === terms.length ? 5 : 0; // bonus when all terms present
    hits.push({
      title: d.title, sourceUrl: d.sourceUrl, path: d.path, section: d.section,
      score, snippet: makeSnippet(d.text, terms),
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function makeSnippet(text: string, terms: string[], radius = 160): string {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i !== -1 && (pos === -1 || i < pos)) pos = i; }
  if (pos === -1) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, pos - radius);
  const end = Math.min(text.length, pos + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

const norm = (s: string) => s.toLowerCase().replace(/\.md$|\.html$/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Resolve a doc by exact path, basename, or fuzzy (punctuation-insensitive) title/path match. */
export function findDoc(index: LoreIndex, key: string): LoreDoc | null {
  const k = norm(key);
  return (
    index.docs.find((d) => d.path.toLowerCase() === key.toLowerCase()) ||
    index.docs.find((d) => norm(d.title) === k) ||
    index.docs.find((d) => norm(d.path).endsWith(k)) ||
    index.docs.find((d) => norm(d.title).includes(k)) ||
    index.docs.find((d) => norm(d.path).includes(k)) ||
    null
  );
}

export function readDocBody(rel: string): string {
  return fs.readFileSync(path.join(SRC_DIR, rel), "utf8");
}
