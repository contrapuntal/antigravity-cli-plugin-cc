# Changelog

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
