import { describe, it, expect } from "vitest";
import { validatePhotoLabel, validateLabelFrame, validateLabelBounds } from "../src/benchmark/validate.js";
import type { PhotoLabel } from "../src/benchmark/types.js";

function validLabel(): PhotoLabel {
  return {
    photoId: "photo-001",
    fileName: "field/photo-001.jpg",
    sceneType: "field",
    orientation: "landscape",
    quads: [
      {
        printingId: "q9B6nmKrdz8HnQnJMpQdc",
        corners: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 150 },
          { x: 0, y: 150 },
        ],
        tags: ["sleeved"],
      },
    ],
  };
}

describe("validatePhotoLabel — accepts well-formed labels", () => {
  it("accepts a valid single-quad label", () => {
    const result = validatePhotoLabel(validLabel());
    expect(result.valid).toBe(true);
  });

  it("accepts every declared scene type", () => {
    for (const sceneType of ["single", "field", "binder"] as const) {
      const result = validatePhotoLabel({ ...validLabel(), sceneType });
      expect(result.valid, `sceneType=${sceneType}`).toBe(true);
    }
  });

  it("accepts both orientations", () => {
    for (const orientation of ["portrait", "landscape"] as const) {
      const result = validatePhotoLabel({ ...validLabel(), orientation });
      expect(result.valid, `orientation=${orientation}`).toBe(true);
    }
  });

  it("accepts a quad with multiple tags, or none", () => {
    const multi = validatePhotoLabel({
      ...validLabel(),
      quads: [{ ...validLabel().quads[0], tags: ["sleeved", "foil", "glare"] }],
    });
    expect(multi.valid).toBe(true);
    const none = validatePhotoLabel({ ...validLabel(), quads: [{ ...validLabel().quads[0], tags: [] }] });
    expect(none.valid).toBe(true);
  });

  it("accepts multiple quads on one photo (field/binder scenes)", () => {
    const label = validLabel();
    const result = validatePhotoLabel({ ...label, quads: [label.quads[0], label.quads[0]] });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.label.quads).toHaveLength(2);
  });

  // Issue #274: the tag vocabulary was extended beyond sleeved|foil|glare to
  // express treatment/rarity, grounded in the-fab-cube's own foiling/rarity/
  // art_variations fields (see benchmark/types.ts's QUAD_TAGS doc comment
  // for the exact mapping + why each one was chosen).
  it("accepts every tag in the extended treatment/rarity vocabulary (issue #274)", () => {
    const label = validLabel();
    const extendedTags = [
      "cold-foil",
      "rainbow-foil",
      "gold-foil",
      "marvel",
      "promo",
      "alternate-art",
      "alternate-border",
      "extended-art",
      "full-art",
      "alternate-text",
    ];
    for (const tag of extendedTags) {
      const result = validatePhotoLabel({ ...label, quads: [{ ...label.quads[0], tags: [tag] }] });
      expect(result.valid, `tag=${tag}`).toBe(true);
    }
  });

  it("still accepts the original sleeved|foil|glare tags unchanged (backward compatibility, issue #274)", () => {
    const label = validLabel();
    const result = validatePhotoLabel({ ...label, quads: [{ ...label.quads[0], tags: ["sleeved", "foil", "glare"] }] });
    expect(result.valid).toBe(true);
  });

  it("accepts a quad combining a foiling refinement with the generic foil tag (additive, not a replacement)", () => {
    const label = validLabel();
    const result = validatePhotoLabel({ ...label, quads: [{ ...label.quads[0], tags: ["foil", "cold-foil"] }] });
    expect(result.valid).toBe(true);
  });
});

