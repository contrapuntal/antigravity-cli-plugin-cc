# Antigravity plugin for Claude Code

Run Antigravity from inside Claude Code for code reviews and delegated tasks.

This plugin lets Claude Code users reach Antigravity without leaving their workflow. It adapts [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) to the Antigravity CLI (`agy`) runtime model.

> [!IMPORTANT]
> **This wraps the Antigravity *CLI*, not the Antigravity IDE.** "Antigravity" names several Google products. This plugin drives `agy`, the standalone command-line binary — it does not connect to or control the Antigravity app or the Antigravity IDE, which have no programmatic interface. Having the GUI installed is neither sufficient (you still need `agy` on your PATH) nor required (the CLI works on its own).

## What You Get

- `/ask-antigravity:review` — read-only Antigravity review
- `/ask-antigravity:adversarial-review` — steerable challenge review
- `/ask-antigravity:rescue` — delegate tasks to Antigravity through the `ask-antigravity:antigravity-rescue` subagent
- `/ask-antigravity:setup` — verify the local Antigravity CLI is installed and authenticated

## Prerequisites

You need a working Antigravity CLI on your machine **before** installing this plugin. The plugin is a thin adapter — it wraps `agy`, it doesn't replace it.

1. **Install Antigravity CLI**

   ```bash
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   # or
   brew install --cask antigravity-cli
   ```

   (Antigravity is not distributed via npm.) Version **1.0.7 or later** is required — check with `agy --version`, and re-run the installer to upgrade an older install.

2. **Authenticate**

   Run `agy` interactively once and sign in with your Google account, or set `ANTIGRAVITY_API_KEY` in your environment.

   ```bash
   agy
   # complete sign-in, then exit
   ```

3. **Verify agy works**

   ```bash
   agy -p "what is 2+2"
   ```

4. **Node.js 18.18 or later** on PATH — the plugin's companion script runs through `node`.

`/ask-antigravity:setup` (below) prints the install command for you if `agy` is missing, but it never runs a remote installer on your behalf — installing and signing in are always your responsibility.

## Install

Add the marketplace, install the plugin, reload:

```bash
/plugin marketplace add contrapuntal/antigravity-cli-plugin-cc
/plugin install ask-antigravity@contrapuntal
/reload-plugins
```

Then verify the plugin sees a working Antigravity:

```bash
/ask-antigravity:setup
```

After install, you should see:

- the slash commands listed below
- the `ask-antigravity:antigravity-rescue` subagent in `/agents`

## Usage

### `/ask-antigravity:review`

Runs an Antigravity review on your current work. Output is markdown organized by severity (Critical / High / Medium / Nits).

> [!NOTE]
> Multi-file reviews can take a while. Use background mode for anything larger than ~2 files.

Use it to review:

- your current uncommitted changes
- your branch against a base branch like `main`

