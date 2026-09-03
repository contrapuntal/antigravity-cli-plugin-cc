// Antigravity CLI (`agy`) adapter. Replaces the old gemini.mjs.
//
// Two things make agy different from the old `gemini` binary and shape this
// module (see memory: agy-cli-migration-constraints):
//   1. The prompt is an argv value, not stdin, so large multi-file prompts would
//      blow the OS argv limit -> we write the prompt to a temp file and add it to
//      agy's workspace with --add-dir, then a short -p instruction tells agy to
//      read it. (Verified: agy reads the file read-only, no skip-permissions.)
//   2. agy is agentic: print mode narrates tool-use steps before the answer, so
//      the real response is wrapped in marker lines and extracted (see
//      extractMarkedResponse).
//
// History: on agy <= 1.0.6, `agy -p` HUNG without a real terminal, which forced
// a python3 PTY bridge (lib/pty.mjs, since deleted). Fixed upstream in 1.0.7
// (verified 2026-06-09), so agy is spawned directly now — but older agy would
// still hang until our hard timeout, hence the MIN_AGY_VERSION gate below.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { binaryAvailable, captureCommand, stripAnsi } from "./process.mjs";

const AGY_BINARY = "agy";
const CONFIG_DIR = path.join(os.homedir(), ".gemini", "antigravity-cli");
const INSTALL_SH = "curl -fsSL https://antigravity.google/cli/install.sh | bash";
const INSTALL_BREW = "brew install --cask antigravity-cli";
const PRINT_TIMEOUT = "10m";
// Hard ceiling above agy's own --print-timeout, so a wedged process can't hang
// the companion forever.
const INVOKE_TIMEOUT_MS = 12 * 60 * 1000;

// Oldest agy whose print mode works without a terminal. On <= 1.0.6 a headless
// `-p` hangs producing nothing (upstream issue #7), so we refuse to invoke
// rather than stall until INVOKE_TIMEOUT_MS.
export const MIN_AGY_VERSION = "1.0.7";

// Compare an `agy --version` string against MIN_AGY_VERSION. Unparseable
// versions (dev builds) are assumed supported rather than blocking the user.
export function isSupportedVersion(version) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  if (!match) return true;
  const [major, minor, patch] = match.slice(1).map(Number);
  const [minMajor, minMinor, minPatch] = MIN_AGY_VERSION.split(".").map(Number);
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

export function detectAntigravity() {
  const probe = binaryAvailable(AGY_BINARY, ["--version"]);
  if (!probe.available) {
    return { installed: false, detail: probe.detail };
  }
  return { installed: true, version: probe.detail, supported: isSupportedVersion(probe.detail) };
}

// Best-effort auth probe. agy keeps OAuth credentials in the OS keyring, which we
// cannot read here, so we cannot positively verify a signed-in session. We treat
// an ANTIGRAVITY_API_KEY env var, or a populated agy config dir (evidence the user
// has onboarded), as "authenticated" and let agy surface real auth errors at first
// use. This deliberately avoids false negatives that would nag onboarded users;
// note the command paths gate on `installed`, not on this probe.
export function detectAuth({ configDir = CONFIG_DIR } = {}) {
  if (process.env.ANTIGRAVITY_API_KEY) {
    return { authenticated: true, method: "api-key" };
  }
  try {
    if (fs.existsSync(configDir) && fs.readdirSync(configDir).length > 0) {
      return { authenticated: true, method: "keyring" };
    }
  } catch {
    // ignore
  }
  return { authenticated: false };
}

export function installHint() {
  return { primary: INSTALL_SH, alternate: INSTALL_BREW };
}

// agy is agentic: in print mode it narrates its tool-use steps ("I will read
// REQUEST.md...") before the actual answer, and a plain "no preamble" request
// does not suppress that. So we have agy wrap its real response between two
// marker lines and extract only that region (see extractMarkedResponse),
// which leaves the narration outside the markers and discarded.
//
// These base constants are the fallback/template; each real invocation uses
// per-call NONCE markers (makeResponseMarkers) so content under review cannot
// forge a marker line to truncate or replace the answer.
export const RESPONSE_BEGIN = "===AGY-RESPONSE-BEGIN===";
export const RESPONSE_END = "===AGY-RESPONSE-END===";

