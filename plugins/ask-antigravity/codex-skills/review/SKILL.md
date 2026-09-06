---
name: review
description: Use when the user asks Antigravity for a standard code review of working-tree changes or a branch diff in Codex.
---

# Antigravity review

## Execution contract

- Find the absolute path of this installed `SKILL.md`. The plugin root is two directories above its containing skill directory: `<plugin-root>/codex-skills/<skill>/SKILL.md`. Resolve the companion at `<plugin-root>/scripts/antigravity-companion.mjs`. Never depend on the source checkout, the current working directory, or `ANTIGRAVITY_CLI_PLUGIN_CC_ROOT` to locate it.
- Run `node` with the resolved companion path using Codex's shell execution tool (`exec_command`), with the target repository as `workdir`. Require Node.js 18.18+ and an installed, authenticated `agy` 1.1.15+.
- This release supports foreground execution only. Consume `--wait` as a foreground routing flag. If the user requests `--background`, report that background execution is unsupported and do not start a foreground substitute. Do not use shell `&`, `nohup`, Claude `Bash`/`Agent`, or background-notification instructions.
- If execution returns a session ID, keep polling that same session with `write_stdin` until it exits. Use waits of at most 60 seconds and give concise progress updates during long calls. A session ID is still an active foreground call, not a completed result. On cancellation, signal the running companion through the host's process controls; on POSIX, receiving SIGINT/SIGTERM makes it terminate the active agy process group and clean temporary files.
- Treat arguments as data. Prefer a tool accepting an argument array when available. For shell strings, single-quote each argument and replace embedded single quotes with the standard shell sequence `\'` outside the quoted spans (for example, `a'b` becomes `'a'\''b'`). JSON stringification is not shell escaping. Never interpolate raw user text, evaluate it, or use unquoted shell substitutions. Preserve base references and model display names exactly, including spaces.
- Respect Codex's configured network, filesystem, and approval policy. If blocked, explain the specific missing access and stop; do not automatically retry with broader permissions or edit global permissions. agy needs outbound service access; OAuth may also require writing refreshed credentials under `~/.gemini/antigravity-cli/`. `ANTIGRAVITY_API_KEY` is inherited when already supplied by the host. Do not print credentials or run installers/sign-in automatically.
- Preserve Antigravity's response and report a nonzero exit or empty-response diagnostic as failure. Do not invent results, hide failures, or automatically retry a failed model call.

## Standard review

Invoke the companion's `review` command. Forward an explicit `--base <ref>` for a branch comparison and `--model <display name>` when requested. Otherwise keep the dispatcher's existing target selection and selected agy model. Do not add `--write` or free-form focus text; use adversarial-review for a directed design challenge.

The dispatcher collects the Git diff and includes it in a review prompt. agy runs in a temporary working directory. This expresses review intent; changing directories is not filesystem isolation. Host filesystem policy provides any enforced restrictions.

Return the severity-organized Markdown result faithfully. If there are no changes, report the companion's no-changes result.
