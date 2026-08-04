import { describe, it, expect, vi } from "vitest";
import { ensureCardBackCached, CARD_BACK_URL, CARD_BACK_PRINTING_ID } from "../src/composites/zones/cardBack.js";
import type { DownloadDeps, FetchLikeResponse } from "../src/images/downloader.js";

// #253 (c): the official card back is fetched + cached like a card image —
// reusing images/downloader.ts's retry/backoff/atomic-write machinery
// wholesale rather than reinventing it, keyed on a synthetic printingId
// since a card back has no printing unique_id of its own.

function baseDeps(overrides: Partial<DownloadDeps> = {}): DownloadDeps {
  return {
    fetchFn: vi.fn(async (): Promise<FetchLikeResponse> => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) })),
    fileExists: vi.fn(() => false),
    writeFile: vi.fn(),
    rename: vi.fn(),
    ensureDir: vi.fn(),
    sleep: vi.fn(async () => {}),
    now: () => 0,
    ...overrides,
  };
}

describe("card back constants", () => {
  it("uses the exact official URL and a sentinel printingId distinct from any real printing unique_id", () => {
    expect(CARD_BACK_URL).toBe("https://cdn.fabtcg.com/uploads/2025/06/cardback_3mm_63x88.png");
    expect(CARD_BACK_PRINTING_ID).toMatch(/card.?back/i);
  });
});

describe("ensureCardBackCached", () => {
  it("short-circuits on a cache hit — never calls fetchFn", async () => {
    const deps = baseDeps({ fileExists: vi.fn(() => true) });
    const path = await ensureCardBackCached("/cache", deps);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(path).toContain("/cache");
    expect(path).toMatch(/\.png$/);
  });

  it("fetches and caches on a miss, returning the same deterministic cache path", async () => {
    const deps = baseDeps();
    const path = await ensureCardBackCached("/cache", deps);
    expect(deps.fetchFn).toHaveBeenCalledWith(CARD_BACK_URL);
    expect(deps.writeFile).toHaveBeenCalled();
    expect(deps.rename).toHaveBeenCalled();
    expect(path).toMatch(/\.png$/);
  });

  it("fails LOUDLY (throws, never returns a fabricated path) when the fetch permanently fails, citing the failure reason", async () => {
    const deps = baseDeps({
      fetchFn: vi.fn(async (): Promise<FetchLikeResponse> => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })),
    });
    await expect(ensureCardBackCached("/cache", deps)).rejects.toThrow(/404|card back/i);
  });
});