// Build per-invocation marker lines carrying an unguessable nonce. A fixed
// marker could be echoed by a reviewed file (or agy narration) to hijack
// extraction; a random nonce per call closes that.
export function makeResponseMarkers(nonce = randomUUID()) {
  return {
    begin: `===AGY-RESPONSE-BEGIN-${nonce}===`,
    end: `===AGY-RESPONSE-END-${nonce}===`
  };
}

// Build agy argv for an invocation. The prompt body is NOT here — it lives in
// `promptFile` inside `promptDir` (added via --add-dir); the -p instruction is a
// short fixed string, so prompt size never approaches the argv limit. `model`
// is a display name from `agy models` (print-mode --model exists on agy >= 1.0.5;
// our minimum is 1.0.7 anyway).
export function buildAgyArgs({
  promptDir,
  promptFile,
  write,
  model,
  begin = RESPONSE_BEGIN,
  end = RESPONSE_END
}) {
  const args = [
    "-p",
    `Read the file ${promptFile} in the added workspace directory and do exactly what it asks. ` +
      `Then output a line containing only ${begin}, then your complete response, then a ` +
      `line containing only ${end}. Put nothing other than your response between those ` +
      `marker lines, and output nothing after ${end}.`,
    "--add-dir",
    promptDir,
    "--print-timeout",
    PRINT_TIMEOUT
  ];
  if (model) {
    args.push("--model", model);
  }
  if (write) {
    // Auto-approve tool use so write tasks don't stall on a permission prompt.
    //
    // IMPORTANT: this flag is NOT a capability boundary for FILE WRITES.
    // Omitting it does not make the run read-only — on agy 1.1.1, headless
    // print mode will happily edit files with no flag at all (verified:
    // omitting this flag, --mode plan, and --sandbox all still wrote).
    //
    // But it is NOT a no-op either (CORRECTED on 1.1.25): with no TTY the
    // permission prompt does not disappear, it auto-DENIES. A tool needing the
    // "command" permission and absent from the user's permissions.allow is
    // refused, and agy then abandons the whole response — empty stdout, exit 0.
    // So omitting this flag genuinely confines shell-command execution to the
    // user's allowlist; it simply buys nothing against file edits. See
    // explainEmptyOutput, which turns that silent denial into a real error.
    //
    // Callers that need a real read-only guarantee must use isolateWorkspace
    // (see invokeAntigravity), which denies agy access to the repo by running
    // it in an empty directory.
    args.push("--dangerously-skip-permissions");
  }
  return args;
}

// Pure, unit-testable: return the text between the standalone BEGIN marker line
// and the standalone END marker line, trimmed. Markers must be alone on their
// line (after trimming) so a mention inside narration prose never matches.
//
// Requires EXACTLY ONE begin and one end marker, in order. Absent, unpaired,
// out-of-order, or DUPLICATE markers all return null — a second marker pair is
// ambiguous (an injection could smuggle in an attacker-chosen payload as the
// first pair), so we refuse rather than guess. Callers fall back to the full
// output when this returns null, so a non-compliant agy run never loses the
// answer; with per-call nonce markers, content cannot forge a valid pair.
export function extractMarkedResponse(text, begin = RESPONSE_BEGIN, end = RESPONSE_END) {
  if (!text) return null;
  const lines = text.split("\n");
  const beginLines = [];
  const endLines = [];
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === begin) beginLines.push(i);
    if (trimmed === end) endLines.push(i);
  }
  if (beginLines.length !== 1 || endLines.length !== 1) return null;
  if (endLines[0] <= beginLines[0]) return null;
  return lines.slice(beginLines[0] + 1, endLines[0]).join("\n").trim();
}