Pass `--base <ref>` for branch review. Also supports `--wait` and `--background`. Read-only and not steerable. To challenge a specific decision or risk area, use [`/ask-antigravity:adversarial-review`](#ask-antigravityadversarial-review).

```bash
/ask-antigravity:review
/ask-antigravity:review --base main
/ask-antigravity:review --background
```

This command never edits files.

### `/ask-antigravity:adversarial-review`

A **steerable** review that challenges the chosen implementation and design. Uses the same review-target selection as `/ask-antigravity:review`.

Supports `--base <ref>`, `--wait`, `--background`, and free-form focus text after the flags.

```bash
/ask-antigravity:adversarial-review
/ask-antigravity:adversarial-review --base main challenge whether this caching design is right
/ask-antigravity:adversarial-review --background look for race conditions in the retry logic
```

This command never edits files.

### `/ask-antigravity:rescue`

Hands a task to Antigravity through the `ask-antigravity:antigravity-rescue` subagent. Read-only by default — Antigravity analyzes and proposes; Claude or you apply the change. Pass `--write` to let Antigravity edit files directly.

Use it to have Antigravity:

- analyze a large diff or codebase region (Antigravity's large context window shines here)
- give a second opinion on an approach Claude proposed
- investigate a bug or run an analysis pass

```bash
/ask-antigravity:rescue investigate why the build is failing in CI
/ask-antigravity:rescue analyze the entire src/ directory for race conditions
/ask-antigravity:rescue --write fix the failing test with the smallest safe patch
/ask-antigravity:rescue --background trace every caller of this function across the repo
```

Or just ask:

```text
Ask Antigravity to walk through the auth middleware and find anything that breaks under partial failure.
```

**Notes:**
- Read-only by default. Add `--write` to let Antigravity edit.
- Defaults to the model selected in the agy TUI (`/model`). Pass `--model "<display name>"` (a name from `agy models`, e.g. `--model "Gemini 3.5 Flash (Low)"`) to override per call.
- `--background` runs the rescue as a Claude Code background bash task; output appears in chat when Antigravity finishes.

### `/ask-antigravity:setup`

Checks whether Antigravity is installed and authenticated. If `agy` is missing, it prints the install command for you to run yourself (it does not auto-run a remote installer).

```bash
/ask-antigravity:setup
```

## How it works

The plugin drives `agy` in non-interactive print mode (`-p`). The prompt body is written to a temporary workspace directory exposed to agy via `--add-dir`, and agy is told to read and act on it, keeping the prompt off the command line so it never hits argv length limits. Because agy narrates its tool-use steps before answering, the plugin asks agy to wrap the real response in marker lines and returns only that region.

agy **1.0.7 or later** is required: older versions hang in headless print mode (no output, no exit). `/ask-antigravity:setup` and every invocation path check the version and tell you to upgrade instead of hanging.

### What can and cannot touch your files

- **Reviews** (`/ask-antigravity:review`, `/ask-antigravity:adversarial-review`) do not give agy access to your repository at all. The complete diff is inlined into the prompt, so agy is run in an isolated empty working directory and never sees your working tree. This is enforced by the plugin, not by agy.
- **Rescue** (`/ask-antigravity:rescue`) runs agy **in your repository** so it can read your code. `--write` signals write intent and passes `--dangerously-skip-permissions`.

> [!WARNING]
> **Omitting `--write` is not a sandbox.** On agy 1.1.1, nothing in the CLI prevents agy from editing files in headless print mode — we verified that omitting `--dangerously-skip-permissions`, and passing `--mode plan` or `--sandbox`, all still let agy overwrite a file when asked to. `--write` therefore expresses *intent*, and auto-approves permission prompts; it is not a capability boundary. Treat any `rescue` run as potentially write-capable: work on a clean git tree so anything agy changes shows up in `git diff` and can be reverted. If you need a hard guarantee, run rescue against a throwaway copy of the repo.

### Model selection

- All paths (`/ask-antigravity:review`, `/ask-antigravity:adversarial-review`, `/ask-antigravity:rescue`) default to the model currently selected in the agy TUI (`/model` picker). The plugin ships no hardcoded default.
- Pass `--model "<display name>"` to override per call. Valid names come from `agy models` (e.g. `Gemini 3.5 Flash (Low)`, `Claude Sonnet 4.6 (Thinking)`); they are display names with spaces, so quote them.

The plugin is **stateless** — no transcripts, no PID files, no session resume. Every invocation is a one-shot agy call. This matches agy's actual non-interactive shape and keeps the plugin small.

### Trust model for slash command arguments

Claude Code interpolates slash command arguments (`$ARGUMENTS`) into a Bash command string before passing them to the companion script. This is the standard Claude Code idiom (codex-plugin-cc and other official plugins use the identical pattern). It means **your shell interprets shell metacharacters in slash args** — `/ask-antigravity:rescue $(echo hi)` expands the command substitution before reaching the plugin. The threat model assumes you typed the slash command yourself; treat it with the care you'd apply to any command you run directly in your terminal.

## What's not included (and why)

These pieces from codex-plugin-cc are deliberately left out of v1:

| Codex feature | Why dropped |
|---------------|-------------|
| `/codex:status`, `/codex:result`, `/codex:cancel` | agy has no app-server / job-control protocol. Claude Code's native `run_in_background: true` handles backgrounding. |
| `--resume` / `--fresh` | agy's non-interactive mode has no session-resume RPC. The interactive TUI is available for users who need it. |
| Stop-hook review gate | Footgun (cost, loops). May arrive in v1.x once the core flow is validated. |
| JSON-schema review output | agy's plain-text print mode makes JSON parsing brittle. Markdown sections degrade gracefully. |

For the full rationale, see `docs/plans/2026-04-26-gemini-plugin-cc-design.md`.

## Use from other coding agents (Codex CLI, OpenCode, Pi.dev, Copilot CLI)

The plugin's *Claude Code packaging* (`commands/*.md` + `agents/*.md`) drives the slash-command UX and will not load in other agents. For everything else, this repo ships:

- `skills/antigravity-helper/SKILL.md` — Anthropic Skill format, discoverable by Codex CLI, OpenCode, Pi.dev, and Copilot CLI's skill loader
- `.plugin/plugin.json` — Copilot CLI's expected manifest at the repo root, pointing at the same `./skills/`

You lose the slash-command UX in these agents, but the capability remains reachable as a model-invoked skill.

### Copilot CLI

```bash
copilot plugin install contrapuntal/antigravity-cli-plugin-cc
```

This installs the `antigravity-helper` skill (declared in `.plugin/plugin.json`), which is the Copilot surface — invoke it by describing the review or delegation task. The `antigravity-rescue` subagent is a Claude Code plugin component and is not loaded by Copilot; under Copilot, use the skill instead.

### Codex CLI, OpenCode, Pi.dev — symlink install

```bash
# Set this once per shell (or in your shell rc).
# ANTIGRAVITY_CLI_PLUGIN_CC_ROOT lets the skill find the companion script.
export ANTIGRAVITY_CLI_PLUGIN_CC_ROOT="$(pwd)"

# If agy hasn't been interactively trusted in your working dir, trust the
# workspace in agy (it records trustedWorkspaces in its settings.json).

# OpenCode
ln -s "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/skills/antigravity-helper" ~/.config/opencode/skills/antigravity-helper

# Codex CLI
ln -s "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/skills/antigravity-helper" ~/.codex/skills/antigravity-helper

# Pi.dev (consult its package docs for the right skills directory; or distribute as an npm package)
```

When invoking the host agent, prefer non-interactive modes that auto-approve shell commands (Pi: `--print`, OpenCode: `opencode run`, Codex CLI: `codex exec -s workspace-write`, Copilot CLI: `copilot --allow-all-tools -p "..."`). For Codex CLI with Antigravity OAuth, also grant the sandbox network access and write access to agy's credential directory so headless OAuth-token rotation can complete:

```bash
codex exec -s workspace-write \
  -c 'sandbox_workspace_write.writable_roots=["/Users/<you>/.gemini"]' \
  -c 'sandbox_workspace_write.network_access=true' \
  --skip-git-repo-check \
  "your prompt"
```

(`~/.gemini/antigravity-cli/` is agy's real config directory — that path is intentional, not a leftover.) Without both, Codex's sandbox blocks agy's token refresh and the call falls back to interactive browser auth, which surfaces misleadingly as a user cancellation.

Once linked, the agent's model loads the skill on demand based on its description. Prerequisites match Claude Code: `agy` CLI installed and authenticated, `node` 18.18+ on PATH.


## Testing

```bash
npm test
```

Runs unit tests against arg parsing, prompt assembly, git helpers, rendering, process spawning, and an end-to-end companion run against a fake `agy` binary. Tests never invoke the real `agy`.

```bash
AGY_LIVE=1 node --test tests/live.test.mjs
```

Runs live smoke tests against the **real** agy (spends model calls; needs an installed, authenticated agy). Run this after every agy upgrade — it verifies the upstream behaviors the plugin's design depends on: headless `-p` answering without a TTY, print-mode `--model`, and marker-wrapped output extraction.

## License

Apache-2.0. Adapted from codex-plugin-cc (also Apache-2.0); see `NOTICE`.
