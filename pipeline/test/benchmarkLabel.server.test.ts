import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startServer } from "../src/benchmark-label/server.js";
import type { ServerConfig } from "../src/benchmark-label/server.js";

let tmpDir: string;
let config: ServerConfig;
let server: ReturnType<typeof startServer>;
let baseUrl: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-benchmark-label-server-test-"));
  const photosDir = path.join(tmpDir, "photos");
  const labelsDir = path.join(photosDir, "labels");
  fs.mkdirSync(path.join(photosDir, "single"), { recursive: true });
  fs.writeFileSync(path.join(photosDir, "single", "photo-001.jpg"), "fake-jpg-bytes");

  const cardJsonPath = path.join(tmpDir, "card.json");
  fs.writeFileSync(
    cardJsonPath,
    JSON.stringify([
      {
        name: "Groundbreaker Crix",
        printings: [
          {
            unique_id: "NfgpFKBWBtrdbLGMmQQbh",
            id: "HER155",
            set_id: "HER",
            edition: "N",
            foiling: "C",
            rarity: "P",
            art_variations: ["FA"],
            image_url: "https://example.com/HER155-MV.webp",
          },
          {
            unique_id: "GFPgDWrmnhCdBtTWhfzMK",
            id: "HER155",
            set_id: "HER",
            edition: "N",
            foiling: "C",
            rarity: "P",
            art_variations: ["FA"],
            image_url: "https://example.com/HER155-MV_BACK.webp",
          },
        ],
      },
    ]),
  );

  config = { photosDir, labelsDir, cardJsonPath, imagesCacheDir: path.join(tmpDir, "images") };
  server = startServer(config, 0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("benchmark-label server — end to end over real HTTP", () => {
  it("serves the static client index at /", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Benchmark labeling");
  });

  it("GET /api/config returns the protocol's scene types / orientations / tags", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    const body = (await res.json()) as any;
    expect(body.sceneTypes).toEqual(["single", "field", "binder"]);
    expect(body.tags).toEqual(["sleeved", "foil", "glare"]);
  });

  it("GET /api/photos lists the unlabeled photo", async () => {
    const res = await fetch(`${baseUrl}/api/photos`);
    const body = (await res.json()) as any;
    expect(body.photos).toEqual([{ fileName: "single/photo-001.jpg", sceneTypeGuess: "single", labeled: false, quadCount: 0 }]);
  });

  it("PUT then GET /api/label round-trips amodal (out-of-bounds) corners byte-for-byte over real HTTP", async () => {
    const label = {
      photoId: "photo-001",
      fileName: "single/photo-001.jpg",
      sceneType: "single",
      orientation: "portrait",
      quads: [
        {
          printingId: "NfgpFKBWBtrdbLGMmQQbh",
          corners: [
            { x: -200, y: -50 },
            { x: 300, y: -50 },
            { x: 300, y: 5000 },
            { x: -200, y: 5000 },
          ],
          tags: ["glare"],
        },
      ],
    };
    const putRes = await fetch(`${baseUrl}/api/label?file=${encodeURIComponent("single/photo-001.jpg")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(label),
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ ok: true });

    const getRes = await fetch(`${baseUrl}/api/label?file=${encodeURIComponent("single/photo-001.jpg")}`);
    const body = (await getRes.json()) as any;
    expect(body.label.quads[0].corners).toEqual(label.quads[0].corners);
  });

  it("PUT with an invalid label is rejected (422) and writes nothing", async () => {
    const res = await fetch(`${baseUrl}/api/label?file=${encodeURIComponent("single/photo-001.jpg")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId: "x" }), // missing everything else
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(config.labelsDir, "single", "photo-001.json"))).toBe(false);
  });

  it("GET /api/catalog/search?code=HER155 surfaces the real verified ambiguous case — never auto-picks", async () => {
    const res = await fetch(`${baseUrl}/api/catalog/search?code=HER155`);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ambiguous");
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates.map((c: { printingId: string }) => c.printingId).sort()).toEqual(
      ["GFPgDWrmnhCdBtTWhfzMK", "NfgpFKBWBtrdbLGMmQQbh"].sort(),
    );
    // Neither candidate's image is downloaded in this test's tmp cache dir —
    // the picker must degrade to text-only, not fabricate a thumbnail.
    expect(body.candidates.every((c: { imageCached: boolean }) => c.imageCached === false)).toBe(true);
  });

  it("GET /api/parse-filename surfaces the real filename convention", async () => {
    const res = await fetch(`${baseUrl}/api/parse-filename?file=${encodeURIComponent("HER155-sleeved-groundbreaker-crix-marvel-cf.jpeg")}`);
    const body = (await res.json()) as any;
    expect(body.parsed).toBe(true);
    expect(body.marvel).toBe(true);
    expect(body.printCode).toBe("HER155");
  });
});

// PR #262 review (BLOCKER 1): unauthenticated path traversal — reproduces
// the reviewer's EXACT real-HTTP repro strings against the actual running
// server, both directions (read via GET /api/photo, write via PUT
// /api/label), plus confirms the server binds loopback-only rather than
// all interfaces.
describe("benchmark-label server — path traversal is rejected (issue #258 security fix)", () => {
  it("GET /api/photo?file=..%2Foutside-secret.json does NOT return a file planted outside photosDir", async () => {
    const secretPath = path.join(tmpDir, "outside-secret.json");
    fs.writeFileSync(secretPath, "TOP SECRET CONTENT");

    const res = await fetch(`${baseUrl}/api/photo?file=..%2Foutside-secret.json`);
    expect(res.status).not.toBe(200);
    const body = await res.text();
    expect(body).not.toContain("TOP SECRET");
  });

  it("PUT /api/label?file=../../../../tmp/258-review-escaped-write.json does NOT write outside labelsDir", async () => {
    // Mirrors the reviewer's exact 4-level escape, rooted at this test's own
    // tmpDir instead of the real /tmp (so the assertion doesn't depend on
    // anything pre-existing on the host, but the escape depth and shape are
    // identical to the real repro).
    const escapeTarget = path.join(tmpDir, "258-review-escaped-write.json");
    const relEscape = "../../../../" + escapeTarget.replace(/^\//, "") + ".json";

    const res = await fetch(`${baseUrl}/api/label?file=${encodeURIComponent(relEscape)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photoId: "p",
        fileName: "p.jpg",
        sceneType: "single",
        orientation: "portrait",
        quads: [{ printingId: "pr1", corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], tags: [] }],
      }),
    });
    expect(res.status).not.toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).not.toBe(true);
    expect(fs.existsSync(escapeTarget + ".json")).toBe(false);
  });

  it("GET /api/label?file=../outside-secret.json does NOT read a file planted outside labelsDir", async () => {
    const secretPath = path.join(tmpDir, "outside-secret.json");
    fs.writeFileSync(secretPath, JSON.stringify({ photoId: "leaked" }));

    const res = await fetch(`${baseUrl}/api/label?file=${encodeURIComponent("../outside-secret.json")}`);
    expect(res.status).not.toBe(200);
  });

  it("binds loopback-only (127.0.0.1), not all interfaces", () => {
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe("127.0.0.1");
  });
});
