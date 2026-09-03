// Live smoke tests against the REAL Antigravity CLI. Skipped unless AGY_LIVE=1
// is set, because they spend real model calls and need an installed,
// authenticated agy.
//
//   AGY_LIVE=1 node --test tests/live.test.mjs
//
// Run after every agy upgrade: the plugin's design rests on observed agy
// behaviors (non-TTY -p works as of 1.0.7, print-mode --model as of 1.0.5,
// narration requires marker extraction), and these assumptions can drift
// upstream without notice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIVE = process.env.AGY_LIVE === "1";
const skip = LIVE ? false : "set AGY_LIVE=1 to run live agy smoke tests";
const LIVE_TIMEOUT_MS = 180000;

const COMPANION = fileURLToPath(
  new URL("../plugins/ask-antigravity/scripts/antigravity-companion.mjs", import.meta.url)
);

test("live: agy meets the minimum supported version", { skip }, () => {
  const result = spawnSync("agy", ["--version"], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0);
  const [major, minor, patch] = result.stdout.trim().split(".").map(Number);
  assert.ok(
    major > 1 || (major === 1 && (minor > 0 || patch >= 7)),
    `agy ${result.stdout.trim()} predates 1.0.7 — headless -p hangs on this version`
  );
});

test("live: agy -p answers without a TTY (no PTY bridge needed)", { skip }, () => {
  // The load-bearing assumption behind deleting pty.mjs. If this hangs or
  // returns empty, the upstream non-TTY bug is back.
  const result = spawnSync(
    "agy",
    ["-p", "Reply with exactly the word PONG and nothing else.", "--print-timeout", "90s"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: LIVE_TIMEOUT_MS }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PONG/);
});

test("live: companion task round-trip extracts the marked response", { skip }, () => {
  const result = spawnSync(
    process.execPath,
    [COMPANION, "task", "Reply with exactly the word PONG and nothing else."],
    { encoding: "utf8", timeout: LIVE_TIMEOUT_MS }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PONG/);
  assert.ok(
    !/I will (read|view)/.test(result.stdout),
    "tool-use narration leaked past marker extraction"
  );
});

// agy's model catalog rotates upstream ("Gemini 3.5 Flash" was current on
// 1.1.1 and gone by 1.1.25) and --model is strictly validated, so pinning a
// display name here turns a healthy plugin into a red test on the next model
// refresh. Ask agy what it currently offers instead: `agy models` prints one
// "<id>\t<display name>" line per model on stdout.
function availableModels() {
  const result = spawnSync("agy", ["models"], { encoding: "utf8", timeout: 60000 });
  assert.equal(
    result.status,
    0,
    `\`agy models\` failed (exit ${result.status}): ${result.stderr || result.error?.message || "unknown error"}`
  );
  return result.stdout
    .split("\n")
    .map((line) => line.split("\t")[1]?.trim())
    .filter(Boolean);
}

test("live: print-mode --model accepts a display name", { skip }, () => {
  const models = availableModels();
  assert.ok(models.length > 0, "`agy models` listed nothing — cannot exercise --model");
  // Prefer the cheapest tier (Low/Lite) so the smoke test spends as little as possible.
  const model =
    models.find((name) => /Flash \(Low\)/i.test(name)) ??
    models.find((name) => /\b(Low|Lite)\b/i.test(name)) ??
    models.find((name) => /Flash/i.test(name)) ??
    models[models.length - 1];

  const result = spawnSync(
    process.execPath,
    [COMPANION, "task", "Reply with exactly the word PONG and nothing else.", "--model", model],
    { encoding: "utf8", timeout: LIVE_TIMEOUT_MS }
  );
  assert.equal(result.status, 0, `--model ${model}: ${result.stderr}`);
  assert.match(result.stdout, /PONG/);
  assert.ok(!/not supported|ignored/i.test(result.stderr), result.stderr);
});
