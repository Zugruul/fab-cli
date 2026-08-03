/**
 * The committed major-version human-audit template (SPEC-APP.md §8.5's
 * second clause — APP-023, #135). This test only checks the template's
 * structural contract: the sections a real audit record must carry, and
 * that its sign-off placeholder is NOT itself a completed verdict
 * (extractAuditVerdict must return null for the template as committed —
 * otherwise copying the template unfilled would silently pass the gate).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { extractAuditVerdict } from "../src/eval/release.js";

const TEMPLATE_PATH = path.join(import.meta.dirname, "..", "release-audits", "TEMPLATE.md");

describe("release-audits/TEMPLATE.md", () => {
  it("exists and is committed content, not generated", () => {
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
  });

  it("documents sample selection guidance for the major-version audit", () => {
    const content = fs.readFileSync(TEMPLATE_PATH, "utf8");
    expect(content).toMatch(/sample selection/i);
  });

  it("carries the per-item audit fields: question, model answer, verdict, notes", () => {
    const content = fs.readFileSync(TEMPLATE_PATH, "utf8");
    expect(content).toMatch(/question/i);
    expect(content).toMatch(/model answer/i);
    expect(content).toMatch(/verdict/i);
    expect(content).toMatch(/notes/i);
  });

  it("carries a Sign-off section with Auditor/Date/Verdict fields", () => {
    const content = fs.readFileSync(TEMPLATE_PATH, "utf8");
    expect(content).toMatch(/sign-off/i);
    expect(content).toMatch(/Auditor:/);
    expect(content).toMatch(/Date:/);
    expect(content).toMatch(/Verdict:/);
  });

  it("the template's own sign-off placeholder is not itself a completed verdict", () => {
    const content = fs.readFileSync(TEMPLATE_PATH, "utf8");
    expect(extractAuditVerdict(content)).toBeNull();
  });
});
