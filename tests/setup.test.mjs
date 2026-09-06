import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderSetupText,
  renderSetupJson,
  renderReviewHeader,
  renderError
} from "../plugins/ask-antigravity/scripts/lib/render.mjs";

const installHint = {
  primary: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  alternate: "brew install --cask antigravity-cli"
};

const ready = {
  antigravity: { installed: true, version: "1.0.7", supported: true },
  auth: { authenticated: true, method: "config" },
  installHint
};

test("renderSetupText shows the install hint when agy is missing", () => {
  const out = renderSetupText({ ...ready, antigravity: { installed: false } });
  assert.match(out, /Antigravity CLI \(agy\) is not installed/);
  assert.match(out, /antigravity\.google\/cli\/install\.sh/);
  assert.match(out, /brew install --cask antigravity-cli/);
});

test("renderSetupText warns when agy predates the minimum supported version", () => {
  // On agy <= 1.0.6 headless `-p` hangs, so an old install must be flagged
  // instead of silently stalling at first use.
  const out = renderSetupText({
    ...ready,
    antigravity: { installed: true, version: "1.0.6", supported: false }
  });
  assert.match(out, /1\.0\.6/);
  assert.match(out, /upgrade/i);
});

test("renderSetupText prompts for sign-in when unauthenticated", () => {
  const out = renderSetupText({ ...ready, auth: { authenticated: false } });
  assert.match(out, /No authentication evidence/);
  assert.match(out, /Run agy/);
  assert.match(out, /ANTIGRAVITY_API_KEY/);
});

test("renderSetupText says ready when installed, supported and authenticated", () => {
  const out = renderSetupText(ready);
  assert.match(out, /Antigravity CLI: installed \(1\.0\.7\)/);
  assert.match(out, /Auth: config/);
  assert.match(out, /Ready/);
  assert.match(out, /setup --live/);
  assert.ok(!/python/i.test(out), "python is no longer a prerequisite");
});

test("renderSetupJson emits a stable shape with no python fields", () => {
  const parsed = JSON.parse(renderSetupJson(ready));
  assert.deepEqual(parsed, {
    installed: true,
    version: "1.0.7",
    supported: true,
    authenticated: true,
    auth_method: "config",
    ready: true
  });
});

test("renderSetupJson reports not-ready when the agy version is unsupported", () => {
  const parsed = JSON.parse(
    renderSetupJson({
      ...ready,
      antigravity: { installed: true, version: "1.0.6", supported: false }
    })
  );
  assert.equal(parsed.ready, false);
  assert.equal(parsed.supported, false);
});

test("renderSetupJson reports not-ready when missing auth", () => {
  const parsed = JSON.parse(renderSetupJson({ ...ready, auth: { authenticated: false } }));
  assert.equal(parsed.ready, false);
  assert.equal(parsed.auth_method, null);
});

test("renderReviewHeader includes summary and target label", () => {
  const out = renderReviewHeader({
    summary: "Reviewing 3 files",
    target: { label: "branch diff against main" },
    mode: "review"
  });
  assert.match(out, /Reviewing 3 files/);
  assert.match(out, /branch diff against main/);
  assert.match(out, /Antigravity review/);
});

test("renderError formats Error instances", () => {
  assert.equal(renderError(new Error("nope")), "Error: nope");
});

test("renderError stringifies non-Error values", () => {
  assert.equal(renderError("plain string"), "Error: plain string");
});

test("live text shows verified response and labels local auth evidence", () => {
  const out = renderSetupText({...ready, live:{ok:true, detail:"Live response verified."}});
  assert.match(out, /Live check: passed/);
  assert.match(out, /Auth evidence: config \(heuristic\)/);
});

test("live text reports denial without claiming readiness", () => {
  const out = renderSetupText({...ready, live:{ok:false, detail:"command permission denied"}});
  assert.match(out, /Live check: failed/);
  assert.match(out, /command permission denied/);
  assert.doesNotMatch(out, /Ready/);
});

for (const antigravity of [{installed:false}, {installed:true, supported:false, version:"1.0.6"}]) {
  test(`live text explains unattempted probe ${JSON.stringify(antigravity)}`, () => {
    const out = renderSetupText({...ready, antigravity, live:{ok:false, detail:"Install a supported agy version."}});
    assert.match(out, /Live check: not run/);
    assert.match(out, /Install a supported agy version/);
  });
}

test("live readiness overrides missing heuristic evidence without changing legacy fields", () => {
  const state = {...ready, auth:{authenticated:false}, live:{ok:true, detail:"Live response verified."}};
  const json = JSON.parse(renderSetupJson(state));
  assert.equal(json.authenticated, false);
  assert.equal(json.auth_method, null);
  assert.equal(json.ready, true);
  assert.match(renderSetupText(state), /Auth evidence: none found \(heuristic\)/);
  assert.match(renderSetupText(state), /Live check: passed/);
});
