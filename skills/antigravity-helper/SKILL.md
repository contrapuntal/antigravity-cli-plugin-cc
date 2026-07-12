---
name: antigravity-helper
description: Use when the user wants to invoke Antigravity CLI for a code review of uncommitted changes or a branch diff, an adversarial design-challenge review, or to delegate a coding task to Antigravity for a second opinion or large-context analysis. Wraps the antigravity-cli-plugin-cc companion script.
license: Apache-2.0
compatibility: claude-code, opencode, codex, pi
metadata:
  origin: antigravity-cli-plugin-cc
---

# antigravity-helper

This skill lets any Anthropic-Skill-aware agent (Codex CLI, OpenCode, Pi.dev, plus Claude Code via `.claude/skills/`) delegate to the Antigravity CLI (`agy`) for code review and task analysis. It wraps the `antigravity-cli-plugin-cc` companion script — a stateless Node.js dispatcher that assembles the prompt, writes it to a temp workspace directory, applies read-only or write-capable execution, runs `agy` in print mode, and extracts the marker-wrapped response so agy's tool-use narration never reaches the user.

> If you are running inside Claude Code, prefer the slash-command surface (`/ask-antigravity:review`, `/ask-antigravity:adversarial-review`, `/ask-antigravity:rescue`, `/ask-antigravity:setup`) provided by the antigravity-cli-plugin-cc plugin. This skill is the portable fallback for agents without that plugin format.

## Prerequisites

- **`agy` CLI 1.0.7 or later, installed and authenticated.** Install with `curl -fsSL https://antigravity.google/cli/install.sh | bash` or `brew install --cask antigravity-cli` (agy is not distributed via npm). Older agy hangs in headless print mode; the companion refuses to invoke it and asks for an upgrade. Sign in by running `agy` interactively and completing Google sign-in, or set `ANTIGRAVITY_API_KEY` in the environment.
- **`node` 18.18 or later** on PATH.
- **`ANTIGRAVITY_CLI_PLUGIN_CC_ROOT` env var** pointing at the absolute path of the cloned `antigravity-cli-plugin-cc` repository. If that variable is unset, ask the user for the path before running the companion.
- **Workspace trust.** If `agy` has not been interactively trusted in the directory you invoke it from, trust the workspace in agy (it records `trustedWorkspaces` in its `settings.json`). Without trust, headless `agy` may refuse to proceed.

## When to invoke this skill

Trigger on requests that match any of:

- "review my changes / diff / branch with Antigravity"
- "challenge this design choice / pressure-test this implementation"
- "ask Antigravity to investigate / analyze / fix X"
- "give me a second opinion on…" (especially when the question benefits from a large-context single pass)

Do **not** trigger when the user only wants Claude's own review or when the task is small enough that delegation adds latency without value.

## Invocations

All commands assume the working directory is the repo being reviewed/analyzed.

### Code review (read-only, structured markdown output)

```bash
node "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/plugins/ask-antigravity/scripts/antigravity-companion.mjs" review

node "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/plugins/ask-antigravity/scripts/antigravity-companion.mjs" review --base main
```

The output is markdown with a fixed skeleton: `## Summary` then `### Critical / High / Medium / Nits` sections. Stream it back to the user verbatim.

### Adversarial review (read-only, steerable, accepts focus text)

```bash
node "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/plugins/ask-antigravity/scripts/antigravity-companion.mjs" adversarial-review "look for race conditions in the retry path"
```

Same output shape; framing is "find reasons this should not ship" rather than general review.

### Delegate a task / second opinion

```bash
# Default: Antigravity analyzes and proposes. NOTE: this is not a sandbox — agy may
# still edit files (see "Not a guaranteed sandbox" below). Run on a clean git tree.
node "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/plugins/ask-antigravity/scripts/antigravity-companion.mjs" task "investigate why the build is failing in CI"

# Write intent: passes --dangerously-skip-permissions so agy won't stall on prompts.
node "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/plugins/ask-antigravity/scripts/antigravity-companion.mjs" task --write "fix the failing test with the smallest safe patch"
```

