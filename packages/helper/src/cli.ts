import { Effect, type FileSystem, type Path } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

import { fileFailure } from "./commands/common.ts";
import { indexInit } from "./commands/index/init.ts";
import { indexLint } from "./commands/index/lint.ts";
import { indexStamp } from "./commands/index/stamp.ts";
import { installClaudeCode } from "./commands/install/claude-code.ts";
import { installCodex } from "./commands/install/codex.ts";
import { installDeepSeek } from "./commands/install/deepseek.ts";
import { installKiro } from "./commands/install/kiro.ts";
import { installOpenCodeV2 } from "./commands/install/opencode-v2.ts";
import { installPi } from "./commands/install/pi.ts";
import { memoryCheck } from "./commands/memory/check.ts";
import { preamble } from "./commands/preamble.ts";
import { projectInit } from "./commands/project/init.ts";
import { projectStatus } from "./commands/project/status.ts";
import { recallCrossForget, recallCrossIndex } from "./commands/recall-cross/index.ts";
import { recallCrossQuery, recallCrossRecall } from "./commands/recall-cross/query.ts";
import { upgrade } from "./commands/upgrade.ts";
import { userInit } from "./commands/user/init.ts";
import { userStatus } from "./commands/user/status.ts";
import { version } from "./commands/version.ts";
import type { GitRunner } from "./git.ts";
import type { NpmRegistry } from "./npm-registry.ts";
import { renderTable } from "./output.ts";
import type { CliContext, CliResult } from "./utils.ts";

const HELP = `VCC Brain Helper

USER COMMANDS

${renderTable([
  ["help", "Show help for vcc-brain-helper"],
  ["version", "Show the installed version and check for updates"],
  ["upgrade", "Update VCC Brain Helper to the latest release"],
  ["install codex", "Install or update the Codex plugin"],
  ["install opencode", "Install or update the OpenCode plugin"],
  ["install deepseek", "Install or update the DeepSeek Harness plugin"],
  ["install pi", "Install or update the Pi plugin"],
  ["install claude-code", "Install or update the Claude Code plugin"],
  ["install kiro", "Install or update the Kiro adapter"],
])}

AGENT COMMANDS

${renderTable([
  ["user status", "Show User Partition status"],
  ["user init", "Initialize User Partition and print the setup guide"],
  ["project status", "Show Project Private, Shared, Git ignore, and tracking status"],
  ["project init", "Initialize project partitions and print the setup guide"],
  ["index init", "Show Project Index status and print the setup guide"],
  ["index lint", "Check Project Index structure and frontmatter"],
  ["index stamp", "Stamp Project Index with the current tree hash"],
  ["memory check", "Check that all VCC Brain memory can be loaded"],
  ["recall-cross index", "Sync the cross-session recall index"],
  ["recall-cross forget", "Forget a session from the recall index"],
  ["recall-cross query", "Search past sessions for keywords"],
  ["recall-cross recall", "Restore a past session's turns"],
  ["preamble", "Render the VCC Brain preamble"],
])}`;

export function runCli(
  arguments_: ReadonlyArray<string>,
  context: CliContext,
): Effect.Effect<
  CliResult,
  never,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | GitRunner.Service
  | NpmRegistry.Service
  | Path.Path
