/**
 * rules.ts — official FAB rules knowledge base (CR, TRP, PPG, CPG, legality),
 * following the `src/lore.ts` pattern: frontmatter markdown chunks under
 * kb/rules/<document>/ + a rebuildable kb/rules/index.json, both git-ignored.
 *
 * CR/TRP/PPG are re-chunked from the vendored third_party/fab-rules/*.txt
 * files (kept fresh by src/rulesDocs.ts::updateRulesDocs(), reused here
 * rather than duplicating fetch/validate logic). CPG is extracted from the
 * vendored Casual Procedure Guide PDF. Legality is fetched live from
 * fabtcg.com on every sync call — never TTL'd (§10 I2).
 */
import * as fs from "node:fs";
import * as path from "node:path";
// pdf-parse@1.x ships no ESM/typed default export shape beyond a callable function.
import pdfParse = require("pdf-parse");
import { updateRulesDocs, RULES_DIR } from "./rulesDocs";
import { httpFetch } from "./http";

export const REPO_ROOT = path.resolve(__dirname, "..");
export const KB_RULES_DIR = path.join(REPO_ROOT, "kb", "rules");
export const CPG_PDF_PATH = path.join(
  REPO_ROOT,
  "docs",
  "references",
  "FaB_Casual_Procedure_Guide_2023-10-13.pdf",
);
export const LEGALITY_URL =
  "https://fabtcg.com/rules-and-policy-center/card-legality-policy/";
export const RULES_TXT_BASE = "https://rules.fabtcg.com/txt/latest";

export type RulesDocument = "CR" | "TRP" | "PPG" | "CPG" | "legality";

export interface RulesChunk {
  document: RulesDocument;
  section: string;
  title: string;
  sourceUrl: string;
  version: string;
  fetchedAt: string;
  text: string;
}

export interface RulesIndex {
  builtAt: string;
  count: number;
  chunks: RulesChunk[];
}

export interface RulesSyncResult {
  document: string;
  chunks: number;
  status: "ok" | "failed";
  detail?: string;
}

export interface SyncRulesOptions {
  /** Override the vendored CPG PDF path (for tests). */
  cpgPdfPath?: string;
  /** Override the live legality policy URL (for tests). */
  legalityUrl?: string;
  /** Override the kb/rules/ output directory (for tests). */
  kbDir?: string;
  /** Override the vendored third_party/fab-rules/ directory (for tests). */
  rulesDir?: string;
}

// ── chunk file I/O ──────────────────────────────────────────────────────────

function docDir(kbDir: string, document: RulesDocument): string {
  return path.join(kbDir, document.toLowerCase());
}

