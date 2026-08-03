import { describe, it, expect } from "vitest";
import { validatePhotoLabel } from "../src/benchmark/validate.js";
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