describe("validatePhotoLabel — rejects malformed labels with specific errors", () => {
  it("rejects a non-object input", () => {
    expect(validatePhotoLabel(null).valid).toBe(false);
    expect(validatePhotoLabel("nope").valid).toBe(false);
    expect(validatePhotoLabel(42).valid).toBe(false);
  });

  it("rejects a quad with fewer than 4 corners", () => {
    const label = validLabel();
    label.quads[0].corners = label.quads[0].corners.slice(0, 3) as unknown as PhotoLabel["quads"][0]["corners"];
    const result = validatePhotoLabel(label);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /corners/.test(e))).toBe(true);
  });

  it("rejects a quad with a non-numeric corner", () => {
    const label = validLabel();
    (label.quads[0].corners[0] as unknown as { x: unknown }).x = "zero";
    const result = validatePhotoLabel(label);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /corners\[0\]/.test(e))).toBe(true);
  });

  it("rejects a label missing printingId on a quad", () => {
    const label = validLabel();
    delete (label.quads[0] as Partial<PhotoLabel["quads"][0]>).printingId;
    const result = validatePhotoLabel(label);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /printingId/.test(e))).toBe(true);
  });

  it("rejects an unknown sceneType", () => {
    const result = validatePhotoLabel({ ...validLabel(), sceneType: "tabletop" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /sceneType/.test(e))).toBe(true);
  });

  it("rejects an unknown orientation", () => {
    const result = validatePhotoLabel({ ...validLabel(), orientation: "diagonal" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /orientation/.test(e))).toBe(true);
  });

  it("rejects an unknown quad tag", () => {
    const label = validLabel();
    label.quads[0].tags = ["blurry"] as unknown as PhotoLabel["quads"][0]["tags"];
    const result = validatePhotoLabel(label);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /tags\[0\]/.test(e))).toBe(true);
  });

  it("rejects a label with zero quads", () => {
    const result = validatePhotoLabel({ ...validLabel(), quads: [] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /quads/.test(e))).toBe(true);
  });

  it("rejects a missing photoId / fileName", () => {
    const label = validLabel() as Partial<PhotoLabel>;
    delete label.photoId;
    delete label.fileName;
    const result = validatePhotoLabel(label);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /photoId/.test(e))).toBe(true);
      expect(result.errors.some((e) => /fileName/.test(e))).toBe(true);
    }
  });

  it("reports multiple errors at once rather than stopping at the first", () => {
    const result = validatePhotoLabel({ quads: [] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(1);
  });
});

// #286 follow-up: the exporter's frame bug (decodeImageToRaw ignoring EXIF
// orientation) went undetected across all 16 real benchmark labels because
// nothing ever cross-checked a label's declared `orientation` against the
// photo it actually describes. validateLabelFrame is that guard — wired
// into both benchmark/manifest.ts's build path (npm run benchmark:manifest)
// and train-vision/realPhotoEvalSet.ts's export path, per docs/benchmark-
// labeling.md's canonical-frame decision (displayed/EXIF-applied wins).
//
// Deliberately NOT a per-corner bounds check: docs/benchmark-labeling.md's
// amodal convention explicitly permits corners far outside the photo's own
// pixel bounds for cropped/occluded cards (validatePhotoLabel above
// deliberately never bound-checks corners either) — a bounds-margin check
// would either reject legitimate severely-cropped labels or, loosened
// enough to tolerate them, fail on real #286 data: one of the 16 real
// mislabeled photos (HER155-unsleeved-groundbreaker-crix-marvel-cf) has a
// bounding box that fits BOTH the raw and the EXIF-applied frame with zero
// overrun in either — no bounds margin, however tight, can distinguish
// that case. Only the frame's aspect ratio vs. the declared `orientation`
// field can, and it catches all 16 with no margin to tune.
describe("validateLabelFrame", () => {
  function label(overrides: Partial<PhotoLabel> = {}): PhotoLabel {
    return {
      photoId: "p1",
      fileName: "single/p1.jpg",
      sceneType: "single",
      orientation: "portrait",
      quads: [
        {
          printingId: "pr1",
          corners: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          tags: [],
        },
      ],
      ...overrides,
    };
  }

  it("accepts a portrait-declared label against a taller-than-wide decoded frame", () => {
    expect(validateLabelFrame(label({ orientation: "portrait" }), 4284, 5712)).toEqual([]);
  });

  it("accepts a landscape-declared label against a wider-than-tall decoded frame", () => {
    expect(validateLabelFrame(label({ orientation: "landscape" }), 5712, 4284)).toEqual([]);
  });

  it("rejects a portrait-declared label against a wider-than-tall (landscape) decoded frame — the exact #286 defect shape", () => {
    // This is literally IMG_7629 from the issue: every real label declared
    // "portrait" (the frame it was drawn against); the pre-fix decoder
    // produced the raw 5712x4284 landscape buffer.
    const errors = validateLabelFrame(label({ orientation: "portrait" }), 5712, 4284);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/orientation/);
    expect(errors[0]).toMatch(/5712x4284/);
  });

  it("rejects a landscape-declared label against a taller-than-wide (portrait) decoded frame", () => {
    const errors = validateLabelFrame(label({ orientation: "landscape" }), 4284, 5712);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/orientation/);
  });

  it("never flags a square decoded frame either way — no orientation preference is possible", () => {
    expect(validateLabelFrame(label({ orientation: "portrait" }), 500, 500)).toEqual([]);
    expect(validateLabelFrame(label({ orientation: "landscape" }), 500, 500)).toEqual([]);
  });

  it("does not reject a corner far outside the frame's pixel bounds — amodal cropping stays legal", () => {
    // Same convention validatePhotoLabel already honors: a card whose true
    // extent is estimated to extend past the photo's own edge is expected,
    // not an error (docs/benchmark-labeling.md's amodal section).
    const cropped = label({
      orientation: "portrait",
      quads: [{ printingId: "pr1", corners: [{ x: -900, y: -900 }, { x: 100, y: -900 }, { x: 100, y: 100 }, { x: -900, y: 100 }], tags: [] }],
    });
    expect(validateLabelFrame(cropped, 500, 700)).toEqual([]);
  });
});