> {
  return Effect.gen(function* () {
    if (arguments_.length === 1 && arguments_[0] === "help") {
      return { exitCode: 0, output: HELP };
    }
    if (arguments_.length === 1 && arguments_[0] === "version") {
      return yield* version(context);
    }
    if (arguments_.length === 1 && arguments_[0] === "preamble") {
      return yield* preamble(context);
    }
    if (arguments_.length === 1 && arguments_[0] === "upgrade") {
      return yield* upgrade(context);
    }
    if (arguments_[0] === "recall-cross") {
      if (arguments_[1] === "index") {
        const rootFlag = arguments_.indexOf("--root");
        if (
          rootFlag >= 0
          && (arguments_[rootFlag + 1] === undefined
            || (arguments_[rootFlag + 1] as string).startsWith("--"))
        ) {
          return { exitCode: 2, output: "Usage: recall-cross index [--root <path>]" };
        }
        const root =
          rootFlag >= 0 ? ((arguments_[rootFlag + 1] as string | undefined) ?? null) : null;
        const positional = arguments_.filter(
          (argument, at) =>
            at > 1
            && argument !== "--root"
            && (rootFlag < 0 || (at !== rootFlag && at !== rootFlag + 1)),
        );
        if (positional.length > 0) {
          return { exitCode: 2, output: "Usage: recall-cross index [--root <path>]" };
        }
        return yield* recallCrossIndex(context, root, Date.now());
      }
      if (arguments_[1] === "forget") {
        const harnessFlag = arguments_.indexOf("--harness");
        if (
          harnessFlag >= 0
          && (arguments_[harnessFlag + 1] === undefined
            || (arguments_[harnessFlag + 1] as string).startsWith("--"))
        ) {
          return {
            exitCode: 2,
            output: "Usage: recall-cross forget [--harness dsh|opencode] <session-id>",
          };
        }
        const harness =
          harnessFlag >= 0 ? (arguments_[harnessFlag + 1] as string | undefined) : undefined;
        const positional = arguments_.filter(
          (argument, at) =>
            at > 1
            && argument !== "--harness"
            && (harnessFlag < 0 || (at !== harnessFlag && at !== harnessFlag + 1)),
        );
        const id = positional[0];
        if (id === undefined || positional.length > 1) {
          return {
            exitCode: 2,
            output: "Usage: recall-cross forget [--harness dsh|opencode] <session-id>",
          };
        }
        return yield* recallCrossForget(context, id, harness, Date.now());
      }
      if (arguments_[1] === "query") {
        const harnessFlag = arguments_.indexOf("--harness");
        if (
          harnessFlag >= 0
          && (arguments_[harnessFlag + 1] === undefined
            || (arguments_[harnessFlag + 1] as string).startsWith("--"))
        ) {
          return {
            exitCode: 2,
            output: "Usage: recall-cross query [--harness dsh|opencode|all] <keywords>",
          };
        }
        const harness =
          harnessFlag >= 0 ? (arguments_[harnessFlag + 1] as string | undefined) : undefined;
        const rootFlag = arguments_.indexOf("--root");
        if (
          rootFlag >= 0
          && (arguments_[rootFlag + 1] === undefined
            || (arguments_[rootFlag + 1] as string).startsWith("--"))
        ) {
          return {
            exitCode: 2,
            output:
              "Usage: recall-cross query [--harness dsh|opencode|all] [--root <path>] <keywords>",
          };
        }
        const root =
          rootFlag >= 0 ? ((arguments_[rootFlag + 1] as string | undefined) ?? null) : null;
        const projectFlag = arguments_.indexOf("--project");
        if (
          projectFlag >= 0
          && (arguments_[projectFlag + 1] === undefined
            || (arguments_[projectFlag + 1] as string).startsWith("--"))
        ) {
          return {
            exitCode: 2,
            output:
              "Usage: recall-cross query [--harness dsh|opencode|all] [--project <name>] <keywords>",
          };
        }
        const project =
          projectFlag >= 0 ? (arguments_[projectFlag + 1] as string | undefined) : undefined;
        const projectDirFlag = arguments_.indexOf("--project-dir");
        if (
          projectDirFlag >= 0
          && (arguments_[projectDirFlag + 1] === undefined
            || (arguments_[projectDirFlag + 1] as string).startsWith("--"))
        ) {
          return {
            exitCode: 2,
            output:
              "Usage: recall-cross query [--harness dsh|opencode|all] [--project <name>] [--project-dir <path>] <keywords>",
          };
        }
        const projectDir =
          projectDirFlag >= 0
            ? ((arguments_[projectDirFlag + 1] as string | undefined) ?? null)
            : null;
        const topFlag = arguments_.indexOf("--top");
        if (
          topFlag >= 0
          && (arguments_[topFlag + 1] === undefined
            || (arguments_[topFlag + 1] as string).startsWith("--"))
        ) {
          return {
            exitCode: 2,
            output: "Usage: recall-cross query [--top <n>] <keywords>",
          };
        }
        let topN: number | undefined;
        if (topFlag >= 0) {
          const parsed = Number.parseInt(arguments_[topFlag + 1] as string, 10);
          if (!Number.isInteger(parsed) || parsed <= 0) {
            return {
              exitCode: 2,
              output: "Usage: recall-cross query [--top <n>] <keywords>",
            };
          }
          topN = parsed;
        }
        const peers: string[] = [];
        for (let at = 0; at < arguments_.length; at += 1) {
          if (arguments_[at] === "--peer") {
            const value = arguments_[at + 1];
            if (value === undefined || (value as string).startsWith("--")) {
              return {
                exitCode: 2,
                output: "Usage: recall-cross query [--peer <name>] <keywords>",
              };
            }
            peers.push(value as string);
          }
        }
        const keywords = arguments_.filter(
          (argument, at) =>
            at > 1
            && argument !== "--harness"
            && argument !== "--root"
            && argument !== "--project"
            && argument !== "--project-dir"
            && argument !== "--peer"
            && argument !== "--top"
            && (harnessFlag < 0 || (at !== harnessFlag && at !== harnessFlag + 1))
            && (rootFlag < 0 || (at !== rootFlag && at !== rootFlag + 1))
            && (projectFlag < 0 || (at !== projectFlag && at !== projectFlag + 1))
            && (projectDirFlag < 0 || (at !== projectDirFlag && at !== projectDirFlag + 1))
            && (topFlag < 0 || (at !== topFlag && at !== topFlag + 1))
            && (at === 0 || arguments_[at - 1] !== "--peer"),
        );
        return yield* recallCrossQuery(context, keywords, {
          harness,
          project,
          peers,
          root,
          topN,
          projectDir,
          now: Date.now(),
        });
      }
      if (arguments_[1] === "recall") {
        const seqFlag = arguments_.indexOf("--seq");
        if (
          seqFlag >= 0
          && (arguments_[seqFlag + 1] === undefined
            || (arguments_[seqFlag + 1] as string).startsWith("--"))
        ) {
          return { exitCode: 2, output: "Usage: recall-cross recall <session-id> [--seq N]" };
        }
        let seq: number | null = null;
        if (seqFlag >= 0) {
          const parsed = Number.parseInt(arguments_[seqFlag + 1] as string, 10);
          if (!Number.isInteger(parsed) || parsed < 0) {
            return { exitCode: 2, output: "Usage: recall-cross recall <session-id> [--seq N]" };
          }
          seq = parsed;
        }
        const rootFlag = arguments_.indexOf("--root");
        if (
          rootFlag >= 0
          && (arguments_[rootFlag + 1] === undefined
            || (arguments_[rootFlag + 1] as string).startsWith("--"))
        ) {
          return {
            exitCode: 2,
            output: "Usage: recall-cross recall <session-id> [--root <path>] [--seq N]",
          };
        }
        const root =
          rootFlag >= 0 ? ((arguments_[rootFlag + 1] as string | undefined) ?? null) : null;
        const positional = arguments_.filter(
          (argument, at) =>
            at > 1
            && argument !== "--seq"
            && argument !== "--root"
            && (seqFlag < 0 || (at !== seqFlag && at !== seqFlag + 1))
            && (rootFlag < 0 || (at !== rootFlag && at !== rootFlag + 1)),
        );
        const id = positional[0];
        if (id === undefined || positional.length > 1) {
          return { exitCode: 2, output: "Usage: recall-cross recall <session-id> [--seq N]" };
        }
        return yield* recallCrossRecall(context, id, seq, root, Date.now());
      }
      return {
        exitCode: 2,
        output:
          "Usage: recall-cross index [--root <path>] | recall-cross forget [--harness dsh|opencode] <session-id> | recall-cross query [--harness dsh|opencode|all] <keywords> | recall-cross recall <session-id> [--seq N]",
      };
    }
    if (arguments_.length !== 2) {
      return { exitCode: 2, output: HELP };
    }

    const command = `${arguments_[0]} ${arguments_[1]}`;
    switch (command) {
      case "user status":
        return yield* userStatus(context);
      case "user init":
        return yield* userInit(context);
      case "project status":
        return yield* projectStatus(context);
      case "project init":
        return yield* projectInit(context);
      case "index init":
      case "index status":
        return yield* indexInit(context);
      case "index lint":
        return yield* indexLint(context);
      case "index stamp":
        return yield* indexStamp(context);
      case "memory check":
        return yield* memoryCheck(context);
      case "install codex":
        return yield* installCodex(context);
      case "install claude-code":
        return yield* installClaudeCode(context);
      case "install opencode":
      case "install opencode-v2":
        return yield* installOpenCodeV2(context);
      case "install deepseek":
        return yield* installDeepSeek(context);
      case "install pi":
        return yield* installPi(context);
      case "install kiro":
        return yield* installKiro(context);
      case "user guide":
      case "project guide":
      case "index guide":
        return { exitCode: 0, output: "" };
      default:
        return {
          exitCode: 2,
          output: `Unknown command: ${command}\n\n${HELP}`,
        };
    }
  }).pipe(Effect.catch(error => Effect.succeed(fileFailure(error))));
}