// Pure, unit-testable: explain why agy returned nothing. The actionable
// permission fix is offered ONLY when agy's own stderr shows that denial —
// otherwise we report the empty result plainly rather than inventing a cause
// we did not observe. canSuggestWrite controls whether "--write" is offered as
// an escape hatch; it is omitted when the caller cannot support write (e.g.
// read-only reviews) or already passed it.
export function explainEmptyOutput(stderr = "", { canSuggestWrite = false } = {}) {
  const cleanStderr = stripAnsi(stderr);
  const deniedTool =
    /required the "?[a-z0-9_-]+"? permission|permissions\.allow|auto-denied/i.test(cleanStderr);
  if (deniedTool) {
    const remedy = canSuggestWrite
      ? "Fix: add an allow-rule under permissions.allow in " +
        "~/.gemini/antigravity-cli/settings.json (e.g. command(<target>)), or re-run with " +
        "--write to auto-approve tools for this run.\n"
      : "Fix: add an allow-rule under permissions.allow in " +
        "~/.gemini/antigravity-cli/settings.json (e.g. command(<target>)).\n";
    return (
      "agy produced no answer: a tool required a permission that headless mode cannot " +
      "prompt for, so it was auto-denied.\n" +
      remedy
    );
  }
  if (cleanStderr.trim()) {
    return "agy produced no answer (empty output); see agy's stderr above for any detail.\n";
  }
  return "agy produced no answer (empty output).\n";
}

// Invoke agy, capture its response, print it. Resolves { status }. The temp
// prompt dir is always cleaned up. agy's stderr is passed through so real auth
// or quota errors stay visible.
export async function invokeAntigravity({ prompt, model, write, cwd, isolateWorkspace = false }) {
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-prompt-"));
  // Read-only reviews inline the entire diff into the prompt, so agy needs no
  // access to the user's repo. Run it in an isolated empty workspace so
  // read-only is structural — agy literally cannot see or modify the repo —
  // rather than resting on agy's headless permission behavior.
  const workspaceDir = isolateWorkspace
    ? fs.mkdtempSync(path.join(os.tmpdir(), "agy-workspace-"))
    : null;
  const effectiveCwd = workspaceDir ?? cwd;
  try {
    // Unique filename so the -p instruction can't be satisfied by a same-named
    // file in the user's workspace (cwd); the write is inside the try so a
    // failure still cleans up promptDir in the finally.
    const promptFile = `agy-request-${randomUUID()}.md`;
    fs.writeFileSync(path.join(promptDir, promptFile), prompt);

    // Per-invocation nonce markers: content under review can't forge them, so
    // it can't hijack extraction. The same markers drive buildAgyArgs (what agy
    // is told to emit) and extractMarkedResponse (what we look for).
    const markers = makeResponseMarkers();
    const args = buildAgyArgs({
      promptDir,
      promptFile,
      write,
      model,
      begin: markers.begin,
      end: markers.end
    });
    const result = await captureCommand(AGY_BINARY, args, {
      cwd: effectiveCwd,
      timeoutMs: INVOKE_TIMEOUT_MS
    });

    // Prefer the marker-delimited response (drops agy's tool-use narration). If
    // the markers are missing/ambiguous, fall back to the full captured output
    // so the answer is never lost — but warn, since that output may include
    // narration and the read-only/marker contract wasn't honored.
    const extracted = extractMarkedResponse(result.stdout, markers.begin, markers.end);
    const answer = extracted ?? result.stdout;
    if (result.timedOut) {
      process.stderr.write(`agy did not respond within ${PRINT_TIMEOUT}.\n`);
      return { status: result.status || 1 };
    }
    // agy exits 0 even when it abandons the response — e.g. a tool needing a
    // permission is auto-denied in headless mode, which yields empty stdout and
    // status 0. A zero status is therefore not evidence of an answer; empty
    // output is the only signal. Reporting success here would hand the caller
    // silence it cannot tell apart from a real result.
    if (!answer || !answer.trim()) {
      if (result.stderr) {
        process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : result.stderr + "\n");
      }
      const canSuggestWrite = !isolateWorkspace && !write;
      process.stderr.write(explainEmptyOutput(result.stderr, { canSuggestWrite }));
      return { status: result.status || 1 };
    }
    if (extracted === null && result.stdout) {
      process.stderr.write(
        "warning: agy did not emit the expected response markers; showing raw output.\n"
      );
    }
    process.stdout.write(answer.endsWith("\n") ? answer : answer + "\n");
    if (result.stderr) {
      process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : result.stderr + "\n");
    }
    return { status: result.status };
  } finally {
    fs.rmSync(promptDir, { recursive: true, force: true });
    if (workspaceDir) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  }
}
