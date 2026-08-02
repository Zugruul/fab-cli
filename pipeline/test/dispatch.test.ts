// storm590x remote training dispatch — command builders + dispatcher state
// machine (#208, E2/APP-020 prep). See CLAUDE.md's remote-machine-facts for
// the baked-in defaults asserted below (host storm590x, ext4-only
// remoteBase, full-path nvidia-smi, zsh-bypass bash -lc wrapping).
//
// Round 2 (PR #213 review): fixes a real shell-injection hole in
// buildTmuxLaunch (an apostrophe in any trainArgv token or runId broke
// out of the outer single-quoted `bash -lc '...'` wrapper and ran as
// remote shell syntax — reproduced and confirmed exploitable against the
// round-1 code via a live zsh/tmux simulation, and confirmed fixed
// against this round's code the same way), plus three real bugs found by
// an actual storm590x smoke test: rsync push failing when the remote run
// dir doesn't exist yet (needs mkdir -p first), finished-detection never
// firing against real tmux's "no server running" wording, and a
// decorative pythonPath field that's now dropped entirely.
//
// Round 3 (PR #213 review, real storm590x re-smoke of round 2): round 2's
// per-token trainArgv escaping (shQuote) correctly inertized shell
// metacharacters but also quoted a leading `~`, and a quoted tilde never
// expands — so the documented invocation (~/.venv/bin/python3 ...) itself
// broke ("no such file or directory: ~/.venv/bin/python3" in run.log).
// Fixed by quoting trainArgv tokens with the same tilde-preserving
// treatment (shQuotePath) already used for the run directory. Reproduced
// against round 2's code and confirmed fixed against this round's code via
// the same live zsh/tmux simulation approach used for the round-2 fix.
import { describe, it, expect } from "vitest";
import {
  buildRsyncPush,
  buildTmuxLaunch,
  buildStatusProbe,
  buildGpuProbe,
  buildRsyncPull,
  buildEnsureRunDir,
  validateConfig,
  validateRunId,
} from "../src/dispatch/commands.js";
import { Dispatcher, DispatchError } from "../src/dispatch/dispatcher.js";
import { DEFAULT_DISPATCH_CONFIG } from "../src/dispatch/types.js";
import type { RemoteExecutor, ExecResult } from "../src/dispatch/types.js";
import { parseArgs } from "../src/dispatch/cli.js";

describe("DEFAULT_DISPATCH_CONFIG", () => {
  it("bakes in the verified storm590x defaults (no pythonPath — nothing here invokes python directly)", () => {
    expect(DEFAULT_DISPATCH_CONFIG).toEqual({
      host: "storm590x",
      remoteBase: "~/fab-training",
      nvidiaSmiPath: "/usr/lib/wsl/lib/nvidia-smi",
      tmuxSessionPrefix: "fab-train",
    });
  });

  it("has no pythonPath field at all", () => {
    expect("pythonPath" in DEFAULT_DISPATCH_CONFIG).toBe(false);
  });
});

describe("validateConfig — DrvFs (/mnt/) guard", () => {
  it("does not throw for the ext4 default remoteBase", () => {
    expect(() => validateConfig(DEFAULT_DISPATCH_CONFIG)).not.toThrow();
  });

  it("does not throw for another ext4-rooted remoteBase", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/home/leona/fab-training" })).not.toThrow();
  });

  it("does not false-positive on a segment that merely contains 'mnt' as a substring", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "~/mnt-backup/fab-training" })).not.toThrow();
  });

  it("throws when remoteBase resolves under /mnt/", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/fab-training" })).toThrow(/\/mnt\//);
  });

  it("throws for the bare /mnt root too", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt" })).toThrow(/\/mnt/);
  });

  it("throws for a double-slash /mnt/ path (collapsed before the segment check)", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "//mnt/f/fab-training" })).toThrow(/\/mnt\//);
  });

  it("throws case-insensitively for /MNT/", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/MNT/f/fab-training" })).toThrow(/mnt/i);
  });

  it("rejects any remoteBase containing '..' outright, even one that spells its way into /mnt/", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "~/../../mnt/f" })).toThrow(/\.\./);
  });
});

