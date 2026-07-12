---
description: Delegate investigation, analysis, or a coding task to the Antigravity rescue subagent
argument-hint: "[--background|--wait] [--write] [--model <name>] [what Antigravity should investigate, analyze, or solve]"
disable-model-invocation: true
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `ask-antigravity:antigravity-rescue` subagent via the `Agent` tool (`subagent_type: "ask-antigravity:antigravity-rescue"`), forwarding the raw user request as the prompt.
`ask-antigravity:antigravity-rescue` is a subagent, not a skill — do not call `Skill(ask-antigravity:antigravity-rescue)` (no such skill) or `Skill(ask-antigravity:rescue)` (that re-enters this command and hangs the session). The command runs inline so the `Agent` tool stays in scope.
The final user-visible response must be Antigravity's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `ask-antigravity:antigravity-rescue` subagent in the background.
- If the request includes `--wait`, run the subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model "<display name>"` selects the model for this call (names come from `agy models`; quote them — they contain spaces). Preserve it for the forwarded `task` call. Without it, agy uses the model selected in its TUI (`/model`).
- `--write` signals write intent (passes `--dangerously-skip-permissions` to agy). Preserve it for the forwarded `task` call. Without it, ask Antigravity to analyze and propose rather than apply changes — but note this is *not* a sandbox: on agy 1.1.1 no flag prevents agy from editing files, so a rescue run may modify the workspace either way. If the working tree is dirty and the user did not pass `--write`, warn them that any Antigravity edits will be mixed into their uncommitted changes.

Operating rules:

- The subagent is a thin forwarder only. It writes the task text to a temp file and makes one `Bash` call — `node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" task --prompt-file "<file>" ...` — then returns that command's stdout as-is. Task text goes through the file, never interpolated into the shell command.
- Return the Antigravity companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, summarize output, or do follow-up work of its own.
- Forward a user-supplied `--model "<display name>"` to the `task` call unchanged, including its quoting.
- If the user did not supply a request, ask what Antigravity should investigate or solve.
- If the helper reports that Antigravity is missing or unauthenticated, stop and tell the user to run `/ask-antigravity:setup`.
- For background runs, completion arrives as an Agent-tool notification from the harness. Do not poll temp directories, do not search for sidecar files (this plugin does not create any), and do not invoke `agy` or the companion script directly to "check status" — that runs a separate agy session and does not surface the in-flight one. If the subagent returns the line `[antigravity-rescue] dispatcher failed: <reason>`, surface that to the user verbatim and stop.
