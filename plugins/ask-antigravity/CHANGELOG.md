# Changelog

## 1.2.0

- Send review context over stream-json stdin (agy 1.1.15+), request static analysis without tools, and report structured failures instead of accepting empty success

- Preserve completed responses on late cancellation; send SIGTERM before forced termination and keep exit-code ownership in the dispatcher
- Bound live setup checks to two minutes and clarify local authentication evidence versus live readiness
- Cover live text rendering and report when a probe could not run

- Add native Codex plugin and repository marketplace packaging with setup, review, adversarial-review, and rescue skills
- Resolve the bundled companion relative to installed skills; native Codex installation needs no root environment variable
- Use foreground Codex execution with session polling, safely quoted arguments, and temporary prompt files for rescue
- Add opt-in `setup --live` connectivity checks, including separate live results with `--json`
- Terminate the active agy process group on companion cancellation and clean temporary workspaces
- Handle symlinked cache paths on macOS and suppress incompatible Claude command migration in Codex
- Return failure for missing or unsupported agy during invocation and use host-neutral setup guidance
- Clarify analysis/write intent, host filesystem restrictions, and OAuth permission requirements

## 1.1.2

- Fail loudly when agy returns an empty answer in headless mode due to auto-denied tool permissions instead of silently reporting success
- Context-aware permission guidance: explain permission fix via `permissions.allow` in `settings.json`, and only suggest `--write` for write-capable task calls (never for read-only reviews where `--write` is unaccepted)
- Robust stderr inspection: strip ANSI escape sequences and broaden regex across all tool permissions so styled/colored diagnostics are recognized
- Prevent dirty stdout: buffer and validate non-empty response before writing to stdout on failed or empty runs
- Runtime model discovery in live `--model` test via `agy models` with cost-aware tier selection and improved failure diagnostics

## 1.1.1

- Internal release: initial runtime model discovery and empty-output detection

## 1.1.0

- Invoke `agy` directly: the non-TTY `-p` hang was fixed upstream in agy 1.0.7, so the python3 PTY bridge is gone and **python3 is no longer a prerequisite**
- Require agy >= 1.0.7: setup and every invocation path now check the version and ask for an upgrade instead of hanging on older agy
- Reinstate per-call model selection: `--model "<display name>"` (from `agy models`) is forwarded to agy's print mode on review, adversarial-review, and rescue/task
- Add end-to-end companion tests against a fake `agy` binary, and an `AGY_LIVE=1` smoke suite for validating real agy after upgrades

## 1.0.0

- Initial release: `/ask-antigravity:setup`, `/ask-antigravity:review`, `/ask-antigravity:adversarial-review`, `/ask-antigravity:rescue`