describe("validateRunId — safe-charset guard (runId is embedded in remote shell commands)", () => {
  it("accepts letters, digits, '.', '_', '-'", () => {
    expect(() => validateRunId("run-001")).not.toThrow();
    expect(() => validateRunId("run.001_v2")).not.toThrow();
    expect(() => validateRunId("RUN123")).not.toThrow();
  });

  it("rejects an apostrophe", () => {
    expect(() => validateRunId("leo's-run")).toThrow(/runId/);
  });

  it("rejects a space", () => {
    expect(() => validateRunId("run 001")).toThrow();
  });

  it("rejects shell metacharacters", () => {
    expect(() => validateRunId("run;rm -rf ~")).toThrow();
    expect(() => validateRunId("run$(whoami)")).toThrow();
  });

  it("rejects the empty string", () => {
    expect(() => validateRunId("")).toThrow();
  });
});

const RUN_ID = "run-001";

describe("buildRsyncPush", () => {
  it("builds the exact rsync argv: -az --delete over ssh, excluding .git/node_modules/artifacts/", () => {
    const argv = buildRsyncPush(RUN_ID, ["pipeline", "scripts"], DEFAULT_DISPATCH_CONFIG);
    expect(argv).toEqual([
      "rsync",
      "-az",
      "--delete",
      "-e",
      "ssh -o BatchMode=yes",
      "--exclude",
      ".git",
      "--exclude",
      "node_modules",
      "--exclude",
      "artifacts/",
      "pipeline",
      "scripts",
      "storm590x:~/fab-training/run-001/",
    ]);
  });

  it("applies the /mnt/ guard", () => {
    expect(() =>
      buildRsyncPush(RUN_ID, ["pipeline"], { ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/fab-training" }),
    ).toThrow(/\/mnt\//);
  });

  it("applies the runId safe-charset guard", () => {
    expect(() => buildRsyncPush("leo's-run", ["pipeline"], DEFAULT_DISPATCH_CONFIG)).toThrow(/runId/);
  });
});

describe("buildEnsureRunDir", () => {
  it("builds the exact ssh argv for mkdir -p of the run's remote directory", () => {
    const argv = buildEnsureRunDir(RUN_ID, DEFAULT_DISPATCH_CONFIG);
    expect(argv).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "storm590x",
      "bash -lc 'mkdir -p ~/'\\''fab-training/run-001'\\'''",
    ]);
  });

  it("applies the /mnt/ guard", () => {
    expect(() => buildEnsureRunDir(RUN_ID, { ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/x" })).toThrow(/\/mnt\//);
  });

  it("applies the runId safe-charset guard", () => {
    expect(() => buildEnsureRunDir("leo's-run", DEFAULT_DISPATCH_CONFIG)).toThrow(/runId/);
  });
});

describe("buildTmuxLaunch — the three-shell chain, verified injection-safe AND tilde-expansion-safe", () => {
  // Expected strings below were generated programmatically and verified by
  // actually running them through a live zsh/tmux simulation (fake tmux +
  // fake python executables, real zsh -c) during review rounds 2 and 3 —
  // not hand-derived. See commands.ts's doc comment for the full chain
  // explanation (remote login zsh -> bash -lc -> tmux's pane shell).
  //
  // Round 3: a trainArgv[0] of "~/.venv/bin/python3" — exactly the
  // documented invocation — failed on the real box ("no such file or
  // directory: ~/.venv/bin/python3") because round 2's plain shQuote
  // wrapped the leading ~ in single quotes too, which suppresses tilde
  // expansion. Fixed by quoting trainArgv tokens with shQuotePath (same
  // tilde-preserving treatment already used for the run directory) —
  // reproduced against the live simulation with the round-2 code first
  // (confirmed the exact failure), then confirmed fixed with this round's
  // code (the fake python received the correct argv, run.log was written).
  it("builds the exact ssh argv: bash -lc wrapping tmux new-session with -c <dir> and per-token tilde-preserving-quoted trainArgv", () => {
    const argv = buildTmuxLaunch(RUN_ID, ["~/.venv/bin/python3", "train.py", "--epochs", "3"], DEFAULT_DISPATCH_CONFIG);
    expect(argv).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "storm590x",
      "bash -lc 'tmux new-session -d -s '\\''fab-train-run-001'\\'' -c ~/'\\''fab-training/run-001'\\'' \"~/'\\''.venv/bin/python3'\\'' '\\''train.py'\\'' '\\''--epochs'\\'' '\\''3'\\'' 2>&1 | tee run.log\"'",
    ]);
  });

  it("a bare tilde-prefixed trainArgv[0] keeps its ~/ unquoted so the pane shell still expands it to $HOME (this exact case failed against the real box under round 2's code)", () => {
    const argv = buildTmuxLaunch(RUN_ID, ["~/.venv/bin/python3"], DEFAULT_DISPATCH_CONFIG);
    expect(argv).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "storm590x",
      "bash -lc 'tmux new-session -d -s '\\''fab-train-run-001'\\'' -c ~/'\\''fab-training/run-001'\\'' \"~/'\\''.venv/bin/python3'\\'' 2>&1 | tee run.log\"'",
    ]);
  });

  it("keeps a trainArgv token containing an apostrophe and spaces as one literal argument, not shell syntax (the round-2 injection fix)", () => {
    const argv = buildTmuxLaunch(
      RUN_ID,
      ["~/.venv/bin/python3", "train.py", "--notes", "it's a test"],
      DEFAULT_DISPATCH_CONFIG,
    );
    expect(argv).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "storm590x",
      "bash -lc 'tmux new-session -d -s '\\''fab-train-run-001'\\'' -c ~/'\\''fab-training/run-001'\\'' \"~/'\\''.venv/bin/python3'\\'' '\\''train.py'\\'' '\\''--notes'\\'' '\\''it'\\''\\\\'\\'''\\''s a test'\\'' 2>&1 | tee run.log\"'",
    ]);
  });

  it("a tilde-prefixed trainArgv token whose remainder contains a quote and a space stays inert (~/ expands, the rest is escaped like plain shQuote)", () => {
    const argv = buildTmuxLaunch(RUN_ID, ["~/dir with 'quote'/bin"], DEFAULT_DISPATCH_CONFIG);
    expect(argv).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "storm590x",
      "bash -lc 'tmux new-session -d -s '\\''fab-train-run-001'\\'' -c ~/'\\''fab-training/run-001'\\'' \"~/'\\''dir with '\\''\\\\'\\'''\\''quote'\\''\\\\'\\'''\\''/bin'\\'' 2>&1 | tee run.log\"'",
    ]);
  });

  it("a tilde-prefixed trainArgv token whose remainder looks like a command substitution never executes it — confirmed against a live zsh simulation (no marker file created)", () => {
    const argv = buildTmuxLaunch(RUN_ID, ["~/$(evil)/x"], DEFAULT_DISPATCH_CONFIG);
    expect(argv).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "storm590x",
      "bash -lc 'tmux new-session -d -s '\\''fab-train-run-001'\\'' -c ~/'\\''fab-training/run-001'\\'' \"~/'\\''\\$(evil)/x'\\'' 2>&1 | tee run.log\"'",
    ]);
  });

  it("namespaces the tmux session with the configured prefix and runId", () => {
    const argv = buildTmuxLaunch(RUN_ID, ["python3", "train.py"], {
      ...DEFAULT_DISPATCH_CONFIG,
      tmuxSessionPrefix: "custom-prefix",
    });
    expect(argv).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "storm590x",
      "bash -lc 'tmux new-session -d -s '\\''custom-prefix-run-001'\\'' -c ~/'\\''fab-training/run-001'\\'' \"'\\''python3'\\'' '\\''train.py'\\'' 2>&1 | tee run.log\"'",
    ]);
  });

  it("applies the /mnt/ guard", () => {
    expect(() => buildTmuxLaunch(RUN_ID, ["python3"], { ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/x" })).toThrow(
      /\/mnt\//,
    );
  });

  it("applies the runId safe-charset guard — an apostrophe in runId throws rather than being embedded", () => {
    expect(() => buildTmuxLaunch("leo's-run", ["python3"], DEFAULT_DISPATCH_CONFIG)).toThrow(/runId/);
  });
});