Prefer `--prompt-file <path>` over inline text when the task text is untrusted or contains shell metacharacters: it carries the text as data instead of on a shell command line.

### Setup probe (verify install + auth)

```bash
node "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/plugins/ask-antigravity/scripts/antigravity-companion.mjs" setup
node "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/plugins/ask-antigravity/scripts/antigravity-companion.mjs" setup --json
```

> Note for Codex CLI users with Antigravity OAuth (not `ANTIGRAVITY_API_KEY`): the live review call may stall on an interactive browser auth prompt even though the setup probe reports `authenticated: true`. Two sandbox restrictions cause this — Codex's `workspace-write` mode (1) blocks outbound network, so agy's OAuth-token refresh HTTP request fails, and (2) blocks writes outside the workspace, so agy cannot persist the rotated token to its config under `~/.gemini/antigravity-cli/`. Either failure makes agy fall back to interactive browser auth, which Codex's process isolation cannot complete. **Both** must be granted:
>
> ```bash
> codex exec -s workspace-write \
>   -c 'sandbox_workspace_write.writable_roots=["/Users/<you>/.gemini"]' \
>   -c 'sandbox_workspace_write.network_access=true' \
>   --skip-git-repo-check \
>   "your prompt that triggers antigravity-helper"
> ```
>
> The misleading part: the error reads like a user cancellation. The user did not cancel; the sandbox blocked the refresh. (Note: `~/.gemini/antigravity-cli/` is agy's real config directory — that path is not a typo.)

If the result reports `installed: false`, suggest installing agy with `curl -fsSL https://antigravity.google/cli/install.sh | bash` or `brew install --cask antigravity-cli`. If `authenticated: false`, suggest running `agy` interactively to sign in.

## Model selection

Reviews and rescue runs default to the model currently selected in the agy TUI (`/model` picker). Pass `--model "<display name>"` to any subcommand to override per call — valid names come from `agy models` (e.g. `Gemini 3.5 Flash (Low)`); they contain spaces, so quote them.

## Backgrounding

For large reviews (multi-file diffs, branch reviews, or long rescue tasks), run the companion in the host agent's background-bash facility (`run_in_background: true` for Claude Code, equivalent for other agents). The companion script itself is stateless and synchronous — it does not manage background jobs.

## What this skill is NOT

- **Not a slash-command surface.** Skills are model-invoked; for `/ask-antigravity:review`-style UX, install the antigravity-cli-plugin-cc *plugin* into Claude Code instead.
- **Not stateful.** No transcripts, no session resume, no PID tracking. Every invocation is a fresh one-shot agy call.
- **Not a guaranteed sandbox.** `review` and `adversarial-review` are safe by construction: the whole diff is inlined into the prompt and agy is run in an isolated empty working directory, so it never sees the repo. But `task` runs agy **in the repo**, and omitting `--write` does *not* stop it from editing files — on agy 1.1.1 no CLI flag does (verified: omitting `--dangerously-skip-permissions`, `--mode plan`, and `--sandbox` all still wrote). `--write` signals intent and auto-approves prompts; it is not a capability boundary. Run `task` on a clean git tree so any change is visible in `git diff`.

## Reference

- Source: antigravity-cli-plugin-cc repository, `plugins/ask-antigravity/scripts/antigravity-companion.mjs`
- License: Apache-2.0
- Test suite: `node --test tests/*.test.mjs` from the repo root (covering arg parsing, prompt assembly, git context collection, prompt-injection sanitization, symlink-exfiltration prevention, output capture/timeout handling, process-signal handling, and an end-to-end companion run against a fake `agy`). `AGY_LIVE=1 node --test tests/live.test.mjs` smoke-tests the real agy after upgrades.
