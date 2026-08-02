#!/usr/bin/env tsx
/**
 * Thin CLI over Dispatcher (#208): push/launch/status/pull subcommands for
 * driving E2 training runs on storm590x. Wires a real child_process-based
 * RemoteExecutor (argv spawn, shell:false — never a shell string built
 * from user input). This file's real-machine behavior is not
 * unit-tested; parseArgs is pure and covered in test/dispatch.test.ts.
 *
 * Usage:
 *   tsx src/dispatch/cli.ts push   --run-id <id> [config flags] -- <localPath...>
 *   tsx src/dispatch/cli.ts launch --run-id <id> [config flags] -- <trainCmd...>
 *   tsx src/dispatch/cli.ts status --run-id <id> [config flags] [--tail-lines N]
 *   tsx src/dispatch/cli.ts pull   --run-id <id> [config flags] [--remote-artifact-dir DIR] [--local-dest PATH]
 *
 * Config flags (override DEFAULT_DISPATCH_CONFIG, apply to any subcommand):
 *   --host <alias> --remote-base <path>
 *   --nvidia-smi-path <path> --session-prefix <prefix>
 *
 * No --python-path flag: nothing here invokes python directly — put the
 * full remote interpreter path (e.g. ~/.venv/bin/python3) as the first
 * element of the trainArgv passed to `launch`.
 */
import { spawn } from "node:child_process";
import { Dispatcher } from "./dispatcher.js";
import { DEFAULT_DISPATCH_CONFIG } from "./types.js";
import type { DispatchConfig, RemoteExecutor, ExecResult } from "./types.js";

const COMMANDS = ["push", "launch", "status", "pull"] as const;
type Command = (typeof COMMANDS)[number];

export interface CliArgs {
  command: Command;
  runId: string;
  config: DispatchConfig;
  localPaths: string[];
  trainArgv: string[];
  remoteArtifactDir: string;
  localDest: string;
  tailLines: number;
}

function isCommand(value: string | undefined): value is Command {
  return !!value && (COMMANDS as readonly string[]).includes(value);
}

export function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (!isCommand(command)) {
    throw new Error(`unknown dispatch command: "${command ?? ""}" (expected one of: ${COMMANDS.join("|")})`);
  }

  const config: DispatchConfig = { ...DEFAULT_DISPATCH_CONFIG };
  const args: CliArgs = {
    command,
    runId: "",
    config,
    localPaths: [],
    trainArgv: [],
    remoteArtifactDir: "artifacts",
    localDest: "./out/artifacts",
    tailLines: 50,
  };

  const trailing: string[] = [];
  let sawDashDash = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--") {
      sawDashDash = true;
      continue;
    }
    if (sawDashDash) {
      trailing.push(arg);
      continue;
    }
    if (arg === "--run-id" && rest[i + 1]) args.runId = rest[++i];
    else if (arg === "--host" && rest[i + 1]) config.host = rest[++i];
    else if (arg === "--remote-base" && rest[i + 1]) config.remoteBase = rest[++i];
    else if (arg === "--nvidia-smi-path" && rest[i + 1]) config.nvidiaSmiPath = rest[++i];
    else if (arg === "--session-prefix" && rest[i + 1]) config.tmuxSessionPrefix = rest[++i];
    else if (arg === "--tail-lines" && rest[i + 1]) args.tailLines = Number(rest[++i]);
    else if (arg === "--remote-artifact-dir" && rest[i + 1]) args.remoteArtifactDir = rest[++i];
    else if (arg === "--local-dest" && rest[i + 1]) args.localDest = rest[++i];
  }

  if (command === "push") args.localPaths = trailing;
  if (command === "launch") args.trainArgv = trailing;
  if (!args.runId) throw new Error("--run-id is required");

  return args;
}

/** Real executor: spawns argv directly (shell:false) — never builds a shell string from external input. */
class ChildProcessExecutor implements RemoteExecutor {
  run(cmd: string[]): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const [bin, ...cmdArgs] = cmd;
      const child = spawn(bin, cmdArgs, { shell: false });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dispatcher = new Dispatcher(new ChildProcessExecutor(), args.config);

  switch (args.command) {
    case "push": {
      const result = await dispatcher.push(args.runId, args.localPaths);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "launch": {
      const result = await dispatcher.launch(args.runId, args.trainArgv);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "status": {
      const result = await dispatcher.status(args.runId, args.tailLines);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "pull": {
      const result = await dispatcher.pullArtifacts(args.runId, args.remoteArtifactDir, args.localDest);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
  }
}

// Guarded so importing this module (e.g. from tests, for parseArgs) never
// triggers a real ssh/rsync run as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
