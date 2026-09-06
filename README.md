# Ask Antigravity

Run Antigravity from Claude Code, Codex, or Copilot CLI for code reviews and delegated tasks.

This plugin lets coding-agent users reach Antigravity without leaving their workflow. It adapts [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) to the Antigravity CLI (`agy`) runtime model.

> [!IMPORTANT]
> **This wraps the Antigravity *CLI*, not the Antigravity IDE.** "Antigravity" names several Google products. This plugin drives `agy`, the standalone command-line binary — it does not connect to or control the Antigravity app or the Antigravity IDE, which have no programmatic interface. Having the GUI installed is neither sufficient (you still need `agy` on your PATH) nor required (the CLI works on its own).

## Repository rename

The repository is now `contrapuntal/ask-antigravity` (formerly `contrapuntal/antigravity-cli-plugin-cc`). Existing clones can update their remote:

```bash
git remote set-url origin git@github.com:contrapuntal/ask-antigravity.git
```

The Claude Code and Codex plugin ID remains `ask-antigravity`, and the marketplace remains `contrapuntal`. The Copilot plugin keeps its existing `antigravity-cli-plugin-cc` ID for compatibility; its display name is now **Ask Antigravity**. The portable helper keeps `ANTIGRAVITY_CLI_PLUGIN_CC_ROOT`, so existing configurations continue to work. Your local checkout directory does not need to be renamed.

## Claude Code commands

- `/ask-antigravity:review` — diff-based Antigravity review
- `/ask-antigravity:adversarial-review` — steerable challenge review
- `/ask-antigravity:rescue` — delegate tasks to Antigravity through the `ask-antigravity:antigravity-rescue` subagent
- `/ask-antigravity:setup` — check installation and local authentication evidence

## Prerequisites

You need a working Antigravity CLI on your machine **before** installing this plugin. The plugin is a thin adapter — it wraps `agy`, it doesn't replace it.

1. **Install Antigravity CLI**

   ```bash
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   # or
   brew install --cask antigravity-cli
   ```

   (Antigravity is not distributed via npm.) Version **1.1.15 or later** is required for reviews (task/setup support **1.0.7+**) — check with `agy --version`, and re-run the installer to upgrade an older install.

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

## Install in Claude Code

Add the marketplace, install the plugin, reload:

