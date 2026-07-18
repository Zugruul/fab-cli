import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";

const REAL_SCRIPT = join(process.cwd(), "scripts", "talishar-bootstrap.sh");

const FAKE_GIT = `#!/usr/bin/env bash
echo "git $*" >> "$FAKE_LOG"
if [ "$1" = "clone" ]; then
  url="$2"; dir="$3"
  mkdir -p "$dir/.git"
  exit 0
fi
if [ "$1" = "-C" ]; then
  dir="$2"; sub="$3"; action="$4"
  state="$dir/.fake-remotes"
  if [ "$sub" = "remote" ]; then
    if [ "$action" = "get-url" ]; then
      remote="$5"
      val=$(grep "^\${remote}=" "$state" 2>/dev/null | cut -d= -f2-)
      if [ -z "$val" ]; then exit 1; fi
      echo "$val"
      exit 0
    fi
    if [ "$action" = "add" ]; then
      remote="$5"; url="$6"
      echo "\${remote}=\${url}" >> "$state"
      exit 0
    fi
    if [ "$action" = "set-url" ]; then
      remote="$5"; url="$6"
      touch "$state"
      grep -v "^\${remote}=" "$state" > "$state.tmp" 2>/dev/null || true
      mv "$state.tmp" "$state"
      echo "\${remote}=\${url}" >> "$state"
      exit 0
    fi
  fi
fi
exit 0
`;

const FAKE_GH = `#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_LOG"
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  repo="$3"
  for m in \${FAKE_GH_MISSING:-}; do
    if [ "$m" = "$repo" ]; then exit 1; fi
  done
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "fork" ]; then
  exit 0
fi
exit 0
`;

interface Sandbox {
  root: string;
  scriptPath: string;
  thirdParty: string;
  bin: string;
  log: string;
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "talishar-bootstrap-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "third_party"));
  const bin = join(root, "bin");
  mkdirSync(bin);

  const scriptPath = join(root, "scripts", "talishar-bootstrap.sh");
  symlinkSync(REAL_SCRIPT, scriptPath);

  writeFileSync(join(bin, "git"), FAKE_GIT);
  chmodSync(join(bin, "git"), 0o755);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);

  const log = join(root, "fake.log");
  writeFileSync(log, "");

  return { root, scriptPath, thirdParty: join(root, "third_party"), bin, log };
}

