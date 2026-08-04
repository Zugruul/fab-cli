/**
 * Zone-map format for zone-aware game-state composites (#253): named
 * playmat zones with normalized rects (fractions of the playmat image's
 * own width/height), hand-authored per physical playmat and committed as
 * data — the playmat IMAGE itself is never committed (see cli.ts's doc
 * comment), only this geometry.
 *
 * Rects are measured directly from pixel coordinates in the reference
 * playmat image (pipeline/out/zone-reference-playmat.png, gitignored) via
 * gold-border edge detection, then verified against a rendered debug
 * overlay (debugOverlay.ts) — see the committed
 * config/zone-maps/combat-chain-playmat.json's own doc string for the
 * specific playmat this was authored against.
 */

export interface ZoneRectFrac {
  xFrac: number;
  yFrac: number;
  wFrac: number;
  hFrac: number;
}

/** Every semantic slot #253's brief mandates, plus "arsenal" — the one
 * documented exception that stays empty by default and only occasionally
 * gets a face-up card (see planZoneLayout.ts). "weapon" and "offHand" are
 * deliberately distinct kinds even though the reference playmat prints two
 * generically-labeled "WEAPON" boxes for both — see the zone map's own doc
 * string for that assignment decision. */
export const ZONE_KINDS = [
  "head",
  "chest",
  "arms",
  "legs",
  "weapon",
  "offHand",
  "hero",
  "pitch",
  "deck",
  "graveyard",
  "banished",
  "arsenal",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** Every kind except "arsenal" — the brief's bulleted list of always-
 * filled slots (arsenal is the one explicitly called out separately as an
 * "occasional variant", #253 decision). */
export const MANDATORY_ZONE_KINDS: ZoneKind[] = ZONE_KINDS.filter((k) => k !== "arsenal");

export interface ZoneDefinition {
  id: string;
  kind: ZoneKind;
  rect: ZoneRectFrac;
}

export interface ZoneMap {
  /** Human-readable description of the physical playmat this map was
   * authored against — never a file path (the source image is never
   * committed, so this map must stand alone as documentation). */
  name: string;
  zones: ZoneDefinition[];
}

export type ValidateZoneMapResult = { valid: true; map: ZoneMap } | { valid: false; errors: string[] };

/** Standard half-open-interval AABB intersection test — true iff the two
 * rects share any positive area. Two rects that only touch edge-to-edge
 * (a shared boundary, zero-width intersection) are NOT considered
 * overlapping — the hand-authored reference map relies on exactly this to
 * pack zones edge-to-edge with a real gap in between (never truly
 * touching, but this function's contract doesn't require a gap either). */
export function zoneRectsOverlap(a: ZoneRectFrac, b: ZoneRectFrac): boolean {
  return a.xFrac < b.xFrac + b.wFrac && b.xFrac < a.xFrac + a.wFrac && a.yFrac < b.yFrac + b.hFrac && b.yFrac < a.yFrac + a.hFrac;
}

function isRectFrac(v: unknown): v is ZoneRectFrac {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.xFrac === "number" && typeof r.yFrac === "number" && typeof r.wFrac === "number" && typeof r.hFrac === "number";
}

/**
 * Validates a parsed zone-map JSON object, collecting every violation
 * rather than stopping at the first (mirrors composites/config.ts's
 * validateGeneratorConfig style). Beyond per-zone structural checks, this
 * also enforces the non-mandated-invariant lesson from #252: a
 * hand-authored map is exactly the kind of file where a copy-paste mistake
 * (e.g. DECK's rect accidentally reusing GRAVEYARD's) would otherwise go
 * silently unnoticed until a composite visibly rendered cards stacked on
 * top of each other — so every zone pair is checked pairwise for overlap.
 */
export function validateZoneMap(raw: unknown): ValidateZoneMapResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["zone map is not a JSON object"] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.name !== "string" || r.name.length === 0) errors.push('"name" must be a non-empty string');

  if (!Array.isArray(r.zones) || r.zones.length === 0) {
    errors.push('"zones" must be a non-empty array');
    return { valid: false, errors };
  }

  const zones = r.zones as unknown[];
  const seenIds = new Set<string>();
  const validated: ZoneDefinition[] = [];

  zones.forEach((z, i) => {
    if (typeof z !== "object" || z === null) {
      errors.push(`zones[${i}] is not an object`);
      return;
    }
    const zone = z as Record<string, unknown>;
    const id = zone.id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push(`zones[${i}].id must be a non-empty string`);
    } else if (seenIds.has(id)) {
      errors.push(`duplicate zone id "${id}"`);
    } else {
      seenIds.add(id);
    }

    const kind = zone.kind;
    if (typeof kind !== "string" || !(ZONE_KINDS as readonly string[]).includes(kind)) {
      errors.push(`zones[${i}].kind must be one of ${ZONE_KINDS.join("|")} (got ${JSON.stringify(kind)})`);
    }

    if (!isRectFrac(zone.rect)) {
      errors.push(`zones[${i}].rect must be an object {xFrac, yFrac, wFrac, hFrac}`);
    } else {
      const rect = zone.rect;
      if (rect.xFrac < 0) errors.push(`zones[${i}].rect.xFrac must be >= 0`);
      if (rect.yFrac < 0) errors.push(`zones[${i}].rect.yFrac must be >= 0`);
      if (rect.wFrac <= 0) errors.push(`zones[${i}].rect.wFrac must be > 0`);
      if (rect.hFrac <= 0) errors.push(`zones[${i}].rect.hFrac must be > 0`);
      if (rect.xFrac + rect.wFrac > 1) errors.push(`zones[${i}].rect extends past the right canvas edge (xFrac + wFrac > 1)`);
      if (rect.yFrac + rect.hFrac > 1) errors.push(`zones[${i}].rect extends past the bottom canvas edge (yFrac + hFrac > 1)`);
      if (typeof id === "string" && typeof kind === "string") {
        validated.push({ id, kind: kind as ZoneKind, rect });
      }
    }
  });

  for (let i = 0; i < validated.length; i++) {
    for (let j = i + 1; j < validated.length; j++) {
      if (zoneRectsOverlap(validated[i].rect, validated[j].rect)) {
        errors.push(`zones "${validated[i].id}" and "${validated[j].id}" overlap`);
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, map: { name: r.name as string, zones: validated } };
}
