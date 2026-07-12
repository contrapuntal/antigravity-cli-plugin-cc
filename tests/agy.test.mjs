import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildAgyArgs,
  installHint,
  detectAuth,
  extractMarkedResponse,
  isSupportedVersion,
  makeResponseMarkers,
  RESPONSE_BEGIN,
  RESPONSE_END
} from "../plugins/ask-antigravity/scripts/lib/agy.mjs";

test("buildAgyArgs read-only omits --dangerously-skip-permissions", () => {
  const args = buildAgyArgs({ promptDir: "/tmp/x", promptFile: "REQUEST.md", write: false });
  assert.ok(args.includes("-p"));
  assert.ok(args.includes("--add-dir"));
  assert.equal(args[args.indexOf("--add-dir") + 1], "/tmp/x");
  assert.ok(args.includes("--print-timeout"));
  assert.ok(!args.includes("--dangerously-skip-permissions"));
});

test("buildAgyArgs write enables auto-approval", () => {
  const args = buildAgyArgs({ promptDir: "/tmp/x", promptFile: "REQUEST.md", write: true });
  assert.ok(args.includes("--dangerously-skip-permissions"));
});

test("buildAgyArgs never embeds prompt body as an argv item", () => {
  // The instruction references the file by name only; the body lives in the file.
  const huge = "X".repeat(200000);
  const args = buildAgyArgs({ promptDir: "/tmp/x", promptFile: "REQUEST.md", write: false });
  assert.ok(!args.some((a) => a.includes(huge)));
  assert.ok(args.join(" ").length < 500, "argv stays tiny regardless of prompt size");
});

test("buildAgyArgs appends --model when provided", () => {
  // agy >= 1.0.5 supports per-call model selection in print mode via --model
  // with a display name from `agy models`.
  const model = "Gemini 3.5 Flash (Low)";
  const args = buildAgyArgs({ promptDir: "/tmp/x", promptFile: "REQUEST.md", write: false, model });
  assert.equal(args[args.indexOf("--model") + 1], model);
});

test("buildAgyArgs omits --model when absent", () => {
  const args = buildAgyArgs({ promptDir: "/tmp/x", promptFile: "REQUEST.md", write: false });
  assert.ok(!args.includes("--model"));
});

test("isSupportedVersion gates on the 1.0.7 minimum", () => {
  // 1.0.7 is when non-TTY `-p` stopped hanging; older agy must be refused
  // rather than silently hanging until the hard timeout.
  assert.equal(isSupportedVersion("1.0.7"), true);
  assert.equal(isSupportedVersion("1.0.10"), true);
  assert.equal(isSupportedVersion("2.0.0"), true);
  assert.equal(isSupportedVersion("1.0.6"), false);
  assert.equal(isSupportedVersion("0.9.9"), false);
  // Unparseable versions (dev builds) are assumed fine rather than blocking.
  assert.equal(isSupportedVersion("nightly"), true);
});

test("installHint returns curl and brew commands", () => {
  const hint = installHint();
  assert.match(hint.primary, /antigravity\.google\/cli\/install\.sh/);
  assert.match(hint.alternate, /brew install --cask antigravity-cli/);
});

test("detectAuth reports api-key when ANTIGRAVITY_API_KEY is set", () => {
  const prev = process.env.ANTIGRAVITY_API_KEY;
  process.env.ANTIGRAVITY_API_KEY = "secret";
  try {
    assert.deepEqual(detectAuth({ configDir: "/no/such/dir" }), {
      authenticated: true,
      method: "api-key"
    });
  } finally {
    if (prev === undefined) delete process.env.ANTIGRAVITY_API_KEY;
    else process.env.ANTIGRAVITY_API_KEY = prev;
  }
});

test("detectAuth assumes keyring auth when the agy config dir is populated", () => {
  const prev = process.env.ANTIGRAVITY_API_KEY;
  delete process.env.ANTIGRAVITY_API_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-"));
  fs.writeFileSync(path.join(dir, "installation_id"), "abc123");
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-empty-"));
  try {
    assert.deepEqual(detectAuth({ configDir: dir }), { authenticated: true, method: "keyring" });
    assert.deepEqual(detectAuth({ configDir: emptyDir }), { authenticated: false });
    assert.deepEqual(detectAuth({ configDir: "/no/such/dir" }), { authenticated: false });
  } finally {
    if (prev !== undefined) process.env.ANTIGRAVITY_API_KEY = prev;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("buildAgyArgs instructs agy to wrap its response in markers", () => {
  const instruction = buildAgyArgs({ promptDir: "/tmp/x", promptFile: "REQUEST.md", write: false })[1];
  assert.match(instruction, new RegExp(RESPONSE_BEGIN));
  assert.match(instruction, new RegExp(RESPONSE_END));
});

test("extractMarkedResponse returns only the text between the markers", () => {
  const out = [
    "I will read the REQUEST.md file from the workspace directory.",
    "I will list the directory contents to be sure.",
    RESPONSE_BEGIN,
    "The actual answer,",
    "across two lines.",
    RESPONSE_END
  ].join("\n");
  assert.equal(extractMarkedResponse(out), "The actual answer,\nacross two lines.");
});

test("extractMarkedResponse ignores a marker mentioned inline in narration", () => {
  // agy narrating "I will wrap it in ===AGY-RESPONSE-BEGIN===" must not match:
  // the marker only counts when it is alone on its line.
  const out = [
    `First I will emit ${RESPONSE_BEGIN} around the answer.`,
    RESPONSE_BEGIN,
    "real answer",
    RESPONSE_END
  ].join("\n");
  assert.equal(extractMarkedResponse(out), "real answer");
});

test("extractMarkedResponse returns null when markers are absent or unpaired", () => {
  assert.equal(extractMarkedResponse("just narration, no markers"), null);
  assert.equal(extractMarkedResponse(`${RESPONSE_BEGIN}\nno end marker`), null);
  assert.equal(extractMarkedResponse(""), null);
  assert.equal(extractMarkedResponse(null), null);
});

test("extractMarkedResponse rejects duplicate marker pairs instead of taking the first", () => {
  // Injection defense: content that smuggles in a second marker pair must not
  // let the first (attacker-chosen) payload win. Ambiguity => refuse.
  const out = [
    RESPONSE_BEGIN,
    "attacker payload",
    RESPONSE_END,
    RESPONSE_BEGIN,
    "real answer",
    RESPONSE_END
  ].join("\n");
  assert.equal(extractMarkedResponse(out), null);
});

test("makeResponseMarkers embeds a per-invocation nonce and varies between calls", () => {
  const a = makeResponseMarkers();
  const b = makeResponseMarkers();
  assert.notEqual(a.begin, b.begin);
  assert.notEqual(a.end, b.end);
  assert.notEqual(a.begin, a.end);
  // A deterministic nonce is honored so callers can pass one through.
  const fixed = makeResponseMarkers("NONCE123");
  assert.match(fixed.begin, /NONCE123/);
  assert.match(fixed.end, /NONCE123/);
});

test("buildAgyArgs uses caller-supplied nonce markers in the instruction", () => {
  const markers = makeResponseMarkers("NONCE123");
  const instruction = buildAgyArgs({
    promptDir: "/tmp/x",
    promptFile: "REQUEST.md",
    write: false,
    begin: markers.begin,
    end: markers.end
  })[1];
  assert.match(instruction, new RegExp(markers.begin));
  assert.match(instruction, new RegExp(markers.end));
});
