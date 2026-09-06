// Exercise the installable directory alone, as a Codex cache would contain it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLUGIN = path.join(ROOT, "plugins", "ask-antigravity");
const SKILLS = ["adversarial-review", "rescue", "review", "setup"];

function installedPlugin(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex agy cache-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const payload = path.join(temp, "cache", "ask-antigravity");
  fs.cpSync(PLUGIN, payload, { recursive: true });
  // Every platform exercises the same alias case as macOS /var -> /private/var.
  const installed = path.join(temp, "linked plugin");
  fs.symlinkSync(payload, installed, "dir");
  return { temp, installed };
}

function runtimeFixture(t) {
  const { temp, installed } = installedPlugin(t);
  const repo = path.join(temp, "target repo");
  fs.mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Packaging Test");
  git("config", "user.email", "packaging@example.invalid");
  fs.writeFileSync(path.join(repo, "change.txt"), "original\n");
  git("add", "change.txt");
  git("-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "initial");
  git("checkout", "-b", "fix/packaging-fixture");
  fs.writeFileSync(path.join(repo, "change.txt"), "packaged runtime change\n");
  git("add", "change.txt");
  git("-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "change");

  const bin = path.join(temp, "bin");
  fs.mkdirSync(bin);
  const log = path.join(temp, "requests.jsonl");
  fs.writeFileSync(path.join(bin, "agy"), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('9.9.9'); process.exit(0); }
if (args.includes('--input-format')) {
  const prompt = JSON.parse(fs.readFileSync(0, 'utf8')).message.content;
  fs.appendFileSync(process.env.PACKAGING_LOG, JSON.stringify({args, prompt, cwd:process.cwd()}) + '\\n');
  console.log(JSON.stringify({event:'result', result:{status:'SUCCESS',response:'PACKAGED-ANSWER'}}));
  process.exit(0);
}
const dir = args[args.indexOf('--add-dir') + 1];
const prompt = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8');
fs.appendFileSync(process.env.PACKAGING_LOG, JSON.stringify({args, prompt, cwd:process.cwd()}) + '\\n');
const request = args[args.indexOf('-p') + 1];
const begin = request.match(/===AGY-RESPONSE-BEGIN-[0-9a-f-]+===/)[0];
const end = request.match(/===AGY-RESPONSE-END-[0-9a-f-]+===/)[0];
console.log(begin + '\\nPACKAGED-ANSWER\\n' + end);
`, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    PACKAGING_LOG: log
  };
  delete env.ANTIGRAVITY_CLI_PLUGIN_CC_ROOT;
  const run = (...args) => {
    const result = spawnSync(process.execPath, [path.join(installed, "scripts", "antigravity-companion.mjs"), ...args], {
      cwd: repo, env, encoding: "utf8", timeout: 30000
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result;
  };
  const requests = () => fs.existsSync(log)
    ? fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  return { temp, repo, run, requests };
}

test("Codex marketplace installs a self-contained plugin with all four skills", t => {
  const { installed } = installedPlugin(t);
  const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, ".agents", "plugins", "marketplace.json"), "utf8"));
  const entry = marketplace.plugins.find(plugin => plugin.name === "ask-antigravity");
  assert.ok(entry);
  assert.equal(entry.source.source, "local");
  assert.equal(path.resolve(ROOT, entry.source.path), PLUGIN);
  const manifest = JSON.parse(fs.readFileSync(path.join(installed, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, entry.name);
  assert.deepEqual(manifest.commands, [], "disable incompatible Claude command migration");
  const skillsRoot = path.resolve(installed, manifest.skills);
  assert.equal(skillsRoot, path.join(installed, "codex-skills"));
  assert.deepEqual(fs.readdirSync(skillsRoot).sort(), SKILLS);
  for (const name of SKILLS) {
    const skillDir = path.join(skillsRoot, name);
    const text = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    assert.match(text, new RegExp(`^---\\nname: ${name}\\n`, "u"));
    assert.match(text, /\ndescription: .+/);
    // The documented two-level traversal must land inside the installed bundle.
    const companion = path.resolve(skillDir, "..", "..", "scripts", "antigravity-companion.mjs");
    assert.ok(fs.statSync(companion).isFile());
  }
});

test("cached companion loads both review templates against another repository", t => {
  const { run, requests } = runtimeFixture(t);
  for (const command of ["review", "adversarial-review"]) {
    const args = [command, "--base", "main", "--model", "Gemini 3.5 Flash (Low)"];
    if (command === "adversarial-review") args.push("Challenge concurrency assumptions");
    assert.match(run(...args).stdout, /PACKAGED-ANSWER/);
  }
  const [review, adversarial] = requests();
  assert.match(review.prompt, /performing a code review/);
  assert.match(adversarial.prompt, /performing an adversarial software review/);
  assert.match(adversarial.prompt, /Challenge concurrency assumptions/);
  for (const request of [review, adversarial]) {
    assert.match(request.prompt, /packaged runtime change/);
    assert.match(request.prompt, /Do not call tools/);
    assert.equal(request.args[request.args.indexOf("--input-format") + 1], "stream-json");
    assert.equal(request.args[request.args.indexOf("--output-format") + 1], "stream-json");
    assert.ok(request.args.includes("--disable-slash-commands"));
    assert.ok(!request.args.includes("--add-dir"));
    assert.doesNotMatch(request.prompt, /\{\{[A-Z_]+\}\}/);
    assert.equal(request.args[request.args.indexOf("--model") + 1], "Gemini 3.5 Flash (Low)");
    assert.ok(!request.args.includes("--dangerously-skip-permissions"));
  }
});

test("cached setup and rescue work without a source-root environment variable", t => {
  const { temp, repo, run, requests } = runtimeFixture(t);
  const state = JSON.parse(run("setup", "--json").stdout);
  assert.equal(state.installed, true);
  assert.equal(requests().length, 0, "ordinary setup must not make a model call");
  const prompt = "Investigate $(touch sentinel) and `echo injected`; preserve 'quotes' and $HOME.\nSecond line.";
  const file = path.join(temp, "rescue request.md");
  fs.writeFileSync(file, prompt);
  assert.match(run("task", "--prompt-file", file).stdout, /PACKAGED-ANSWER/);
  const [request] = requests();
  assert.equal(request.prompt, prompt);
  assert.equal(fs.realpathSync(request.cwd), fs.realpathSync(repo));
  assert.ok(!request.args.includes("--dangerously-skip-permissions"));
  assert.ok(!fs.existsSync(path.join(repo, "sentinel")));
});
