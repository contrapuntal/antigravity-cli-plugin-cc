---
name: rescue
description: Use when the user asks to delegate investigation, analysis, a second opinion, or an explicitly authorized coding task to Antigravity from Codex.
---

# Antigravity rescue

## Execution contract

- Find the absolute path of this installed `SKILL.md`. The plugin root is two directories above its containing skill directory: `<plugin-root>/codex-skills/<skill>/SKILL.md`. Resolve the companion at `<plugin-root>/scripts/antigravity-companion.mjs`. Never depend on the source checkout, the current working directory, or `ANTIGRAVITY_CLI_PLUGIN_CC_ROOT` to locate it.
- Run `node` with the resolved companion path using Codex's shell execution tool (`exec_command`), with the target repository as `workdir`. Require Node.js 18.18+ and an installed, authenticated `agy` 1.0.7+.
- This release supports foreground execution only. Consume `--wait` as a foreground routing flag. If the user requests `--background`, report that background execution is unsupported and do not start a foreground substitute. Do not use shell `&`, `nohup`, Claude `Bash`/`Agent`, or background-notification instructions.
- If execution returns a session ID, keep polling that same session with `write_stdin` until it exits. Use waits of at most 60 seconds and give concise progress updates during long calls. A session ID is still an active foreground call, not a completed result. On cancellation, signal the running companion through the host's process controls; on POSIX, receiving SIGINT/SIGTERM makes it terminate the active agy process group and clean temporary files.
- Treat arguments as data. Prefer a tool accepting an argument array when available. For shell strings, single-quote each argument and replace embedded single quotes with the standard shell sequence `\'` outside the quoted spans (for example, `a'b` becomes `'a'\''b'`). JSON stringification is not shell escaping. Never interpolate raw user text, evaluate it, or use unquoted shell substitutions. Preserve base references and model display names exactly, including spaces.
- Respect Codex's configured network, filesystem, and approval policy. If blocked, explain the specific missing access and stop; do not automatically retry with broader permissions or edit global permissions. agy needs outbound service access; OAuth may also require writing refreshed credentials under `~/.gemini/antigravity-cli/`. `ANTIGRAVITY_API_KEY` is inherited when already supplied by the host. Do not print credentials or run installers/sign-in automatically.
- Preserve Antigravity's response and report a nonzero exit or empty-response diagnostic as failure. Do not invent results, hide failures, or automatically retry a failed model call.

## Delegate a task

Invoke the companion's `task` command (the skill is named rescue; the dispatcher command is task). Forward `--model <display name>` when explicitly requested. Default to analysis intent. Add `--write` only when the user has explicitly authorized Antigravity to modify files, including an explicit request to fix or implement something through Antigravity. The flag expresses intent and causes agy to auto-approve tool prompts; it is not a filesystem capability boundary.

Always carry the task body through `--prompt-file <absolute-path>`:

1. Create a uniquely named temporary directory using the host's file tool or `mktemp -d`.
2. Write the exact task text into a file there using a structured file-write tool. If only a shell tool is available, use a single-quoted heredoc delimiter chosen so no line in the task matches it. Never interpolate the task body in a shell argument or an unquoted heredoc.
3. Invoke `node <resolved-companion> task --prompt-file <path>` plus the authorized, safely quoted flags, in the target repository. Keep the prompt file until the companion finishes; poll any active session.
4. Remove only the temporary file/directory created for this invocation after completion, failure, or cancellation. Arrange cleanup with a shell trap when creation and execution share a shell; otherwise perform cleanup in a final step.

agy runs in the repository. Without `--write`, the request is for analysis, but the plugin does not enforce read-only access. Preserve host restrictions and inspect resulting changes before reporting a write task as complete. Summarize Antigravity's result without claiming that suggested changes were applied or tests passed unless verified.