function slugSection(section: string): string {
  return (
    section
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function countExistingChunks(kbDir: string, document: RulesDocument): number {
  const dir = docDir(kbDir, document);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length;
}

/** Delete all chunk files for a document (supersession), then write the fresh set. */
function replaceChunks(
  kbDir: string,
  document: RulesDocument,
  chunks: RulesChunk[],
): void {
  const dir = docDir(kbDir, document);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const seen = new Map<string, number>();
  for (const chunk of chunks) {
    let slug = slugSection(chunk.section);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n + 1}`;
    fs.writeFileSync(path.join(dir, `${slug}.md`), renderChunkFile(chunk));
  }
}

function renderChunkFile(chunk: RulesChunk): string {
  const fm =
    `---\n` +
    `document: ${chunk.document}\n` +
    `section: ${JSON.stringify(chunk.section)}\n` +
    `title: ${JSON.stringify(chunk.title)}\n` +
    `source_url: ${chunk.sourceUrl}\n` +
    `version: ${JSON.stringify(chunk.version)}\n` +
    `fetched_at: ${chunk.fetchedAt}\n` +
    `---\n\n`;
  return fm + chunk.text.trim() + "\n";
}

function parseChunkFile(raw: string): RulesChunk | null {
  const m = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const fmLines = m[1].split("\n");
  const get = (key: string): string => {
    const line = fmLines.find((l) => l.startsWith(`${key}:`));
    if (!line) return "";
    const v = line.slice(key.length + 1).trim();
    try {
      return v.startsWith('"') ? (JSON.parse(v) as string) : v;
    } catch {
      return v;
    }
  };
  return {
    document: get("document") as RulesDocument,
    section: get("section"),
    title: get("title"),
    sourceUrl: get("source_url"),
    version: get("version"),
    fetchedAt: get("fetched_at"),
    text: m[2].replace(/\n$/, ""),
  };
}

/** Rebuild kb/rules/index.json from every chunk file currently on disk. */
export function rebuildIndex(kbDir: string = KB_RULES_DIR): RulesIndex {
  const chunks: RulesChunk[] = [];
  if (fs.existsSync(kbDir)) {
    for (const entry of fs.readdirSync(kbDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(kbDir, entry.name);
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const chunk = parseChunkFile(
          fs.readFileSync(path.join(dir, file), "utf8"),
        );
        if (chunk) chunks.push(chunk);
      }
    }
  }
  const index: RulesIndex = {
    builtAt: new Date().toISOString(),
    count: chunks.length,
    chunks,
  };
  fs.mkdirSync(kbDir, { recursive: true });
  fs.writeFileSync(path.join(kbDir, "index.json"), JSON.stringify(index));
  return index;
}

// ── CR/TRP/PPG chunking (numbered-section headings) ─────────────────────────

export interface ChunkSeed {
  section: string;
  title: string;
  text: string;
}

const SECTION_HEADING_RE = /^(\d+(?:\.\d+)*)\s+(.+)$/;

/** Chunk a CR/TRP/PPG txt document by its own numbered-section heading lines
 *  (e.g. "1.1 Players"); non-heading lines (including lettered sub-rules like
 *  "1.0.1a …") are folded into the preceding heading's chunk. */
export function chunkNumberedDoc(content: string): ChunkSeed[] {
  const chunks: ChunkSeed[] = [];
  let current: { section: string; title: string; lines: string[] } | null =
    null;
  for (const line of content.split("\n")) {
    const m = SECTION_HEADING_RE.exec(line.trim());
    if (m) {
      if (current) {
        chunks.push({
          section: current.section,
          title: current.title,
          text: current.lines.join("\n").trim(),
        });
      }
      current = { section: m[1], title: m[2].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    chunks.push({
      section: current.section,
      title: current.title,
      text: current.lines.join("\n").trim(),
    });
  }
  return chunks;
}

function readVersions(rulesDir: string): Record<string, string> {
  const file = path.join(rulesDir, "VERSIONS.txt");
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^(\S+)\s+last-modified:\s*(.+?)\s+lines:/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const TXT_DOCS: { document: RulesDocument; file: string }[] = [
  { document: "CR", file: "en-fab-cr.txt" },
  { document: "TRP", file: "en-fab-trp.txt" },
  { document: "PPG", file: "en-fab-ppg.txt" },
];

function syncTxtDoc(
  kbDir: string,
  rulesDir: string,
  document: RulesDocument,
  file: string,
  fetchedAt: string,
): RulesSyncResult {
  const srcPath = path.join(rulesDir, file);
  if (!fs.existsSync(srcPath)) {
    return {
      document,
      chunks: countExistingChunks(kbDir, document),
      status: "failed",
      detail: `vendored file missing: ${file}`,
    };
  }
  try {
    const content = fs.readFileSync(srcPath, "utf8");
    const seeds = chunkNumberedDoc(content);
    const version = readVersions(rulesDir)[file] ?? "unknown";
    const sourceUrl = `${RULES_TXT_BASE}/${file}`;
    const chunks: RulesChunk[] = seeds.map((s) => ({
      document,
      section: s.section,
      title: s.title,
      sourceUrl,
      version,
      fetchedAt,
      text: s.text,
    }));
    replaceChunks(kbDir, document, chunks);
    return { document, chunks: chunks.length, status: "ok" };
  } catch (e) {
    return {
      document,
      chunks: countExistingChunks(kbDir, document),
      status: "failed",
      detail: (e as Error).message,
    };
  }
}

// ── CPG chunking (vendored PDF, heading-structure) ──────────────────────────

// A CPG heading is a short standalone line starting with a capital letter
// (e.g. "Gameplay Errors", "A player forgets a triggered effect") that forms
// a complete "paragraph" of its own — never a body line, since those wrap
// across multiple lines and only their first line starts with a capital
// (and body first-lines run much longer than a heading's <=11 words).
const CPG_HEADING_RE = /^[A-Z][a-zA-Z’']*(?:\s+[a-zA-Z’']+){0,10}$/;

/** Chunk CPG plaintext (as extracted by pdf-parse) by its heading structure. */
export function chunkCpgText(text: string): ChunkSeed[] {
  const chunks: ChunkSeed[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (CPG_HEADING_RE.test(line)) {
      if (current) {
        chunks.push({
          section: slugSection(current.title),
          title: current.title,
          text: current.lines.join(" ").trim(),
        });
      }
      current = { title: line, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    chunks.push({
      section: slugSection(current.title),
      title: current.title,
      text: current.lines.join(" ").trim(),
    });
  }
  return chunks;
}

function versionFromCpgFilename(p: string): string {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(path.basename(p));
  return m ? m[1] : "unknown";
}

async function syncCpg(
  kbDir: string,
  fetchedAt: string,
  pdfPath: string,
): Promise<RulesSyncResult> {
  if (!fs.existsSync(pdfPath)) {
    return {
      document: "CPG",
      chunks: countExistingChunks(kbDir, "CPG"),
      status: "failed",
      detail: `vendored PDF missing: ${pdfPath}`,
    };
  }
  try {
    const buf = fs.readFileSync(pdfPath);
    const parsed = await pdfParse(buf);
    const seeds = chunkCpgText(parsed.text);
    const version = versionFromCpgFilename(pdfPath);
    const sourceUrl = `vendored:${path.relative(REPO_ROOT, pdfPath)}`;
    const chunks: RulesChunk[] = seeds.map((s) => ({
      document: "CPG",
      section: s.section,
      title: s.title,
      sourceUrl,
      version,
      fetchedAt,
      text: s.text,
    }));
    replaceChunks(kbDir, "CPG", chunks);
    return { document: "CPG", chunks: chunks.length, status: "ok" };
  } catch (e) {
    return {
      document: "CPG",
      chunks: countExistingChunks(kbDir, "CPG"),
      status: "failed",
      detail: (e as Error).message,
    };
  }
}

// ── legality (live fetch, single chunk, never TTL'd) ────────────────────────

function extractMainHtml(html: string): string {
  const main =
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html) ||
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  return main ? main[1] : html;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function syncLegality(
  kbDir: string,
  fetchedAt: string,
  url: string,
): Promise<RulesSyncResult> {
  try {
    const res = await httpFetch(url, { preset: "fabtcg" });
    if (!res.ok) {
      return {
        document: "legality",
        chunks: countExistingChunks(kbDir, "legality"),
        status: "failed",
        detail: `HTTP ${res.status}`,
      };
    }
    const html = await res.text();
    const text = stripHtml(extractMainHtml(html));
    const chunk: RulesChunk = {
      document: "legality",
      section: "current",
      title: "Card Legality Policy",
      sourceUrl: url,
      version: "live",
      fetchedAt,
      text,
    };
    replaceChunks(kbDir, "legality", [chunk]);
    return { document: "legality", chunks: 1, status: "ok" };
  } catch (e) {
    return {
      document: "legality",
      chunks: countExistingChunks(kbDir, "legality"),
      status: "failed",
      detail: (e as Error).message,
    };
  }
}

// ── orchestration ────────────────────────────────────────────────────────

/** Sync the full rules KB (CR, TRP, PPG, CPG, legality) into kb/rules/.
 *  Per-source failure isolation: a failure in one source never blocks the
 *  others. Legality is re-fetched live on every call, unconditionally. */
export async function syncRules(
  opts: SyncRulesOptions = {},
): Promise<RulesSyncResult[]> {
  const kbDir = opts.kbDir ?? KB_RULES_DIR;
  const rulesDir = opts.rulesDir ?? RULES_DIR;
  const cpgPdfPath = opts.cpgPdfPath ?? CPG_PDF_PATH;
  const legalityUrl = opts.legalityUrl ?? LEGALITY_URL;
  const fetchedAt = new Date().toISOString();

  await updateRulesDocs();

  const results: RulesSyncResult[] = [];
  for (const { document, file } of TXT_DOCS) {
    results.push(syncTxtDoc(kbDir, rulesDir, document, file, fetchedAt));
  }
  results.push(await syncCpg(kbDir, fetchedAt, cpgPdfPath));
  results.push(await syncLegality(kbDir, fetchedAt, legalityUrl));

  rebuildIndex(kbDir);
  return results;
}