// #286 review round 2: a SEPARATE corruption backstop, deliberately not
// folded into validateLabelFrame above (which must stay corner-blind — see
// its own test right above this comment). This exists purely to catch
// wildly-wrong data (a label matched to the wrong photo, a unit mixup, a
// garbled coordinate) — NOT to re-catch #286's historical overrun range
// (4%-21% across the 16 real mislabeled photos), which is validateLabelFrame's
// job. It must be sized to never reject legitimate amodal cropping, which
// this codebase tests as functionally UNBOUNDED in three separate places:
//   - trainVision.realPhotoEvalSet.test.ts's "off-photo corner" test: a
//     corner at (-100,-100) on a 300x400 frame (33.3%/25% overrun), run
//     through the exact exportRealPhotoEvalSet pipeline this backstop sits
//     in — the binding constraint on the margin below.
//   - benchmarkLabel.routes.test.ts / .server.test.ts: corners hundreds of
//     px past frame edges, asserted byte-for-byte "never clamped", called
//     a merge blocker if violated (those go through validatePhotoLabel
//     only, not this function, but they document the same design intent).
//   - realPhotoEvalSet.ts's own header: "corners are scaled+offset only,
//     NEVER clamped into [0, canvasSize]."
// A 50% margin clears the 33.3% binding case with real headroom (1.5x)
// while still rejecting genuinely nonsensical data.
describe("validateLabelBounds", () => {
  function label(overrides: Partial<PhotoLabel> = {}): PhotoLabel {
    return {
      photoId: "p1",
      fileName: "single/p1.jpg",
      sceneType: "single",
      orientation: "portrait",
      quads: [{ printingId: "pr1", corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], tags: [] }],
      ...overrides,
    };
  }

  it("accepts corners fully within the frame", () => {
    expect(validateLabelBounds(label(), 500, 700)).toEqual([]);
  });

  it("accepts the real amodal example from the current label set (printing LFK7TmwkKLMQPLHfkLdmM, corner x=-24.9 on a 3024-wide frame)", () => {
    const cropped = label({
      quads: [{ printingId: "LFK7TmwkKLMQPLHfkLdmM", corners: [{ x: -24.9, y: 947.3 }, { x: 1935.1, y: 947.3 }, { x: 1935.1, y: 2515.3 }, { x: -24.9, y: 2515.3 }], tags: [] }],
    });
    expect(validateLabelBounds(cropped, 3024, 4032)).toEqual([]);
  });

  it("accepts the EXACT off-photo-corner test case from trainVision.realPhotoEvalSet.test.ts unchanged — the binding constraint on this margin", () => {
    // (-100,-100)-(100,100) on a 300x400 frame: 33.3%/25% overrun. If this
    // ever fails, the margin below was tightened past what that other,
    // deliberate test requires — fix the margin, not this test.
    const cropped = label({
      quads: [{ printingId: "pr1", corners: [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }], tags: [] }],
    });
    expect(validateLabelBounds(cropped, 300, 400)).toEqual([]);
  });

  it("rejects a corner wildly outside the frame — the corruption case this backstop exists for", () => {
    // A corner at ~7x the frame's width/height — no plausible amodal crop
    // looks like this; this is "wrong photo matched to this label" or
    // garbled coordinate data territory.
    const corrupted = label({
      quads: [{ printingId: "pr1", corners: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], tags: [] }],
    });
    const errors = validateLabelBounds(corrupted, 300, 300);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/corners\[/);
  });

  it("reports one error per offending corner, across multiple quads, rather than stopping at the first", () => {
    const corrupted = label({
      quads: [
        { printingId: "a", corners: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 10 }, { x: 0, y: 10 }], tags: [] },
        { printingId: "b", corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 9000 }, { x: 0, y: 9000 }], tags: [] },
      ],
    });
    const errors = validateLabelBounds(corrupted, 300, 300);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
