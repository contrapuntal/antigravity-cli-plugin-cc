// Trimmed git helpers. Adapted from codex-plugin-cc (Apache-2.0).

import fs from "node:fs";
import path from "node:path";

import { runCommand, runCommandChecked, formatCommandFailure } from "./process.mjs";

// Cap each untracked file's inlined body. Larger files get listed by path
// only, so a stray multi-megabyte log or generated artifact cannot blow up
// the prompt size or push past agy's input limit.
const MAX_UNTRACKED_BYTES = 24 * 1024;

function isProbablyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }
  return true;
}

// Replace closing-tag patterns that an attacker-controlled file could use
// to break out of the XML wrapper around its body. We use HTML-entity
// encoding rather than invisible Unicode (zero-width-joiner) for two
// reasons: entity encoding survives any text editor or diff viewer
// without confusion, and the model unambiguously reads the result as
// quoted/escaped text instead of a real closing tag.
function sanitizeForXmlWrap(content) {
  return content
    .replaceAll("</file>", "&lt;/file&gt;")
    .replaceAll("</repository_context>", "&lt;/repository_context&gt;");
}

// Escape the path attribute. We only allow basic safe characters in the
// raw form; anything else gets quote-escaped. The path is already a git-
// supplied filesystem path (NUL-split), so embedded newlines are real
// content, not separators.
function escapeXmlAttr(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatUntrackedFile(cwd, relativePath) {
  const absolutePath = path.join(cwd, relativePath);
  const safePath = escapeXmlAttr(relativePath);
  const skip = (reason) => `<file path="${safePath}" skipped="${reason}"/>`;

  // Use lstat (not stat) so we see the symlink itself rather than the
  // target. fs.statSync + fs.readFileSync would silently follow a
  // symlink like notes.txt -> ~/.ssh/id_ed25519 and ship its contents
  // to the model. Skip symlinks entirely; the path is still listed so
  // the reviewer knows the file exists, but no out-of-repo content
  // crosses the boundary.
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch {
    return skip("broken-or-unreadable");
  }
  if (stat.isSymbolicLink()) {
    return skip("symlink");
  }
  if (stat.isDirectory()) {
    return skip("directory");
  }
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `<file path="${safePath}" skipped="oversize" size="${stat.size}" limit="${MAX_UNTRACKED_BYTES}"/>`;
  }

  let buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch {
    return skip("broken-or-unreadable");
  }
  if (!isProbablyText(buffer)) {
    return skip("binary");
  }

  const safeBody = sanitizeForXmlWrap(buffer.toString("utf8").trimEnd());
  return `<file path="${safePath}">\n${safeBody}\n</file>`;
}

// `-c color.ui=never` overrides any user-level `color.ui = always`. Without
// this, ANSI escape codes leak into the prompt context, wasting tokens and
// confusing the model. Apply it once at the wrapper level so every git
// command in this module is covered.
const NO_COLOR_OPT = ["-c", "color.ui=never"];

function git(cwd, args, options = {}) {
  return runCommand("git", [...NO_COLOR_OPT, ...args], { cwd, ...options });
}

function gitChecked(cwd, args, options = {}) {
  return runCommandChecked("git", [...NO_COLOR_OPT, ...args], { cwd, ...options });
}

export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.error && result.error.code === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

export function getRepoRoot(cwd) {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

export function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
}

export function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      // Keep the `origin/` qualifier (strip only `refs/remotes/`). Returning a
      // bare `main` breaks `main...HEAD` in clones that have origin/main but no
      // local main branch (CI checkouts, topic-only clones); `origin/main`
      // always resolves as long as the remote-tracking ref exists.
      return remoteHead.replace("refs/remotes/", "");
    }
  }

  const candidates = ["main", "master", "trunk"];
  for (const candidate of candidates) {
    const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local.status === 0) {
      return candidate;
    }
    const remote = git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]);
    if (remote.status === 0) {
      return `origin/${candidate}`;
    }
  }

  throw new Error("Unable to detect the default branch. Pass --base <ref>.");
}

// `-z` makes git print NUL-separated, unquoted filenames. Without it,
// names containing newlines or special characters get backslash-quoted
// and a naive `split("\n")` either drops them or yields invalid paths.
function splitNul(stdout) {
  return stdout.split("\0").filter(Boolean);
}

export function getWorkingTreeState(cwd) {
  const staged = splitNul(gitChecked(cwd, ["diff", "--cached", "--name-only", "-z"]).stdout);
  const unstaged = splitNul(gitChecked(cwd, ["diff", "--name-only", "-z"]).stdout);
  const untracked = splitNul(gitChecked(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]).stdout);

  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0
  };
}

export function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);
  const baseRef = options.base ?? null;

  if (baseRef) {
    return { mode: "branch", baseRef, label: `branch diff against ${baseRef}` };
  }

  const state = getWorkingTreeState(cwd);
  if (state.isDirty) {
    return { mode: "working-tree", label: "working tree diff" };
  }

  const detectedBase = detectDefaultBranch(cwd);
  return { mode: "branch", baseRef: detectedBase, label: `branch diff against ${detectedBase}` };
}

function section(title, body) {
  const trimmed = (body || "").trim();
  return `## ${title}\n\n${trimmed || "(none)"}\n`;
}

export function collectReviewContext(cwd, target) {
  const repoRoot = getRepoRoot(cwd);
  const branch = getCurrentBranch(repoRoot);

  if (target.mode === "working-tree") {
    const state = getWorkingTreeState(repoRoot);
    const status = gitChecked(repoRoot, ["status", "--short", "--untracked-files=all"]).stdout;
    const stagedDiff = gitChecked(repoRoot, ["diff", "--cached", "--no-ext-diff", "--submodule=diff"]).stdout;
    const unstagedDiff = gitChecked(repoRoot, ["diff", "--no-ext-diff", "--submodule=diff"]).stdout;
    // formatUntrackedFile already sanitizes per-file; the diff bodies above
    // are sanitized below at the section-assembly boundary.
    const untrackedBody = state.untracked.map((file) => formatUntrackedFile(repoRoot, file)).join("\n\n");

    const content = [
      section("Git Status", sanitizeForXmlWrap(status)),
      section("Staged Diff", sanitizeForXmlWrap(stagedDiff)),
      section("Unstaged Diff", sanitizeForXmlWrap(unstagedDiff)),
      section("Untracked Files", untrackedBody)
    ].join("\n");

    const summary = `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s) on branch ${branch}.`;
    const isEmpty = !state.isDirty;
    return { content, summary, isEmpty, target, branch };
  }

  // branch mode
  const range = `${target.baseRef}...HEAD`;
  const log = gitChecked(repoRoot, ["log", "--oneline", "--decorate", range]).stdout;
  const stat = gitChecked(repoRoot, ["diff", "--stat", range]).stdout;
  const diff = gitChecked(repoRoot, ["diff", "--no-ext-diff", "--submodule=diff", range]).stdout;
  const fileCount = splitNul(gitChecked(repoRoot, ["diff", "--name-only", "-z", range]).stdout).length;

  const content = [
    section("Commit Log", sanitizeForXmlWrap(log)),
    section("Diff Stat", sanitizeForXmlWrap(stat)),
    section("Branch Diff", sanitizeForXmlWrap(diff))
  ].join("\n");

  const summary = `Reviewing branch ${branch} against ${target.baseRef} (${fileCount} file(s) changed).`;
  const isEmpty = fileCount === 0;
  return { content, summary, isEmpty, target, branch };
}
