// End-to-end tests for the companion dispatcher, driven against a fake `agy`
// binary placed first on PATH. These pin the full pipeline — temp prompt file,
// --add-dir, marker extraction, --model forwarding, version gating — without
// ever touching the real Antigravity CLI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMPANION = fileURLToPath(
  new URL("../plugins/ask-antigravity/scripts/antigravity-companion.mjs", import.meta.url)
);

// Extensionless CJS node script acting as `agy`. Appends each invocation's argv
// to AGY_FAKE_LOG (JSONL), honors --version, and otherwise replies with agy-like
// narration followed by a marker-wrapped echo of the prompt file's first line.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (process.env.AGY_FAKE_LOG) {
  fs.appendFileSync(process.env.AGY_FAKE_LOG, JSON.stringify(args) + "\\n");
}
if (args.includes("--version")) {
  process.stdout.write((process.env.AGY_FAKE_VERSION || "9.9.9") + "\\n");
  process.exit(0);
}
// Optional: prove where agy actually ran by dropping a sentinel in its cwd.
if (process.env.AGY_FAKE_SENTINEL) {
  fs.writeFileSync(path.join(process.cwd(), process.env.AGY_FAKE_SENTINEL), "x");
}
let body = "";
const addDir = args[args.indexOf("--add-dir") + 1];
if (addDir) {
  const file = fs.readdirSync(addDir)[0];
  body = fs.readFileSync(path.join(addDir, file), "utf8");
}
// Honor the per-invocation nonce markers the companion instructs us to use
// (real agy is told them in the -p prompt); fall back to the base constants.
const pArg = args[args.indexOf("-p") + 1] || "";
const begin = (pArg.match(/===AGY-RESPONSE-BEGIN-[0-9a-f-]+===/) || ["===AGY-RESPONSE-BEGIN==="])[0];
const end = (pArg.match(/===AGY-RESPONSE-END-[0-9a-f-]+===/) || ["===AGY-RESPONSE-END==="])[0];
process.stdout.write("I will read the request file in the workspace directory.\\n");
process.stdout.write(begin + "\\n");
process.stdout.write("FAKE-ANSWER: " + body.split("\\n")[0] + "\\n");
process.stdout.write(end + "\\n");
process.stdout.write("trailing narration that must be discarded\\n");
`;

function makeFakeAgy(t, { present = true, version } = {}) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-agy-bin-"));
  t.after(() => fs.rmSync(binDir, { recursive: true, force: true }));
  const logFile = path.join(binDir, "calls.jsonl");
  if (present) {
    const agyPath = path.join(binDir, "agy");
    fs.writeFileSync(agyPath, FAKE_AGY);
    fs.chmodSync(agyPath, 0o755);
  }
  const nodeDir = path.dirname(process.execPath);
  const env = {
    ...process.env,
    // binDir first so the fake shadows any real agy; node stays reachable for
    // the fake's shebang. When present=false, agy resolves to nothing.
    PATH: present ? `${binDir}${path.delimiter}${process.env.PATH}` : nodeDir,
    AGY_FAKE_LOG: logFile
  };
  if (version) env.AGY_FAKE_VERSION = version;
  return { env, logFile };
}

function readCalls(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runCompanion(args, env) {
  return spawnSync(process.execPath, [COMPANION, ...args], {
    env,
    encoding: "utf8",
    timeout: 30000
  });
}

test("task subcommand returns only the marker-delimited answer", (t) => {
  const { env } = makeFakeAgy(t);
  const result = runCompanion(["task", "Summarize the build system"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAKE-ANSWER: Summarize the build system/);
  assert.ok(!result.stdout.includes("I will read"), "narration before markers must be stripped");
  assert.ok(!result.stdout.includes("trailing narration"), "output after END marker must be stripped");
});

test("task forwards --model to agy and emits no unsupported warning", (t) => {
  const { env, logFile } = makeFakeAgy(t);
  const result = runCompanion(["task", "hello", "--model", "Gemini 3.5 Flash (Low)"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    !/not supported|ignored/i.test(result.stderr),
    `--model must be honored, got stderr: ${result.stderr}`
  );
  const invoke = readCalls(logFile).find((argv) => !argv.includes("--version"));
  assert.ok(invoke, "agy must be invoked beyond the version probe");
  assert.equal(invoke[invoke.indexOf("--model") + 1], "Gemini 3.5 Flash (Low)");
});

test("task cleans up the temp prompt directory", (t) => {
  const { env, logFile } = makeFakeAgy(t);
  const result = runCompanion(["task", "cleanup check"], env);
  assert.equal(result.status, 0, result.stderr);
  const invoke = readCalls(logFile).find((argv) => argv.includes("--add-dir"));
  const promptDir = invoke[invoke.indexOf("--add-dir") + 1];
  assert.ok(promptDir, "invocation must include --add-dir");
  assert.ok(!fs.existsSync(promptDir), "temp prompt dir must be removed after the run");
});

test("task with --write passes --dangerously-skip-permissions", (t) => {
  const { env, logFile } = makeFakeAgy(t);
  const result = runCompanion(["task", "apply the fix", "--write"], env);
  assert.equal(result.status, 0, result.stderr);
  const invoke = readCalls(logFile).find((argv) => !argv.includes("--version"));
  assert.ok(invoke.includes("--dangerously-skip-permissions"));
});

test("an agy older than the minimum is refused before invocation", (t) => {
  const { env, logFile } = makeFakeAgy(t, { version: "1.0.6" });
  const result = runCompanion(["task", "anything"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\.0\.6/);
  assert.match(result.stdout, /upgrade/i);
  const invokes = readCalls(logFile).filter((argv) => !argv.includes("--version"));
  assert.equal(invokes.length, 0, "agy must not be invoked headlessly on an unsupported version");
});

test("missing agy yields the install pointer, not a crash", (t) => {
  const { env } = makeFakeAgy(t, { present: false });
  const result = runCompanion(["task", "anything"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not installed/);
  assert.match(result.stdout, /setup/);
});

test("unknown subcommand exits 2 with usage", (t) => {
  const { env } = makeFakeAgy(t);
  const result = runCompanion(["frobnicate"], env);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown subcommand/);
  assert.match(result.stderr, /Usage/);
});

test("task without text exits 2", (t) => {
  const { env } = makeFakeAgy(t);
  const result = runCompanion(["task"], env);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /No task provided/);
});

test("task reads free-form text from --prompt-file (no shell interpolation of args)", (t) => {
  const { env, logFile } = makeFakeAgy(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-taskfile-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "req.md");
  // Text a shell would treat as command substitution / metacharacters; passed
  // via file it must reach agy verbatim, never executed.
  const text = "investigate the $(reboot) `rm -rf /` bug";
  fs.writeFileSync(file, text);
  const result = runCompanion(["task", "--prompt-file", file], env);
  assert.equal(result.status, 0, result.stderr);
  const invoke = readCalls(logFile).find((argv) => argv.includes("--add-dir"));
  const promptDir = invoke[invoke.indexOf("--add-dir") + 1];
  assert.ok(promptDir, "agy must be invoked with the prompt workspace");
  // The fake echoes the prompt file's first line as the answer; the dangerous
  // text must appear verbatim, proving it was carried as data, not executed.
  assert.match(result.stdout, /investigate the \$\(reboot\)/);
});

function makeDirtyRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-review-repo-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  spawnSync("git", ["init", "--initial-branch=main", dir]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "file.txt"), "one\n");
  run(["add", "."]);
  run(["commit", "-m", "init"]);
  fs.writeFileSync(path.join(dir, "file.txt"), "two\n"); // dirty working tree
  return dir;
}

test("review runs agy in an isolated workspace, leaving the repo untouched", (t) => {
  // Read-only is structural: the full diff is in the prompt, so agy is run in an
  // isolated cwd and cannot reach the repo. The fake agy writes a sentinel into
  // its cwd; after a review the repo working dir must contain no such file.
  const { env } = makeFakeAgy(t);
  const repo = makeDirtyRepo(t);
  const sentinel = "AGY_WROTE_HERE.txt";
  const result = spawnSync(process.execPath, [COMPANION, "review"], {
    cwd: repo,
    env: { ...env, AGY_FAKE_SENTINEL: sentinel },
    encoding: "utf8",
    timeout: 30000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAKE-ANSWER/, "review should still produce agy's answer");
  assert.ok(
    !fs.existsSync(path.join(repo, sentinel)),
    "review must not run agy inside the repo working directory"
  );
});
