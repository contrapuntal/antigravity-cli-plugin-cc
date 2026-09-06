#!/usr/bin/env node
// antigravity-cli-plugin-cc companion script.
// Single dispatcher for the antigravity plugin's four subcommands.

import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  splitRawArgumentString,
  resolveModelAlias,
  DEFAULT_REVIEW_MODEL
} from "./lib/args.mjs";
import { resolveReviewTarget, collectReviewContext } from "./lib/git.mjs";
import {
  detectAntigravity,
  detectAuth,
  probeAntigravity,
  invokeAntigravity,
  isSupportedVersion,
  installHint,
  MIN_AGY_VERSION
} from "./lib/agy.mjs";
import { invokeStaticReview, MIN_REVIEW_AGY_VERSION } from "./lib/static-review.mjs";
import { buildReviewPrompt, buildAdversarialPrompt } from "./lib/prompts.mjs";
import {
  renderSetupText,
  renderSetupJson,
  renderReviewHeader,
  renderError
} from "./lib/render.mjs";

// Top-level argv shape:
//   antigravity-companion.mjs <subcommand> [args...]
// For review/adversarial-review/task we receive a single quoted string from
// $ARGUMENTS; we split it ourselves for predictable behavior.

const SUBCOMMANDS = new Set(["setup", "review", "adversarial-review", "task"]);

async function main() {
  const [, , rawSubcommand, ...rest] = process.argv;
  const subcommand = rawSubcommand ?? "";

  if (!SUBCOMMANDS.has(subcommand)) {
    process.stderr.write(
      `Unknown subcommand: ${subcommand || "(none)"}\n` +
        `Usage: antigravity-companion.mjs <setup|review|adversarial-review|task> [args]\n`
    );
    process.exit(2);
  }

  const argv = normalizeArgv(rest);

  try {
    switch (subcommand) {
      case "setup":
        return await runSetup(argv);
      case "review":
        return await runReview(argv, { mode: "review" });
      case "adversarial-review":
        return await runReview(argv, { mode: "adversarial-review" });
      case "task":
        return await runTask(argv);
    }
  } catch (error) {
    process.stdout.write(renderError(error) + "\n");
    process.exit(1);
  }
}

// Claude Code passes "$ARGUMENTS" as a single quoted token. Always run the
// tokenizer on a single-element argv: it handles already-split tokens
// idempotently (`refactor` → `["refactor"]`) and also strips literal quote
// characters that the shell preserved (`"refactor"` → `["refactor"]`).
export function normalizeArgv(rest) {
  if (rest.length === 1) {
    return splitRawArgumentString(rest[0]);
  }
  return rest;
}

async function runSetup(rest) {
  const { options } = parseArgs(rest, {
    booleanOptions: ["json", "live"]
  });

  const state = {
    antigravity: detectAntigravity(),
    auth: { authenticated: false },
    installHint: installHint()
  };
  if (state.antigravity.installed) {
    state.auth = detectAuth();
  }

  if (options.live) {
    const { status, ...live } = state.antigravity.installed && state.antigravity.supported
      ? await probeAntigravity()
      : { ok: false, status: 1, detail: "Install a supported agy version before running setup --live." };
    state.live = live;
    if (!live.ok) process.exitCode = status || 1;
  }

  const output = options.json ? renderSetupJson(state) : renderSetupText(state);
  process.stdout.write(output + "\n");
}

// Gate every invocation path on an installed, version-supported agy. Returns
// false (after printing guidance) when invoking would fail or hang.
function agyUsable({ review = false } = {}) {
  const agyState = detectAntigravity();
  if (!agyState.installed) {
    process.stdout.write(
      "Antigravity CLI (agy) is not installed. Run the companion setup command for installation guidance.\n"
    );
    process.exitCode = 1;
    return false;
  }
  if (!agyState.supported) {
    process.stdout.write(
      `Antigravity CLI ${agyState.version} is older than the minimum supported ` +
        `${MIN_AGY_VERSION} (headless print mode hangs on older versions). ` +
        `Please upgrade agy — re-run the installer or 'brew upgrade antigravity-cli' — and retry.\n`
    );
    process.exitCode = 1;
    return false;
  }
  if (review && !isSupportedVersion(agyState.version, MIN_REVIEW_AGY_VERSION)) {
    process.stderr.write(`Static reviews require agy >= ${MIN_REVIEW_AGY_VERSION} for stream-json stdin. Please upgrade agy.\n`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

async function runReview(rest, { mode }) {
  const { options, positionals } = parseArgs(rest, {
    valueOptions: ["base", "model"],
    booleanOptions: ["wait", "background"]
  });

  if (!agyUsable({ review: true })) {
    return;
  }

  const cwd = process.cwd();
  const target = resolveReviewTarget(cwd, { base: options.base });
  const context = collectReviewContext(cwd, target);

  if (context.isEmpty) {
    process.stdout.write(`No changes to review for ${target.label}.\n`);
    return;
  }

  const userFocus = positionals.join(" ").trim();
  const prompt =
    mode === "adversarial-review"
      ? buildAdversarialPrompt({
          targetLabel: target.label,
          userFocus,
          summary: context.summary,
          content: context.content
        })
      : buildReviewPrompt({
          targetLabel: target.label,
          summary: context.summary,
          content: context.content
        });

  process.stdout.write(renderReviewHeader({ summary: context.summary, target, mode }));

  const model = resolveModelAlias(options.model) ?? DEFAULT_REVIEW_MODEL;
  // Supply the entire review through stdin; host policy enforces filesystem access.
  const result = await invokeStaticReview({ prompt, model });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

async function runTask(rest) {
  const { options, positionals } = parseArgs(rest, {
    valueOptions: ["model", "prompt-file"],
    booleanOptions: ["write", "wait", "background"]
  });

  if (!agyUsable()) {
    return;
  }

  // Prefer --prompt-file when given: the caller (slash command / subagent) writes
  // the free-form task text to a file with a structured tool, so it never rides
  // on a shell command line where $(...)/backticks would execute. Falls back to
  // positional text for direct CLI use.
  let taskText;
  if (options["prompt-file"]) {
    try {
      taskText = fs.readFileSync(options["prompt-file"], "utf8").trim();
    } catch (error) {
      process.stdout.write(`Could not read --prompt-file: ${error.message}\n`);
      process.exit(2);
    }
  } else {
    taskText = positionals.join(" ").trim();
  }
  if (!taskText) {
    process.stdout.write("No task provided. Pass the task description as text.\n");
    process.exit(2);
  }

  const cwd = process.cwd();
  const model = resolveModelAlias(options.model);
  const result = await invokeAntigravity({
    prompt: taskText,
    model,
    write: Boolean(options.write),
    cwd
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

// Only run main() when this file is the entry point. Without this guard,
// importing it from tests or other tooling re-runs the CLI dispatcher and
// exits the host process before the import completes.
// macOS temp/cache paths can be reached through /var -> /private/var aliases.
// Node resolves the module URL; compare canonical paths rather than spellings.
const invokedAsCli = process.argv[1] && fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedAsCli) {
  main().catch((error) => {
    process.stdout.write(renderError(error) + "\n");
    process.exit(1);
  });
}
