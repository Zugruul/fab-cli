import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REAL_SCRIPT = join(process.cwd(), "scripts", "talishar-fork-sync.sh");

// NOTE: this shim intentionally simplifies real git — no object database,
// only the exact subcommands talishar-fork-sync.sh issues. Ahead/behind
// counts, current-branch, branch lists, and merge/rebase/push outcomes are
// all driven by state files seeded per-repo-dir by the test, rather than
// simulating actual git history — that's the piece correctness depends on,
// everything else (fetch, rebase --abort, etc.) is a log-only no-op.
const FAKE_GIT = `#!/usr/bin/env bash
echo "git $*" >> "$FAKE_LOG"
if [ "$1" != "-C" ]; then
  exit 0
fi
dir="$2"; cmd="$3"; shift 3
case "$cmd" in
  fetch)
    exit 0
    ;;
  rev-list)
    # $1=--left-right $2=--count $3=SPEC ; state file keyed by sanitized SPEC
    spec="$3"
    key=$(printf '%s' "$spec" | tr './' '__')
    if [ -f "$dir/.fake-revlist-$key" ]; then
      cat "$dir/.fake-revlist-$key"
    else
      printf '0\\t0\\n'
    fi
    exit 0
    ;;
  rev-parse)
    if [ -f "$dir/.fake-head" ]; then
      cat "$dir/.fake-head"
    else
      echo "main"
    fi
    exit 0
    ;;
  branch)
    if [ -f "$dir/.fake-branches" ]; then
      cat "$dir/.fake-branches"
    else
      echo "main"
    fi
    exit 0
    ;;
  merge)
    if grep -q '^merge=fail$' "$dir/.fake-state" 2>/dev/null; then
      exit 1
    fi
    exit 0
    ;;
  push)
    if grep -q '^push=fail$' "$dir/.fake-state" 2>/dev/null; then
      exit 1
    fi
    exit 0
    ;;
  rebase)
    if [ "$1" = "--abort" ]; then
      if grep -q '^abort=fail$' "$dir/.fake-state" 2>/dev/null; then
        exit 1
      fi
      exit 0
    fi
    branch="$2"
    if grep -q "^rebase-\${branch}=fail$" "$dir/.fake-state" 2>/dev/null; then
      exit 1
    fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`;

interface Sandbox {
  root: string;
  scriptPath: string;
  thirdParty: string;
  bin: string;
  log: string;
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "talishar-fork-sync-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "third_party"));
  const bin = join(root, "bin");
  mkdirSync(bin);

  const scriptPath = join(root, "scripts", "talishar-fork-sync.sh");
  symlinkSync(REAL_SCRIPT, scriptPath);

  writeFileSync(join(bin, "git"), FAKE_GIT);
  chmodSync(join(bin, "git"), 0o755);

  const log = join(root, "fake.log");
  writeFileSync(log, "");

  return { root, scriptPath, thirdParty: join(root, "third_party"), bin, log };
}