describe("buildStatusProbe", () => {
  it("builds the exact tmux has-session probe + tail -n N run.log argvs, session/dir single-quoted", () => {
    const probe = buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG, 50);
    expect(probe).toEqual({
      hasSession: [
        "ssh",
        "-o",
        "BatchMode=yes",
        "storm590x",
        "bash -lc 'tmux has-session -t '\\''fab-train-run-001'\\'''",
      ],
      tailLog: [
        "ssh",
        "-o",
        "BatchMode=yes",
        "storm590x",
        "bash -lc 'tail -n 50 ~/'\\''fab-training/run-001'\\''/run.log'",
      ],
    });
  });

  it("defaults tailLines to 50 when omitted", () => {
    const probe = buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG);
    expect(probe.tailLog[4]).toContain("tail -n 50");
  });

  it("honors a custom tail line count", () => {
    const probe = buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG, 200);
    expect(probe.tailLog[4]).toBe("bash -lc 'tail -n 200 ~/'\\''fab-training/run-001'\\''/run.log'");
  });

  it("applies the /mnt/ guard", () => {
    expect(() => buildStatusProbe(RUN_ID, { ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/x" })).toThrow(/\/mnt\//);
  });

  it("applies the runId safe-charset guard", () => {
    expect(() => buildStatusProbe("leo's-run", DEFAULT_DISPATCH_CONFIG)).toThrow(/runId/);
  });
});

describe("buildGpuProbe", () => {
  it("builds the exact full-path nvidia-smi query argv", () => {
    const argv = buildGpuProbe(DEFAULT_DISPATCH_CONFIG);
    expect(argv).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "storm590x",
      "bash -lc '/usr/lib/wsl/lib/nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader'",
    ]);
  });

  it("applies the /mnt/ guard", () => {
    expect(() => buildGpuProbe({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/x" })).toThrow(/\/mnt\//);
  });
});

describe("buildRsyncPull", () => {
  it("builds the exact rsync pull argv from the run's remote artifact dir", () => {
    const argv = buildRsyncPull(RUN_ID, "artifacts", "./out/artifacts/run-001", DEFAULT_DISPATCH_CONFIG);
    expect(argv).toEqual([
      "rsync",
      "-az",
      "-e",
      "ssh -o BatchMode=yes",
      "storm590x:~/fab-training/run-001/artifacts/",
      "./out/artifacts/run-001",
    ]);
  });

  it("applies the /mnt/ guard", () => {
    expect(() =>
      buildRsyncPull(RUN_ID, "artifacts", "/tmp/out", { ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/x" }),
    ).toThrow(/\/mnt\//);
  });

  it("applies the runId safe-charset guard", () => {
    expect(() => buildRsyncPull("leo's-run", "artifacts", "/tmp/out", DEFAULT_DISPATCH_CONFIG)).toThrow(/runId/);
  });
});

// Fake RemoteExecutor: records every argv it was called with and returns
// pre-scripted results in call order. Never touches ssh/rsync.
class FakeExecutor implements RemoteExecutor {
  calls: string[][] = [];
  private results: (ExecResult | Error)[];
  constructor(results: (ExecResult | Error)[]) {
    this.results = [...results];
  }
  async run(cmd: string[]): Promise<ExecResult> {
    this.calls.push(cmd);
    const next = this.results.shift();
    if (next === undefined) throw new Error("FakeExecutor: no scripted result left for call " + this.calls.length);
    if (next instanceof Error) throw next;
    return next;
  }
}

const ok = (stdout = "", stderr = ""): ExecResult => ({ code: 0, stdout, stderr });

describe("Dispatcher — constructor config validation", () => {
  it("throws immediately for a /mnt/-rooted config, before any command runs", () => {
    const executor = new FakeExecutor([]);
    expect(
      () => new Dispatcher(executor, { ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/fab-training" }),
    ).toThrow(/\/mnt\//);
    expect(executor.calls).toEqual([]);
  });
});

describe("Dispatcher#push — mkdir -p before rsync (rsync won't create nested remote parents)", () => {
  it("calls mkdir -p then rsync, in that order, and returns a structured success result from the rsync call", async () => {
    const executor = new FakeExecutor([ok("", ""), ok("sent 1024 bytes", "")]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.push(RUN_ID, ["pipeline"]);
    expect(executor.calls).toEqual([
      buildEnsureRunDir(RUN_ID, DEFAULT_DISPATCH_CONFIG),
      buildRsyncPush(RUN_ID, ["pipeline"], DEFAULT_DISPATCH_CONFIG),
    ]);
    expect(result).toEqual({ runId: RUN_ID, code: 0, stdout: "sent 1024 bytes", stderr: "" });
  });

  it("surfaces a non-zero mkdir exit as a typed DispatchError and never calls rsync", async () => {
    const executor = new FakeExecutor([
      { code: 1, stdout: "", stderr: "mkdir: cannot create directory: Permission denied" },
    ]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    await expect(dispatcher.push(RUN_ID, ["pipeline"])).rejects.toMatchObject({
      code: 1,
      stderr: "mkdir: cannot create directory: Permission denied",
    });
    // Only one call recorded — proves rsync was never attempted after the
    // mkdir failure (a second, unscripted executor.run call would itself
    // throw a different, distinguishable "no scripted result" error).
    expect(executor.calls).toEqual([buildEnsureRunDir(RUN_ID, DEFAULT_DISPATCH_CONFIG)]);
  });

  it("surfaces a non-zero rsync exit code as a typed DispatchError, not swallowed, after a successful mkdir", async () => {
    const executor = new FakeExecutor([ok(), { code: 23, stdout: "", stderr: "rsync: no space left on device" }]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    await expect(dispatcher.push(RUN_ID, ["pipeline"])).rejects.toBeInstanceOf(DispatchError);

    const executor2 = new FakeExecutor([ok(), { code: 23, stdout: "", stderr: "rsync: no space left on device" }]);
    const dispatcher2 = new Dispatcher(executor2, DEFAULT_DISPATCH_CONFIG);
    try {
      await dispatcher2.push(RUN_ID, ["pipeline"]);
      throw new Error("expected push to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(DispatchError);
      const dispatchErr = err as DispatchError;
      expect(dispatchErr.code).toBe(23);
      expect(dispatchErr.stderr).toBe("rsync: no space left on device");
      expect(dispatchErr.message).toContain(RUN_ID);
      expect(dispatchErr.message).toContain("23");
    }
  });

  it("propagates an executor rejection (e.g. ssh not reachable) unwrapped, never swallowed", async () => {
    const boom = new Error("ssh: connect to host storm590x port 22: Connection refused");
    const executor = new FakeExecutor([boom]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    await expect(dispatcher.push(RUN_ID, ["pipeline"])).rejects.toBe(boom);
  });
});

describe("Dispatcher#launch", () => {
  it("runs the exact tmux-launch argv and returns the session name", async () => {
    const executor = new FakeExecutor([ok()]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const trainArgv = ["~/.venv/bin/python3", "train.py"];
    const result = await dispatcher.launch(RUN_ID, trainArgv);
    expect(executor.calls).toEqual([buildTmuxLaunch(RUN_ID, trainArgv, DEFAULT_DISPATCH_CONFIG)]);
    expect(result).toEqual({ runId: RUN_ID, session: "fab-train-run-001", code: 0, stdout: "", stderr: "" });
  });

  it("surfaces a non-zero tmux/ssh exit code as a typed DispatchError", async () => {
    const executor = new FakeExecutor([{ code: 255, stdout: "", stderr: "ssh: Host key verification failed." }]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    await expect(dispatcher.launch(RUN_ID, ["python3"])).rejects.toMatchObject({
      code: 255,
      stderr: "ssh: Host key verification failed.",
    });
  });
});

describe("Dispatcher#status", () => {
  it("maps tmux has-session exit 0 to running and returns the log tail, with no tailError", async () => {
    const executor = new FakeExecutor([ok(), ok("line1\nline2\n")]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.status(RUN_ID);
    const probe = buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG, 50);
    expect(executor.calls).toEqual([probe.hasSession, probe.tailLog]);
    expect(result).toEqual({ runId: RUN_ID, status: "running", logTail: "line1\nline2\n" });
    expect(result.tailError).toBeUndefined();
  });

  it("maps tmux has-session exit 1 + 'no server running' (real tmux wording once the server has exited) to finished", async () => {
    const executor = new FakeExecutor([
      { code: 1, stdout: "", stderr: "no server running on /tmp/tmux-1000/default" },
      ok("training complete\n"),
    ]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.status(RUN_ID);
    expect(result.status).toBe("finished");
    expect(result.logTail).toBe("training complete\n");
  });

  it("maps tmux has-session exit 1 + 'can't find session'-style stderr to finished too", async () => {
    const executor = new FakeExecutor([
      { code: 1, stdout: "", stderr: "can't find session fab-train-run-001: no such session" },
      ok("training complete\n"),
    ]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.status(RUN_ID);
    expect(result.status).toBe("finished");
  });

  it("maps any other exit code (e.g. ssh failure) to unknown", async () => {
    const executor = new FakeExecutor([
      { code: 255, stdout: "", stderr: "ssh: connect to host storm590x port 22: Connection timed out" },
      { code: 1, stdout: "", stderr: "" },
    ]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.status(RUN_ID);
    expect(result.status).toBe("unknown");
  });

  it("does NOT map to finished when the no-session wording appears but the exit code isn't 1 (only tmux's own no-session exit counts)", async () => {
    const executor = new FakeExecutor([
      { code: 130, stdout: "", stderr: "no server running on /tmp/tmux-1000/default (via a different failure path)" },
      ok(),
    ]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.status(RUN_ID);
    expect(result.status).toBe("unknown");
  });

  it("passes a custom tailLines through to the probe", async () => {
    const executor = new FakeExecutor([ok(), ok()]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    await dispatcher.status(RUN_ID, 10);
    expect(executor.calls[1]).toEqual(buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG, 10).tailLog);
  });

  it("never throws when the tail probe fails, and surfaces the failure via tailError instead", async () => {
    const executor = new FakeExecutor([
      ok(),
      { code: 1, stdout: "", stderr: "tail: cannot open 'run.log': No such file or directory" },
    ]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.status(RUN_ID);
    expect(result.status).toBe("running");
    expect(result.logTail).toBe("");
    expect(result.tailError).toBe("tail: cannot open 'run.log': No such file or directory");
  });
});

describe("Dispatcher#pullArtifacts", () => {
  it("runs the exact rsync-pull argv and returns a structured success result", async () => {
    const executor = new FakeExecutor([ok("received 4096 bytes")]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.pullArtifacts(RUN_ID, "artifacts", "./out/artifacts/run-001");
    expect(executor.calls).toEqual([
      buildRsyncPull(RUN_ID, "artifacts", "./out/artifacts/run-001", DEFAULT_DISPATCH_CONFIG),
    ]);
    expect(result).toEqual({ runId: RUN_ID, code: 0, stdout: "received 4096 bytes", stderr: "" });
  });

  it("surfaces a non-zero rsync exit code as a typed DispatchError", async () => {
    const executor = new FakeExecutor([{ code: 12, stdout: "", stderr: "rsync error: protocol data stream error" }]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    await expect(dispatcher.pullArtifacts(RUN_ID, "artifacts", "/tmp/out")).rejects.toBeInstanceOf(DispatchError);
  });
});

describe("dispatch/cli.ts parseArgs", () => {
  it("parses a push command with a run-id and trailing local paths after --", () => {
    const args = parseArgs(["push", "--run-id", "run-001", "--", "pipeline", "scripts"]);
    expect(args.command).toBe("push");
    expect(args.runId).toBe("run-001");
    expect(args.localPaths).toEqual(["pipeline", "scripts"]);
    expect(args.config).toEqual(DEFAULT_DISPATCH_CONFIG);
  });

  it("parses a launch command with a config override and trailing train argv after --", () => {
    const args = parseArgs([
      "launch",
      "--run-id",
      "run-001",
      "--host",
      "other-host",
      "--",
      "python3",
      "train.py",
      "--epochs",
      "3",
    ]);
    expect(args.command).toBe("launch");
    expect(args.trainArgv).toEqual(["python3", "train.py", "--epochs", "3"]);
    expect(args.config.host).toBe("other-host");
    expect(args.config.remoteBase).toBe(DEFAULT_DISPATCH_CONFIG.remoteBase);
  });

  it("has no --python-path flag — an unrecognized flag is simply not applied, config stays at defaults", () => {
    const args = parseArgs(["launch", "--run-id", "run-001", "--python-path", "/some/path", "--", "python3"]);
    expect(args.config).toEqual(DEFAULT_DISPATCH_CONFIG);
    expect("pythonPath" in args.config).toBe(false);
  });

  it("parses a status command with a custom tail-lines flag", () => {
    const args = parseArgs(["status", "--run-id", "run-001", "--tail-lines", "100"]);
    expect(args.command).toBe("status");
    expect(args.tailLines).toBe(100);
  });

  it("parses a pull command with remote-artifact-dir and local-dest flags", () => {
    const args = parseArgs(["pull", "--run-id", "run-001", "--remote-artifact-dir", "ckpt", "--local-dest", "/tmp/out"]);
    expect(args.command).toBe("pull");
    expect(args.remoteArtifactDir).toBe("ckpt");
    expect(args.localDest).toBe("/tmp/out");
  });

  it("throws on an unknown command", () => {
    expect(() => parseArgs(["bogus", "--run-id", "run-001"])).toThrow(/bogus/);
  });

  it("throws when --run-id is missing", () => {
    expect(() => parseArgs(["push", "--", "pipeline"])).toThrow(/--run-id/);
  });
});