```bash
/plugin marketplace add contrapuntal/ask-antigravity
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

## Install in Codex

From a clone of this repository, register its marketplace and install the plugin:

```bash
codex plugin marketplace add .
codex plugin add ask-antigravity@contrapuntal
```

Start a fresh Codex session after installation. The plugin provides four skills: `ask-antigravity:setup`, `ask-antigravity:review`, `ask-antigravity:adversarial-review`, and `ask-antigravity:rescue`. Ask naturally, for example:

```text
Use ask-antigravity:setup to check the CLI installation.
Use ask-antigravity:setup --live --json to verify connectivity.
Use ask-antigravity:review --base main to review this branch.
Use ask-antigravity:adversarial-review to challenge this caching design.
Use ask-antigravity:rescue to investigate the failing build.
Use ask-antigravity:rescue --write to fix the failing test.
```

Native Codex installation bundles the companion and resolves it relative to each installed skill. It needs no `ANTIGRAVITY_CLI_PLUGIN_CC_ROOT` variable and works from a different repository than the plugin checkout.

Codex workflows run in the foreground. `--wait` selects that behavior; `--background` is unsupported and the skill reports this before launching. Long calls keep polling their shell session until completion. Cancellation of the companion via SIGINT/SIGTERM terminates its active agy process group on Linux/macOS. Persistent job status, results, and resume commands are not included.

Ordinary setup checks local installation and authentication evidence. `setup --live` explicitly makes a minimal model call from a temporary directory and may incur usage. With `--json`, `live.ok` and `live.detail` report the live result separately from the authentication heuristic; a failed live check exits nonzero.

agy requires network access. OAuth token refresh may also need write access to `~/.gemini/antigravity-cli/`; an existing `ANTIGRAVITY_API_KEY` is inherited from the host environment. A populated configuration directory does not prove a valid session. Codex skills report denied access and respect the host approval policy; they do not change global permissions or automatically retry with broader access. Installation and interactive sign-in remain user-managed.

## Claude Code usage

### `/ask-antigravity:review`

Runs an Antigravity review on your current work. Output is markdown organized by severity (Critical / High / Medium / Nits).

> [!NOTE]
> Multi-file reviews can take a while. Use background mode for anything larger than ~2 files.

Use it to review:

- your current uncommitted changes
- your branch against a base branch like `main`

Pass `--base <ref>` for branch review. Also supports `--wait` and `--background`. Requests review without free-form focus text. To challenge a specific decision or risk area, use [`/ask-antigravity:adversarial-review`](#ask-antigravityadversarial-review).

```bash
/ask-antigravity:review
/ask-antigravity:review --base main
/ask-antigravity:review --background
```

This requests review from a temporary working directory; host filesystem policy supplies enforced restrictions.

### `/ask-antigravity:adversarial-review`

A **steerable** review that challenges the chosen implementation and design. Uses the same review-target selection as `/ask-antigravity:review`.

Supports `--base <ref>`, `--wait`, `--background`, and free-form focus text after the flags.

```bash
/ask-antigravity:adversarial-review
/ask-antigravity:adversarial-review --base main challenge whether this caching design is right
/ask-antigravity:adversarial-review --background look for race conditions in the retry logic
```

This requests review from a temporary working directory; host filesystem policy supplies enforced restrictions.

### `/ask-antigravity:rescue`

Hands a task to Antigravity through the `ask-antigravity:antigravity-rescue` subagent. Analysis intent by default — Antigravity is asked to analyze and propose; Claude or you apply the change. Pass `--write` to let Antigravity edit files directly.

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
- Analysis intent by default. Add `--write` to authorize Antigravity edits; omission does not enforce filesystem restrictions.
- Defaults to the model selected in the agy TUI (`/model`). Pass `--model "<display name>"` (a name from `agy models`, e.g. `--model "Gemini 3.5 Flash (Low)"`) to override per call.
- `--background` runs the rescue as a Claude Code background bash task; output appears in chat when Antigravity finishes.

### `/ask-antigravity:setup`

Checks installation and local authentication evidence; this does not verify a working session. If `agy` is missing, it prints the install command for you to run yourself (it does not auto-run a remote installer).

```bash
/ask-antigravity:setup
```

## How it works

Reviews use `agy --input-format stream-json --output-format stream-json` to deliver the complete prompt over stdin, with slash-command expansion disabled. Static-review instructions ask the model to use only the supplied context and avoid tools. The adapter requires one successful, nonempty final result and reports structured tool denials instead of treating empty output as success. These instructions do not disable tools or change permissions.

Task and setup calls drive `agy` in non-interactive print mode (`-p`). The prompt body is written to a temporary workspace directory exposed to agy via `--add-dir`, and agy is told to read and act on it, keeping the prompt off the command line so it never hits argv length limits. Because agy narrates its tool-use steps before answering, the plugin asks agy to wrap the real response in marker lines and returns only that region.

Reviews require agy **1.1.15+** for stream-json stdin. Task/setup require **1.0.7+**: older versions hang in headless print mode (no output, no exit). `/ask-antigravity:setup` and every invocation path check the version and tell you to upgrade instead of hanging.

### What can and cannot touch your files

- **Reviews** (`review`, `adversarial-review`) include the complete diff in the prompt and run agy in a temporary working directory. This avoids relying on repository tools for the review, but changing directories does not restrict filesystem access. The host must enforce any required filesystem boundary.
- **Rescue** (`/ask-antigravity:rescue`) runs agy **in your repository** so it can read your code. `--write` signals write intent and passes `--dangerously-skip-permissions`.

> [!WARNING]
> **Omitting `--write` is not a sandbox.** On agy 1.1.1, nothing in the CLI prevents agy from editing files in headless print mode — we verified that omitting `--dangerously-skip-permissions`, and passing `--mode plan` or `--sandbox`, all still let agy overwrite a file when asked to. `--write` therefore expresses *intent*, and auto-approves permission prompts; it is not a capability boundary. Treat any `rescue` run as potentially write-capable: work on a clean git tree so anything agy changes shows up in `git diff` and can be reverted. For enforced restrictions, use a host-provided filesystem sandbox. A throwaway checkout helps inspect changes but is not itself isolation.

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
| `/codex:status`, `/codex:result`, `/codex:cancel` | agy has no app-server / job-control protocol. Claude Code supplies backgrounding; Codex currently uses foreground calls. |
| `--resume` / `--fresh` | agy's non-interactive mode has no session-resume RPC. The interactive TUI is available for users who need it. |
| Stop-hook review gate | Footgun (cost, loops). May arrive in v1.x once the core flow is validated. |
| JSON-schema review findings | Transport uses structured events; findings remain Markdown for readability. |

For the full rationale, see `docs/plans/2026-04-26-gemini-plugin-cc-design.md`.

## Portable skill for OpenCode, Pi.dev, Copilot CLI, and Codex

The plugin's *Claude Code packaging* (`commands/*.md` + `agents/*.md`) drives the slash-command UX and will not load in other agents. Codex has native packaging described above. For portable skill installation, this repo also ships:

- `skills/antigravity-helper/SKILL.md` — Anthropic Skill format, discoverable by Codex CLI, OpenCode, Pi.dev, and Copilot CLI's skill loader
- `.plugin/plugin.json` — Copilot CLI's expected manifest at the repo root, pointing at the same `./skills/`

You lose the slash-command UX in these agents, but the capability remains reachable as a model-invoked skill.

### Copilot CLI

```bash
copilot plugin install contrapuntal/ask-antigravity
```

This installs the `antigravity-helper` skill (declared in `.plugin/plugin.json`), which is the Copilot surface — invoke it by describing the review or delegation task. The `antigravity-rescue` subagent is a Claude Code plugin component and is not loaded by Copilot; under Copilot, use the skill instead.

### OpenCode, Pi.dev, Codex fallback — symlink install

```bash
# Set this once per shell (or in your shell rc).
# ANTIGRAVITY_CLI_PLUGIN_CC_ROOT lets the skill find the companion script.
export ANTIGRAVITY_CLI_PLUGIN_CC_ROOT="$(pwd)"

# If agy hasn't been interactively trusted in your working dir, trust the
# workspace in agy (it records trustedWorkspaces in its settings.json).

# OpenCode
ln -s "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/skills/antigravity-helper" ~/.config/opencode/skills/antigravity-helper

# Codex CLI
ln -s "$ANTIGRAVITY_CLI_PLUGIN_CC_ROOT/skills/antigravity-helper" ~/.agents/skills/antigravity-helper

# Pi.dev (consult its package docs for the right skills directory; or distribute as an npm package)
```

Use the host's normal execution and approval policy. agy needs outbound network access, and OAuth refresh may require writing credentials under `~/.gemini/antigravity-cli/`. If either is blocked, report the actual diagnostic and configure access through the host's normal controls. Do not automatically broaden permissions. The native Codex skills use foreground execution only.

Once linked, the agent's model loads the skill on demand based on its description. Prerequisites match Claude Code: `agy` CLI installed and authenticated, `node` 18.18+ on PATH.


## Testing

```bash
npm test
```

Runs unit tests against arg parsing, prompt assembly, git helpers, rendering, process spawning, and an end-to-end companion run against a fake `agy` binary. Tests never invoke the real `agy`.

```bash
AGY_LIVE=1 node --test tests/live.test.mjs
```

Runs live smoke tests against the **real** agy (spends model calls; needs an installed, authenticated agy). Run this after every agy upgrade — it verifies the upstream behaviors the plugin's design depends on: headless `-p` answering without a TTY, print-mode `--model`, marker-wrapped task output, and static-review stdin/final-result transport. Set `AGY_LIVE_MODEL` to select a model for the static review smoke test.

## License

Apache-2.0. Adapted from codex-plugin-cc (also Apache-2.0); see `NOTICE`.