function run(sb: Sandbox, args: string[] = []) {
  try {
    const stdout = execFileSync("bash", [sb.scriptPath, ...args], {
      cwd: sb.root,
      env: {
        PATH: `${sb.bin}:${process.env.PATH}`,
        HOME: sb.root,
        FAKE_LOG: sb.log,
      },
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

function revlistKey(spec: string): string {
  return spec.replace(/[./]/g, "_");
}

function seedRepo(
  sb: Sandbox,
  localName: string,
  opts: {
    mainCounts?: [ahead: number, behind: number]; // main...upstream/main
    head?: string; // rev-parse --abbrev-ref HEAD
    branches?: string[]; // branch --format output, main omitted is fine
    branchCounts?: Record<string, [ahead: number, behind: number]>; // "<branch>...main"
    state?: string[]; // lines like "merge=fail", "push=fail", "rebase-foo=fail"
  } = {},
) {
  const dir = join(sb.thirdParty, localName);
  mkdirSync(join(dir, ".git"), { recursive: true });

  const [ahead, behind] = opts.mainCounts ?? [0, 0];
  writeFileSync(
    join(dir, `.fake-revlist-${revlistKey("main...upstream/main")}`),
    `${ahead}\t${behind}\n`,
  );

  if (opts.head) writeFileSync(join(dir, ".fake-head"), `${opts.head}\n`);

  const branches = ["main", ...(opts.branches ?? [])];
  writeFileSync(join(dir, ".fake-branches"), branches.join("\n") + "\n");

  for (const [branch, [a, b]] of Object.entries(opts.branchCounts ?? {})) {
    writeFileSync(
      join(dir, `.fake-revlist-${revlistKey(`${branch}...main`)}`),
      `${a}\t${b}\n`,
    );
  }

  if (opts.state) {
    writeFileSync(join(dir, ".fake-state"), opts.state.join("\n") + "\n");
  }
}

const REPOS = [
  { name: "Talishar", dir: "talishar" },
  { name: "Talishar-FE", dir: "talishar-fe" },
  { name: "CardImages", dir: "talishar-cardimages" },
];

describe("scripts/talishar-fork-sync.sh", () => {
  it("fast-forwards a behind main and pushes to origin (happy path)", () => {
    const sb = makeSandbox();
    seedRepo(sb, "talishar", { mainCounts: [0, 3] });

    const { stdout, status } = run(sb);
    expect(status).toBe(0);

    const dir = join(sb.thirdParty, "talishar");
    const log = readFileSync(sb.log, "utf8");
    expect(log).toContain(`git -C ${dir} fetch upstream`);
    expect(log).toContain(`git -C ${dir} fetch origin`);
    expect(log).toContain(`git -C ${dir} merge --ff-only upstream/main`);
    expect(log).toContain(`git -C ${dir} push origin main`);
    expect(stdout).toMatch(
      /^synced: .*talishar main fast-forwarded 3 commit\(s\), pushed to origin$/m,
    );
  });

  it("updates main via fetch-into-ref (not merge) when a feature branch is checked out", () => {
    const sb = makeSandbox();
    seedRepo(sb, "talishar", { mainCounts: [0, 2], head: "feat/some-card" });

    const { status } = run(sb);
    expect(status).toBe(0);

    const dir = join(sb.thirdParty, "talishar");
    const log = readFileSync(sb.log, "utf8");
    expect(log).not.toContain(`git -C ${dir} merge --ff-only upstream/main`);
    expect(log).toContain(`git -C ${dir} fetch . upstream/main:main`);
    expect(log).toContain(`git -C ${dir} push origin main`);
  });

  it("reports a diverged main without pushing, and exits nonzero", () => {
    const sb = makeSandbox();
    seedRepo(sb, "talishar", { mainCounts: [2, 5] });

    const { stdout, status } = run(sb);
    expect(status).not.toBe(0);

    const dir = join(sb.thirdParty, "talishar");
    const log = readFileSync(sb.log, "utf8");
    expect(log).not.toContain(`git -C ${dir} push`);
    expect(log).not.toContain(`git -C ${dir} merge`);
    expect(stdout).toMatch(
      /^diverged: .*talishar main is 2 ahead \/ 5 behind upstream\/main — resolve manually, no push$/m,
    );
  });

  it("skips a missing repo with a notice but still processes the others", () => {
    const sb = makeSandbox();
    // talishar is intentionally not seeded/created at all
    seedRepo(sb, "talishar-fe", { mainCounts: [0, 0] });
    seedRepo(sb, "talishar-cardimages", { mainCounts: [0, 0] });

    const { stdout, status } = run(sb);
    expect(status).toBe(0);

    const missingDir = join(sb.thirdParty, "talishar");
    expect(stdout).toMatch(
      new RegExp(
        `^skip: ${missingDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} not present`,
        "m",
      ),
    );

    const log = readFileSync(sb.log, "utf8");
    for (const dir of [
      join(sb.thirdParty, "talishar-fe"),
      join(sb.thirdParty, "talishar-cardimages"),
    ]) {
      expect(log).toContain(`git -C ${dir} fetch upstream`);
    }
  });

  it("rebases a feature branch onto updated main when --rebase-branches is passed", () => {
    const sb = makeSandbox();
    seedRepo(sb, "talishar", {
      mainCounts: [0, 1],
      branches: ["feat/foo"],
      branchCounts: { "feat/foo": [2, 1] },
    });

    const { stdout, status } = run(sb, ["--rebase-branches"]);
    expect(status).toBe(0);

    const dir = join(sb.thirdParty, "talishar");
    const log = readFileSync(sb.log, "utf8");
    expect(log).toContain(`git -C ${dir} rebase main feat/foo`);
    expect(stdout).toMatch(
      /^branch: .*talishar\/feat\/foo is 2 ahead \/ 1 behind main$/m,
    );
    expect(stdout).toMatch(
      /^rebased: .*talishar\/feat\/foo onto updated main/m,
    );
  });

  it("aborts and reports a conflict instead of resolving it silently, and exits nonzero", () => {
    const sb = makeSandbox();
    seedRepo(sb, "talishar", {
      mainCounts: [0, 1],
      branches: ["feat/conflicting"],
      branchCounts: { "feat/conflicting": [1, 1] },
      state: ["rebase-feat/conflicting=fail"],
    });

    const { stdout, status } = run(sb, ["--rebase-branches"]);
    expect(status).not.toBe(0);

    const dir = join(sb.thirdParty, "talishar");
    const log = readFileSync(sb.log, "utf8");
    expect(log).toContain(`git -C ${dir} rebase main feat/conflicting`);
    expect(log).toContain(`git -C ${dir} rebase --abort`);
    expect(stdout).toMatch(
      /^conflict: .*talishar\/feat\/conflicting could not be rebased/m,
    );
  });

  it("never pushes to upstream and fetches upstream for every present repo", () => {
    const sb = makeSandbox();
    seedRepo(sb, "talishar", { mainCounts: [0, 1] });
    seedRepo(sb, "talishar-fe", { mainCounts: [3, 4] }); // diverged
    seedRepo(sb, "talishar-cardimages", {
      mainCounts: [0, 0],
      branches: ["feat/bar"],
      branchCounts: { "feat/bar": [1, 0] },
    });

    run(sb, ["--rebase-branches"]);

    const log = readFileSync(sb.log, "utf8");
    expect(log).not.toMatch(/push upstream/);
    expect(log).not.toMatch(/-C \S+ push \S*upstream/);

    for (const repo of REPOS) {
      const dir = join(sb.thirdParty, repo.dir);
      expect(log).toContain(`git -C ${dir} fetch upstream`);
    }
  });

  it("reports an error and keeps processing the remaining repos when a push fails", () => {
    const sb = makeSandbox();
    seedRepo(sb, "talishar", { mainCounts: [0, 2], state: ["push=fail"] });
    seedRepo(sb, "talishar-fe", { mainCounts: [0, 0] });
    seedRepo(sb, "talishar-cardimages", { mainCounts: [0, 0] });

    const { stdout, status } = run(sb);
    expect(status).not.toBe(0);

    const dir = join(sb.thirdParty, "talishar");
    const log = readFileSync(sb.log, "utf8");
    expect(log).toContain(`git -C ${dir} merge --ff-only upstream/main`);
    expect(log).toContain(`git -C ${dir} push origin main`);
    expect(stdout).toMatch(
      /^error: .*talishar push origin main failed — skipping, check manually$/m,
    );
    // must not claim success for the repo whose push actually failed
    expect(stdout).not.toMatch(/^synced: .*talishar /m);

    // the other two repos are still fully processed, not aborted
    for (const other of ["talishar-fe", "talishar-cardimages"]) {
      const otherDir = join(sb.thirdParty, other);
      expect(log).toContain(`git -C ${otherDir} fetch upstream`);
      expect(stdout).toMatch(
        new RegExp(
          `^ok: ${otherDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `,
          "m",
        ),
      );
    }
  });

  it("reports an error and keeps processing the remaining repos when the ff-only merge fails", () => {
    const sb = makeSandbox();
    seedRepo(sb, "talishar", { mainCounts: [0, 2], state: ["merge=fail"] });
    seedRepo(sb, "talishar-fe", { mainCounts: [0, 0] });
    seedRepo(sb, "talishar-cardimages", { mainCounts: [0, 0] });

    const { stdout, status } = run(sb);
    expect(status).not.toBe(0);

    const dir = join(sb.thirdParty, "talishar");
    const log = readFileSync(sb.log, "utf8");
    expect(log).toContain(`git -C ${dir} merge --ff-only upstream/main`);
    // a failed merge must never be followed by a push attempt
    expect(log).not.toContain(`git -C ${dir} push origin main`);
    expect(stdout).toMatch(
      /^error: .*talishar merge --ff-only failed — skipping, check manually$/m,
    );

    for (const other of ["talishar-fe", "talishar-cardimages"]) {
      const otherDir = join(sb.thirdParty, other);
      expect(log).toContain(`git -C ${otherDir} fetch upstream`);
      expect(stdout).toMatch(
        new RegExp(
          `^ok: ${otherDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `,
          "m",
        ),
      );
    }
  });

  it("reports an error instead of dying when `git rebase --abort` itself fails, and keeps processing", () => {
    const sb = makeSandbox();
    seedRepo(sb, "talishar", {
      mainCounts: [0, 1],
      branches: ["feat/x"],
      branchCounts: { "feat/x": [1, 1] },
      state: ["rebase-feat/x=fail", "abort=fail"],
    });
    seedRepo(sb, "talishar-fe", { mainCounts: [0, 0] });
    seedRepo(sb, "talishar-cardimages", { mainCounts: [0, 0] });

    const { stdout, status } = run(sb, ["--rebase-branches"]);
    expect(status).not.toBe(0);

    const dir = join(sb.thirdParty, "talishar");
    const log = readFileSync(sb.log, "utf8");
    expect(log).toContain(`git -C ${dir} rebase main feat/x`);
    expect(log).toContain(`git -C ${dir} rebase --abort`);
    expect(stdout).toMatch(
      /^error: .*talishar rebase --abort \(feat\/x\) failed — skipping, check manually$/m,
    );

    for (const other of ["talishar-fe", "talishar-cardimages"]) {
      const otherDir = join(sb.thirdParty, other);
      expect(log).toContain(`git -C ${otherDir} fetch upstream`);
    }
  });
});
