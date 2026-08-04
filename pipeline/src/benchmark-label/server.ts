/**
 * Local-only HTTP server for the benchmark quad-labeling tool (issue #258).
 * No external network calls of any kind — every route reads/writes local
 * disk only (photos dir, labels dir, the vendored card.json, the local
 * printing-image cache under pipeline/out/images/). Serves the static
 * browser client (client/index.html + app.js + styles.css, plain JS — this
 * package has no browser/DOM build step, so the client ships untyped, per
 * this task's design notes) plus a small JSON API the client calls.
 *
 * All request-handling LOGIC lives in routes.ts/catalogSearch.ts/
 * filenameConvention.ts as pure, independently-tested functions — this
 * file is thin HTTP plumbing (parse the request, call the pure function,
 * serialize the response) so the one thing under test here is the wiring
 * itself (see test/benchmarkLabel.server.test.ts's end-to-end HTTP test).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ORIENTATIONS, QUAD_TAGS, SCENE_TYPES } from "../benchmark/types.js";
import { loadCardsFromFile } from "../images/catalog.js";
import { cachePathFor } from "../images/cache.js";
import { extractCatalogPrintings, resolveCandidates } from "./catalogSearch.js";
import type { CatalogPrinting } from "./catalogSearch.js";
import { parseLabelFilename } from "./filenameConvention.js";
import { getLabel, listPhotos, putLabel } from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, "client");

export interface ServerConfig {
  photosDir: string;
  labelsDir: string;
  cardJsonPath: string;
  imagesCacheDir: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentTypeFor(filePath), "Content-Length": data.length });
  res.end(data);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? undefined : JSON.parse(raw);
}

/** Loads + extracts the catalog once per server start (the vendored
 * card.json is ~5k cards / read once, not per-request) — a fresh server
 * process picks up any card.json update on restart, same staleness
 * contract as every other pipeline CLI that reads this file. */
function loadCatalog(cardJsonPath: string): CatalogPrinting[] {
  const cards = loadCardsFromFile(cardJsonPath);
  return extractCatalogPrintings(cards);
}

export function createRequestListener(config: ServerConfig): http.RequestListener {
  const catalog = loadCatalog(config.cardJsonPath);

  return (req, res) => {
    void handleRequest(req, res, config, catalog).catch((err) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ServerConfig,
  catalog: CatalogPrinting[],
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const pathname = url.pathname;

  // --- static client assets ---
  if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return sendFile(res, path.join(CLIENT_DIR, "index.html"));
  }
  if (method === "GET" && (pathname === "/app.js" || pathname === "/styles.css")) {
    return sendFile(res, path.join(CLIENT_DIR, pathname.slice(1)));
  }

  // --- API ---
  if (method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, { sceneTypes: SCENE_TYPES, orientations: ORIENTATIONS, tags: QUAD_TAGS });
  }

  if (method === "GET" && pathname === "/api/photos") {
    return sendJson(res, 200, { photos: listPhotos(config.photosDir, config.labelsDir) });
  }

  if (method === "GET" && pathname === "/api/photo") {
    const file = url.searchParams.get("file");
    if (!file) return sendJson(res, 400, { error: "missing ?file=" });
    return sendFile(res, path.join(config.photosDir, file));
  }

  if (method === "GET" && pathname === "/api/label") {
    const file = url.searchParams.get("file");
    if (!file) return sendJson(res, 400, { error: "missing ?file=" });
    return sendJson(res, 200, { label: getLabel(config.labelsDir, file) });
  }

  if (method === "PUT" && pathname === "/api/label") {
    const file = url.searchParams.get("file");
    if (!file) return sendJson(res, 400, { error: "missing ?file=" });
    const body = await readJsonBody(req);
    const result = putLabel(config.labelsDir, file, body);
    return sendJson(res, result.ok ? 200 : 422, result);
  }

  if (method === "GET" && pathname === "/api/parse-filename") {
    const file = url.searchParams.get("file");
    if (!file) return sendJson(res, 400, { error: "missing ?file=" });
    return sendJson(res, 200, parseLabelFilename(file));
  }

  if (method === "GET" && pathname === "/api/catalog/search") {
    const printCode = url.searchParams.get("code");
    const edition = url.searchParams.get("edition") as "U" | "1st" | null;
    const nameQuery = url.searchParams.get("name");
    const result = resolveCandidates(catalog, { printCode, edition, nameQuery });
    const withImage = (c: CatalogPrinting) => ({ ...c, imageCached: isCached(config.imagesCacheDir, c) });
    const withImageState =
      result.status === "unique"
        ? { status: result.status, printing: withImage(result.printing) }
        : { status: result.status, candidates: result.candidates.map(withImage) };
    return sendJson(res, 200, withImageState);
  }

  if (method === "GET" && pathname === "/api/printing-image") {
    const printingId = url.searchParams.get("id");
    if (!printingId) return sendJson(res, 400, { error: "missing ?id=" });
    const printing = catalog.find((c) => c.printingId === printingId);
    if (!printing) return sendJson(res, 404, { error: "unknown printingId" });
    const cachePath = cachePathFor(config.imagesCacheDir, printing);
    return sendFile(res, cachePath);
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

function isCached(imagesCacheDir: string, printing: CatalogPrinting): boolean {
  return fs.existsSync(cachePathFor(imagesCacheDir, printing));
}

export function startServer(config: ServerConfig, port: number): http.Server {
  const server = http.createServer(createRequestListener(config));
  server.listen(port);
  return server;
}
