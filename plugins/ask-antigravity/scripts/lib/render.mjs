export function renderSetupText(state) {
  const lines = [];
  const finish = () => {
    if (state.live) {
      const attempted = state.antigravity.installed && state.antigravity.supported;
      const label = !attempted ? "not run" : state.live.ok ? "passed" : "failed";
      lines.push(`Live check: ${label}. ${state.live.detail}`);
    }
    return lines.join("\n");
  };
  if (!state.antigravity.installed) {
    lines.push("Antigravity CLI (agy) is not installed.");
    lines.push("");
    lines.push(`To install: ${state.installHint.primary}`);
    lines.push(`        or: ${state.installHint.alternate}`);
    lines.push("");
    lines.push("Prerequisites: Node.js (>= 18.18) on PATH.");
    return finish();
  }

  lines.push(`Antigravity CLI: installed (${state.antigravity.version})`);

  if (!state.antigravity.supported) {
    lines.push("");
    lines.push(
      `This agy version (${state.antigravity.version}) predates the minimum this plugin supports — ` +
        "headless print mode hangs on older versions."
    );
    lines.push(`Please upgrade: ${state.installHint.primary}`);
    lines.push(`           or: brew upgrade antigravity-cli`);
    return finish();
  }

  if (state.live) {
    lines.push(`Auth evidence: ${state.auth.authenticated ? state.auth.method : "none found"} (heuristic)`);
    return finish();
  }

  if (!state.auth.authenticated) {
    lines.push("");
    lines.push("No authentication evidence found. Run agy and complete sign-in,");
    lines.push("or set ANTIGRAVITY_API_KEY in your environment.");
    return finish();
  }

  lines.push(`Auth: ${state.auth.method}`);
  lines.push("");
  lines.push("Ready (local authentication heuristic only). Use setup --live to verify a model response.");
  return finish();
}

export function renderSetupJson(state) {
  return JSON.stringify(
    {
      installed: state.antigravity.installed,
      version: state.antigravity.installed ? state.antigravity.version : null,
      supported: state.antigravity.installed ? Boolean(state.antigravity.supported) : false,
      authenticated: state.auth.authenticated,
      auth_method: state.auth.authenticated ? state.auth.method : null,
      ready: Boolean(
        state.antigravity.installed && state.antigravity.supported &&
          (state.live ? state.live.ok : state.auth.authenticated)
      ),
      ...(state.live ? { live: state.live } : {})
    },
    null,
    2
  );
}

export function renderReviewHeader({ summary, target, mode }) {
  const lines = [`> Antigravity ${mode}: ${summary}`];
  if (target?.label) {
    lines.push(`> Target: ${target.label}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return `Error: ${message}`;
}
