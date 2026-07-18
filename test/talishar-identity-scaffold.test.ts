import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const BRAIN_DIR = join(ROOT, ".claude", "identities", "talishar", "brain");
const PROJECT_YAML = join(ROOT, ".claude", "project.yaml");

const INVARIANT_I1 =
  "Never open, mark ready, approve, or merge pull requests on Talishar org repositories; tooling pushes branches only to the user's forks and prepares PR title/body as text — a human creates every upstream PR.";
const INVARIANT_I2 =
  "In every vendored Talishar clone, `origin` must be the user's fork and `upstream` the Talishar org repo, fetch-only; nothing is ever pushed to `upstream`, and a diverged fork main is reported, never force-pushed.";
const INVARIANT_I5 =
  "The talishar brain links to card-vault entities for card/keyword facts and is never added to the keyword-sync MIRRORS list; engine knowledge lives in the talishar brain only.";

describe("talishar identity brain scaffold", () => {
  it("has an empty notes/ directory", () => {
    const notesDir = join(BRAIN_DIR, "notes");
    expect(existsSync(notesDir)).toBe(true);
    expect(statSync(notesDir).isDirectory()).toBe(true);
  });

  it("has ROLE.md containing invariants I1, I2, I5 verbatim", () => {
    const rolePath = join(BRAIN_DIR, "ROLE.md");
    expect(existsSync(rolePath)).toBe(true);
    const role = readFileSync(rolePath, "utf-8");
    expect(role).toContain(INVARIANT_I1);
    expect(role).toContain(INVARIANT_I2);
    expect(role).toContain(INVARIANT_I5);
  });

  it("has an empty links.json link graph", () => {
    const linksPath = join(BRAIN_DIR, "links.json");
    expect(existsSync(linksPath)).toBe(true);
    const links = JSON.parse(readFileSync(linksPath, "utf-8"));
    expect(links).toEqual({});
  });

  it("has an empty .activation.jsonl recall log", () => {
    const activationPath = join(BRAIN_DIR, ".activation.jsonl");
    expect(existsSync(activationPath)).toBe(true);
    expect(readFileSync(activationPath, "utf-8")).toBe("");
  });
});

describe("project.yaml talishar delegation identity", () => {
  const yaml = readFileSync(PROJECT_YAML, "utf-8");
  // Isolate the `talishar:` block under `delegation: identities:` — bounded
  // by the next same-or-lesser-indented `identities:` child key or EOF.
  const talisharBlockMatch = yaml.match(
    /^ {8}talishar:\n((?: {12}.*\n|\n)+)/m,
  );

  it("has a talishar entry under delegation.identities", () => {
    expect(talisharBlockMatch).not.toBeNull();
  });

  const block = talisharBlockMatch ? talisharBlockMatch[1] : "";

  it("sets name and email using the player/judge template shape", () => {
    expect(block).toMatch(/name:\s*['"]?Talishar Agent - \{name\}['"]?/);
    expect(block).toMatch(
      /email:\s*['"]?\{local\}\+talishar_agent@\{domain\}['"]?/,
    );
  });

  it("does NOT declare a models key (advisory-only identity)", () => {
    expect(block).not.toMatch(/^\s*models:/m);
  });
});
