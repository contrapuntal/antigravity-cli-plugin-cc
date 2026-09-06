# Gemini 3.8 Flash (High) review

2026-09-06, agy 1.1.27, through the updated companion. Raw model output; see [verification](codex-validation.md#gemini-flash-static-review-transport) for disposition.

> Antigravity review: Reviewing 0 staged, 14 unstaged, and 10 untracked file(s) on branch feat/codex-support.
> Target: working tree diff
## Summary
NO-SHIP: The change adds Codex packaging and stdin-based static reviews, but introduces a crash in `setup --json` when the CLI is missing, conflicting version requirements in the Codex review skills, and exit stalls on cancellation.

### Critical
(none)

### High
- Unhandled TypeError when generating setup JSON without Antigravity installed: plugins/ask-antigravity/scripts/lib/render.mjs:48-52 — `state.auth` is only initialized when `state.antigravity.installed` is truthy, but `renderSetupJson` unconditionally evaluates `state.auth.authenticated`. When `agy` is not installed, running `setup --json` or `setup --live --json` throws an unhandled `TypeError: Cannot read properties of undefined (reading 'authenticated')` instead of outputting structured error JSON. Guard property access using optional chaining (`state.auth?.authenticated ?? false`, `state.auth?.method ?? null`, and within `ready`).
- Conflicting CLI version prerequisites between Codex skill contracts and runtime checks: plugins/ask-antigravity/codex-skills/review/SKILL.md:11 — The skill contract instructs Codex that `agy 1.0.7+` is required, but `static-review.mjs:MIN_REVIEW_AGY_VERSION` and `antigravity-companion.mjs:agyUsable` strictly enforce `1.1.15+` for static reviews. On systems with `agy` versions between 1.0.7 and 1.1.14 (which are supported for tasks and setup), the skill prompts indicate the environment is ready, but review calls immediately exit with status 1. Update the prerequisites in `codex-skills/review/SKILL.md` (and `codex-skills/adversarial-review/SKILL.md:11`) to state `agy 1.1.15+`.

### Medium
- Cancellation stalls for the full grace period and force-kills exited processes: plugins/ask-antigravity/scripts/lib/process.mjs:231-240 — When `cancel()` is triggered, `graceTimer` is set to wait for graceful termination, but `child.on("close")` only assigns `closedResult = result` without resolving while `graceTimer` is active. As a result, even if the child process group exits immediately upon receiving SIGTERM, `captureCommand` stalls for the entire 2000ms grace period before calling `terminate()`, which sends an unnecessary `SIGKILL` to an already-dead process group. In `child.on("close")`, clear `graceTimer` and invoke `finish(result)` immediately rather than deferring until timer expiry.
- Static review invocation hardcodes binary name and ignores `AGY_BINARY`: plugins/ask-antigravity/scripts/lib/static-review.mjs:51 — `invokeStaticReview` calls `captureCommand("agy", ...)` directly instead of using `AGY_BINARY` (defined in `plugins/ask-antigravity/scripts/lib/agy.mjs` to honor `process.env.AGY_BINARY`). When a custom binary path or test wrapper is configured via `AGY_BINARY`, `setup` and `task` use the custom executable while `review` and `adversarial-review` bypass it and resolve `"agy"` against PATH. Import `AGY_BINARY` from `./agy.mjs` and pass it to `captureCommand`.

### Nits
- Whole-output JSON parsing fails static reviews on non-JSON stdout lines: plugins/ask-antigravity/scripts/lib/static-review.mjs:20-25 — `parseReviewOutput` maps every non-empty line of stdout through `JSON.parse` inside a single `try/catch`. If `agy` or a sub-process prints any informational text, notice, or banner to stdout alongside the stream events, the entire review aborts with an invalid output error. Parse line-by-line and ignore non-JSON lines instead of invalidating the entire stream.
