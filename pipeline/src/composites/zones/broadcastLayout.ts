/**
 * Tournament-broadcast chrome/play-area layout format (#256, Phase B) —
 * committed measured geometry, in the spirit of zoneMap.ts's committed
 * zone maps: the source capture IMAGES are never committed (see
 * importCaptures.ts's honest-constraint doc), only this geometry, measured
 * directly against imported real captures. See
 * config/broadcast-layouts/calling-edinburgh.json's own doc string for
 * which captures were measured and how.
 *
 * Reuses zoneMap.ts's `ZoneRectFrac` shape (xFrac/yFrac/wFrac/hFrac,
 * fractions of the FULL BROADCAST FRAME, not the play area) and its
 * `zoneRectsOverlap` AABB test verbatim — no reimplementation.
 */
import { zoneRectsOverlap } from "./zoneMap.js";
import type { ZoneRectFrac } from "./zoneMap.js";

export type { ZoneRectFrac };

/** Every chrome-region kind the rig brief names (#256 issue body): a top
 * scoreboard bar, left/right sidebars, a webcam pane nested in each
 * sidebar, a bottom-left info stack (city/stage/turn/clock), and a
 * bottom-right card-preview panel. `sidebar`/`webcam`/`info-stack`/
 * `card-preview` each carry a `side` (left/right) since the rig is
 * bilaterally symmetric; `scoreboard` has none (it spans the full width). */
export const CHROME_KINDS = ["scoreboard", "sidebar", "webcam", "info-stack", "card-preview"] as const;
export type ChromeKind = (typeof CHROME_KINDS)[number];

export const CHROME_SIDES = ["left", "right"] as const;
export type ChromeSide = (typeof CHROME_SIDES)[number];

export interface ChromeRegion {
  kind: ChromeKind;
  /** Present for every kind except "scoreboard" (which spans the full
   * frame width and has no left/right identity). */
  side?: ChromeSide;
  rect: ZoneRectFrac;
}

export interface BroadcastLayoutConfig {
  /** Human-readable description of the physical broadcast rig this map was
   * measured against — never a file path (source captures are never
   * committed, see importCaptures.ts), mirrors zoneMap.ts's ZoneMap.name
   * convention. */
  name: string;
  /** The play area (table surface) rect, as fractions of the FULL
   * broadcast frame — this is where the table-level homography (Phase C)
   * warps the composed two-player table into, and the region every other
   * chrome rect must never overlap. */
  playArea: ZoneRectFrac;
  chrome: ChromeRegion[];
}

export type ValidateBroadcastLayoutConfigResult = { valid: true; config: BroadcastLayoutConfig } | { valid: false; errors: string[] };

function isRectFrac(v: unknown): v is ZoneRectFrac {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.xFrac === "number" && typeof r.yFrac === "number" && typeof r.wFrac === "number" && typeof r.hFrac === "number";
}

function checkRectBounds(errors: string[], label: string, rect: ZoneRectFrac): void {
  if (rect.xFrac < 0) errors.push(`${label}.xFrac must be >= 0`);
  if (rect.yFrac < 0) errors.push(`${label}.yFrac must be >= 0`);
  if (rect.wFrac <= 0) errors.push(`${label}.wFrac must be > 0`);
  if (rect.hFrac <= 0) errors.push(`${label}.hFrac must be > 0`);
  if (rect.xFrac + rect.wFrac > 1) errors.push(`${label} extends past the right frame edge (xFrac + wFrac > 1)`);
  if (rect.yFrac + rect.hFrac > 1) errors.push(`${label} extends past the bottom frame edge (yFrac + hFrac > 1)`);
}

/**
 * Validates a parsed BroadcastLayoutConfig JSON object — mirrors
 * zoneMap.ts's validateZoneMap style (collect every violation, never stop
 * at the first). Beyond per-region structural checks, enforces exactly ONE
 * cross-region invariant: no chrome region may overlap the play area
 * (chrome painted over the table would occlude/mislabel real card
 * placements). Nesting WITHIN chrome (e.g. a webcam pane inside its own
 * sidebar) is intentional and deliberately NOT checked here — unlike
 * zoneMap.ts's exhaustive zone-vs-zone pairwise check, chrome regions are
 * a hierarchy (sidebar contains webcam/info-stack/card-preview), not a
 * disjoint tiling.
 */
export function validateBroadcastLayoutConfig(raw: unknown): ValidateBroadcastLayoutConfigResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["broadcast-layout config is not a JSON object"] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.name !== "string" || r.name.length === 0) errors.push('"name" must be a non-empty string');

  let playArea: ZoneRectFrac | null = null;
  if (!isRectFrac(r.playArea)) {
    errors.push('"playArea" must be an object {xFrac, yFrac, wFrac, hFrac}');
  } else {
    playArea = r.playArea;
    checkRectBounds(errors, "playArea", playArea);
  }

  const chrome: ChromeRegion[] = [];
  if (!Array.isArray(r.chrome) || r.chrome.length === 0) {
    errors.push('"chrome" must be a non-empty array');
  } else {
    r.chrome.forEach((entry, i) => {
      if (typeof entry !== "object" || entry === null) {
        errors.push(`chrome[${i}] is not an object`);
        return;
      }
      const region = entry as Record<string, unknown>;
      const kind = region.kind;
      if (typeof kind !== "string" || !(CHROME_KINDS as readonly string[]).includes(kind)) {
        errors.push(`chrome[${i}].kind must be one of ${CHROME_KINDS.join("|")} (got ${JSON.stringify(kind)})`);
        return;
      }
      if (region.side !== undefined && !(CHROME_SIDES as readonly string[]).includes(region.side as string)) {
        errors.push(`chrome[${i}].side must be one of ${CHROME_SIDES.join("|")} (got ${JSON.stringify(region.side)})`);
        return;
      }
      if (!isRectFrac(region.rect)) {
        errors.push(`chrome[${i}].rect must be an object {xFrac, yFrac, wFrac, hFrac}`);
        return;
      }
      checkRectBounds(errors, `chrome[${i}].rect`, region.rect);
      chrome.push({ kind: kind as ChromeKind, side: region.side as ChromeSide | undefined, rect: region.rect });
    });
  }

  if (playArea) {
    chrome.forEach((region, i) => {
      if (zoneRectsOverlap(playArea!, region.rect)) {
        errors.push(`chrome[${i}] (kind "${region.kind}"${region.side ? `, side "${region.side}"` : ""}) overlaps the play area`);
      }
    });
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, config: { name: r.name as string, playArea: playArea!, chrome } };
}
