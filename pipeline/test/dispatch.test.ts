// storm590x remote training dispatch — command builders + dispatcher state
// machine (#208, E2/APP-020 prep). See CLAUDE.md's remote-machine-facts for
// the baked-in defaults asserted below (host storm590x, ext4-only
// remoteBase, full-path nvidia-smi, zsh-bypass bash -lc wrapping).
import { describe, it, expect } from "vitest";
import {
  buildRsyncPush,
  buildTmuxLaunch,
  buildStatusProbe,
  buildGpuProbe,
  buildRsyncPull,
  validateConfig,
} from "../src/dispatch/commands.js";
import { Dispatcher, DispatchError } from "../src/dispatch/dispatcher.js";
import { DEFAULT_DISPATCH_CONFIG } from "../src/dispatch/types.js";
import type { DispatchConfig, RemoteExecutor, ExecResult } from "../src/dispatch/types.js";
import { parseArgs } from "../src/dispatch/cli.js";

describe("DEFAULT_DISPATCH_CONFIG", () => {
  it("bakes in the verified storm590x defaults", () => {
    expect(DEFAULT_DISPATCH_CONFIG).toEqual({
      host: "storm590x",
      remoteBase: "~/fab-training",
      pythonPath: "~/.venv/bin/python3",
      nvidiaSmiPath: "/usr/lib/wsl/lib/nvidia-smi",
      tmuxSessionPrefix: "fab-train",
    });
  });
});

describe("validateConfig — DrvFs (/mnt/) ban", () => {
  it("does not throw for the ext4 default remoteBase", () => {
    expect(() => validateConfig(DEFAULT_DISPATCH_CONFIG)).not.toThrow();
  });

  it("does not throw for another ext4-rooted remoteBase", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/home/leona/fab-training" })).not.toThrow();
  });

  it("throws when remoteBase resolves under /mnt/", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/fab-training" })).toThrow(/\/mnt\//);
  });

  it("throws for the bare /mnt root too", () => {
    expect(() => validateConfig({ ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt" })).toThrow(/\/mnt/);
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
});

describe("buildTmuxLaunch — the zsh-bypass, quote-layered remote command", () => {
  it("builds the exact ssh argv wrapping bash -lc 'tmux new-session ... \"cd ... && ... | tee run.log\"'", () => {
    const argv = buildTmuxLaunch(RUN_ID, ["~/.venv/bin/python3", "train.py", "--epochs", "3"], DEFAULT_DISPATCH_CONFIG);
    expect(argv).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "storm590x",
      "bash -lc 'tmux new-session -d -s fab-train-run-001 \"cd ~/fab-training/run-001 && ~/.venv/bin/python3 train.py --epochs 3 2>&1 | tee run.log\"'",
    ]);
  });

  it("namespaces the tmux session with the configured prefix and runId", () => {
    const argv = buildTmuxLaunch(
      RUN_ID,
      ["python3", "train.py"],
      { ...DEFAULT_DISPATCH_CONFIG, tmuxSessionPrefix: "custom-prefix" },
    );
    expect(argv[4]).toContain("-s custom-prefix-run-001 ");
  });

  it("applies the /mnt/ guard", () => {
    expect(() =>
      buildTmuxLaunch(RUN_ID, ["python3"], { ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/x" }),
    ).toThrow(/\/mnt\//);
  });
});

describe("buildStatusProbe", () => {
  it("builds the exact tmux has-session probe + tail -n N run.log argvs", () => {
    const probe = buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG, 50);
    expect(probe).toEqual({
      hasSession: ["ssh", "-o", "BatchMode=yes", "storm590x", "bash -lc 'tmux has-session -t fab-train-run-001'"],
      tailLog: [
        "ssh",
        "-o",
        "BatchMode=yes",
        "storm590x",
        "bash -lc 'tail -n 50 ~/fab-training/run-001/run.log'",
      ],
    });
  });

  it("defaults tailLines to 50 when omitted", () => {
    const probe = buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG);
    expect(probe.tailLog[4]).toContain("tail -n 50");
  });

  it("honors a custom tail line count", () => {
    const probe = buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG, 200);
    expect(probe.tailLog[4]).toBe("bash -lc 'tail -n 200 ~/fab-training/run-001/run.log'");
  });

  it("applies the /mnt/ guard", () => {
    expect(() => buildStatusProbe(RUN_ID, { ...DEFAULT_DISPATCH_CONFIG, remoteBase: "/mnt/f/x" })).toThrow(/\/mnt\//);
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

describe("Dispatcher#push", () => {
  it("runs the exact rsync-push argv and returns a structured success result", async () => {
    const executor = new FakeExecutor([ok("sent 1024 bytes", "")]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.push(RUN_ID, ["pipeline"]);
    expect(executor.calls).toEqual([buildRsyncPush(RUN_ID, ["pipeline"], DEFAULT_DISPATCH_CONFIG)]);
    expect(result).toEqual({ runId: RUN_ID, code: 0, stdout: "sent 1024 bytes", stderr: "" });
  });

  it("surfaces a non-zero rsync exit code as a typed DispatchError, not swallowed", async () => {
    const executor = new FakeExecutor([{ code: 23, stdout: "", stderr: "rsync: no space left on device" }]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    await expect(dispatcher.push(RUN_ID, ["pipeline"])).rejects.toBeInstanceOf(DispatchError);
    const executor2 = new FakeExecutor([{ code: 23, stdout: "", stderr: "rsync: no space left on device" }]);
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
  it("maps tmux has-session exit 0 to running and returns the log tail", async () => {
    const executor = new FakeExecutor([ok(), ok("line1\nline2\n")]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.status(RUN_ID);
    const probe = buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG, 50);
    expect(executor.calls).toEqual([probe.hasSession, probe.tailLog]);
    expect(result).toEqual({ runId: RUN_ID, status: "running", logTail: "line1\nline2\n" });
  });

  it("maps tmux has-session exit 1 + 'no session'-style stderr to finished", async () => {
    const executor = new FakeExecutor([
      { code: 1, stdout: "", stderr: "can't find session fab-train-run-001: no such session" },
      ok("training complete\n"),
    ]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    const result = await dispatcher.status(RUN_ID);
    expect(result.status).toBe("finished");
    expect(result.logTail).toBe("training complete\n");
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

  it("passes a custom tailLines through to the probe", async () => {
    const executor = new FakeExecutor([ok(), ok()]);
    const dispatcher = new Dispatcher(executor, DEFAULT_DISPATCH_CONFIG);
    await dispatcher.status(RUN_ID, 10);
    expect(executor.calls[1]).toEqual(buildStatusProbe(RUN_ID, DEFAULT_DISPATCH_CONFIG, 10).tailLog);
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
    const args = parseArgs(["launch", "--run-id", "run-001", "--host", "other-host", "--", "python3", "train.py", "--epochs", "3"]);
    expect(args.command).toBe("launch");
    expect(args.trainArgv).toEqual(["python3", "train.py", "--epochs", "3"]);
    expect(args.config.host).toBe("other-host");
    expect(args.config.remoteBase).toBe(DEFAULT_DISPATCH_CONFIG.remoteBase);
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