function run(sb: Sandbox, extraEnv: Record<string, string> = {}) {
  try {
    const stdout = execFileSync("bash", [sb.scriptPath], {
      cwd: sb.root,
      env: {
        PATH: `${sb.bin}:${process.env.PATH}`,
        HOME: sb.root,
        FAKE_LOG: sb.log,
        ...extraEnv,
      },
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

function seedExistingRepo(
  sb: Sandbox,
  localName: string,
  remotes: { origin?: string; upstream?: string },
) {
  const dir = join(sb.thirdParty, localName);
  mkdirSync(join(dir, ".git"), { recursive: true });
  const lines: string[] = [];
  if (remotes.origin) lines.push(`origin=${remotes.origin}`);
  if (remotes.upstream) lines.push(`upstream=${remotes.upstream}`);
  writeFileSync(join(dir, ".fake-remotes"), lines.join("\n") + (lines.length ? "\n" : ""));
}

const REPOS = [
  { name: "Talishar", dir: "talishar" },
  { name: "Talishar-FE", dir: "talishar-fe" },
  { name: "CardImages", dir: "talishar-cardimages" },
];

function correctOrigin(repoName: string) {
  return `git@github.com:Zugruul/${repoName}.git`;
}
function correctUpstream(repoName: string) {
  return `https://github.com/Talishar/${repoName}.git`;
}

describe(".gitignore", () => {
  it("ignores the three Talishar vendored clones", () => {
    const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^third_party\/talishar\*/m);
  });
});

describe("scripts/talishar-bootstrap.sh", () => {
  beforeEach(() => {
    expect(existsSync(REAL_SCRIPT)).toBe(true);
  });

  it("clones all three repos fresh when nothing exists, with correct remotes", () => {
    const sb = makeSandbox();
    const { stdout, status } = run(sb);

    expect(status).toBe(0);
    const log = readFileSync(sb.log, "utf8");

    for (const repo of REPOS) {
      const dir = join(sb.thirdParty, repo.dir);
      expect(existsSync(join(dir, ".git"))).toBe(true);

      expect(log).toContain(`git clone ${correctOrigin(repo.name)} ${dir}`);
      expect(log).toContain(`git -C ${dir} remote add upstream ${correctUpstream(repo.name)}`);

      expect(stdout).toMatch(
        new RegExp(`^cloned: ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "m"),
      );
    }
  });

  it("makes no mutating calls on a rerun when everything is already correct", () => {
    const sb = makeSandbox();
    for (const repo of REPOS) {
      seedExistingRepo(sb, repo.dir, {
        origin: correctOrigin(repo.name),
        upstream: correctUpstream(repo.name),
      });
    }

    const { stdout, status } = run(sb);
    expect(status).toBe(0);

    const log = readFileSync(sb.log, "utf8");
    expect(log).not.toContain("clone ");
    expect(log).not.toContain("remote add");
    expect(log).not.toContain("remote set-url");
    expect(log).not.toContain("gh repo fork");

    for (const repo of REPOS) {
      const dir = join(sb.thirdParty, repo.dir);
      expect(stdout).toMatch(
        new RegExp(`^ok: ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "m"),
      );
    }
  });

  it("repairs a dir whose origin points at the upstream org instead of the fork", () => {
    const sb = makeSandbox();
    const wrongRepo = REPOS[0];
    seedExistingRepo(sb, wrongRepo.dir, {
      origin: `https://github.com/Talishar/${wrongRepo.name}.git`,
    });
    for (const repo of REPOS.slice(1)) {
      seedExistingRepo(sb, repo.dir, {
        origin: correctOrigin(repo.name),
        upstream: correctUpstream(repo.name),
      });
    }

    const { stdout, status } = run(sb);
    expect(status).toBe(0);

    const dir = join(sb.thirdParty, wrongRepo.dir);
    const log = readFileSync(sb.log, "utf8");
    expect(log).toContain(`git -C ${dir} remote set-url origin ${correctOrigin(wrongRepo.name)}`);
    expect(log).toContain(`git -C ${dir} remote add upstream ${correctUpstream(wrongRepo.name)}`);
    expect(stdout).toMatch(
      new RegExp(`^repaired: ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "m"),
    );

    // untouched repos stay ok, no mutating calls for them
    for (const repo of REPOS.slice(1)) {
      const okDir = join(sb.thirdParty, repo.dir);
      expect(stdout).toMatch(
        new RegExp(`^ok: ${okDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "m"),
      );
    }
  });

  it("forks before cloning when the fork does not yet exist", () => {
    const sb = makeSandbox();
    const { stdout, status } = run(sb, { FAKE_GH_MISSING: "Zugruul/Talishar" });

    expect(status).toBe(0);
    const log = readFileSync(sb.log, "utf8");

    const viewIdx = log.indexOf("gh repo view Zugruul/Talishar");
    const forkIdx = log.indexOf("gh repo fork Talishar/Talishar --clone=false");
    const cloneIdx = log.indexOf(`git clone ${correctOrigin("Talishar")}`);

    expect(viewIdx).toBeGreaterThanOrEqual(0);
    expect(forkIdx).toBeGreaterThan(viewIdx);
    expect(cloneIdx).toBeGreaterThan(forkIdx);

    const dir = join(sb.thirdParty, "talishar");
    expect(stdout).toMatch(
      new RegExp(`^forked\\+cloned: ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "m"),
    );
  });

  it("adds a missing upstream remote without touching a correct origin", () => {
    const sb = makeSandbox();
    for (const repo of REPOS) {
      if (repo === REPOS[1]) {
        seedExistingRepo(sb, repo.dir, { origin: correctOrigin(repo.name) });
      } else {
        seedExistingRepo(sb, repo.dir, {
          origin: correctOrigin(repo.name),
          upstream: correctUpstream(repo.name),
        });
      }
    }

    const { stdout, status } = run(sb);
    expect(status).toBe(0);

    const dir = join(sb.thirdParty, REPOS[1].dir);
    const log = readFileSync(sb.log, "utf8");
    expect(log).not.toContain(`git -C ${dir} remote set-url origin`);
    expect(log).toContain(`git -C ${dir} remote add upstream ${correctUpstream(REPOS[1].name)}`);
    expect(stdout).toMatch(
      new RegExp(`^repaired: ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "m"),
    );
  });

  it("fails loudly and exits nonzero when git is missing from PATH", () => {
    const sb = makeSandbox();
    // Empty PATH: no git, no gh, nothing but bash builtins. The script's
    // dependency check runs before touching third_party/, so this only
    // exercises `command -v git`/`command -v gh` via bash builtins.
    let threw = false;
    let status: number | undefined;
    try {
      execFileSync("/bin/bash", [sb.scriptPath], {
        cwd: sb.root,
        env: {
          PATH: "",
          HOME: sb.root,
          FAKE_LOG: sb.log,
        },
        encoding: "utf8",
      });
    } catch (err) {
      threw = true;
      status = (err as { status?: number }).status;
    }
    expect(threw).toBe(true);
    expect(status).not.toBe(0);
  });
});
