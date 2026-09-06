// Adapted from codex-plugin-cc (Apache-2.0). See top-level NOTICE.

import { spawnSync, spawn } from "node:child_process";
import process from "node:process";

// Node's spawnSync default maxBuffer is 1MB. Real-world git diffs across a
// branch easily exceed that, throwing ENOBUFS before review can run. 64MB
// gives room for directory-scale reviews without pulling in streaming I/O.
export const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
    stdio: options.stdio ?? "pipe",
    // Always shell:false. With shell:true on Windows, args containing
    // metacharacters (`&`, `|`, `;`, etc.) get interpreted by cmd.exe,
    // creating a command-injection vector when refs or user-supplied
    // arguments flow through. Node's spawn finds .exe binaries on PATH
    // without a shell on Windows; for `.cmd`/`.bat` wrappers a caller
    // can opt in via options.shell.
    shell: options.shell ?? false,
    windowsHide: true
  });

  // Map signaled exits to a non-zero status so runCommandChecked cannot
  // mistake an interrupted git call for success. Otherwise a child killed
  // by SIGTERM/SIGKILL/etc. returns status:null and our `?? 0` fallback
  // would treat partial/empty stdout as a successful run.
  const signal = result.signal ?? null;
  const status = signal ? 128 + signalNumber(signal) : (result.status ?? 0);

  return {
    command,
    args,
    status,
    signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}

export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}

// Stream a child process's stdout/stderr to this process's stdio while
// also returning the exit code, so the user sees output as it arrives
// instead of buffered until completion. (agy is invoked via captureCommand,
// which buffers for marker extraction; this generic streamer remains
// available for other commands.)
//
// When `options.input` is a string, it is written to the child's stdin and
// stdin is closed afterward. This is the route for prompt bodies that
// would otherwise overflow the OS argv length limit (E2BIG) when passed
// inline via `--prompt`.
//
// A signaled exit (SIGTERM, SIGKILL, etc.) reports code === null from Node;
// we surface that as a non-zero status so callers cannot mistake an
// interrupted run for a successful one.
export function streamCommand(command, args = [], options = {}) {
  const hasInput = typeof options.input === "string";
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [hasInput ? "pipe" : "ignore", "inherit", "inherit"],
      windowsHide: true
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        resolve({ status: 128 + signalNumber(signal), signal });
        return;
      }
      resolve({ status: code ?? 0, signal: null });
    });
    if (hasInput) {
      child.stdin.on("error", reject);
      child.stdin.end(options.input);
    }
  });
}

// Remove ANSI CSI escape sequences (ESC '[' params... final byte 0x40-0x7E).
// agy print mode emits clean text; this is defensive. Implemented as a small
// scanner to avoid embedding raw control bytes in a regex literal.
const ESC = String.fromCharCode(27);

export function stripAnsi(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === ESC && text[i + 1] === "[") {
      i += 2;
      while (i < text.length) {
        const code = text.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) break; // final byte
        i += 1;
      }
      continue; // skip the final byte too (loop increment)
    }
    out += text[i];
  }
  return out;
}

// Pure, unit-testable: normalize captured output to clean text — collapse CRLF
// and strip ANSI control sequences.
export function cleanOutput(raw) {
  if (!raw) return "";
  return stripAnsi(String(raw)).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Run `command args...` capturing cleaned stdout and raw stderr, with a hard
// timeout that SIGKILLs a wedged child. Resolves
// { status, signal, stdout, stderr, timedOut }. Never rejects on a non-zero
// child exit; only rejects if the command fails to launch (e.g. ENOENT).
export function captureCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [typeof options.input === "string" ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
      // Own process group (POSIX) so a timeout can kill the entire tree, not
      // just the direct child. Grandchildren that inherited the stdout/stderr
      // pipe would otherwise keep it open, delaying 'close' (and temp-dir
      // cleanup) until they exit. Does not change how we read the pipes here.
      detached: process.platform !== "win32"
    });

    let inputError = null;
    if (typeof options.input === "string") {
      child.stdin.on("error", (error) => { inputError = error; });
      child.stdin.end(options.input);
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancellationSignal = null;
    let settled = false;
    let killTimer = null;
    let deadlineTimer = null;
    let graceTimer = null;
    let closedResult = null;
    let completedBeforeCancel = null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const onInterrupt = () => cancel("SIGINT");
    const onTerminate = () => cancel("SIGTERM");
    if (options.handleSignals) {
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onTerminate);
    }
    function removeSignalHandlers() {
      if (options.handleSignals) {
        process.removeListener("SIGINT", onInterrupt);
        process.removeListener("SIGTERM", onTerminate);
      }
    }
    function cancel(signal) {
      if (settled || timedOut) return;
      if (graceTimer) {
        // A second cancellation skips the remaining graceful shutdown window.
        clearTimeout(graceTimer);
        graceTimer = null;
        terminate();
        if (closedResult) finish(closedResult);
        return;
      }
      if (cancellationSignal || completedBeforeCancel) return;
      if (child.exitCode !== null || child.signalCode !== null) {
        // 'exit' can precede 'close' while descendants keep the pipes open.
        // Release those descendants without discarding the completed response.
        completedBeforeCancel = {
          status: child.signalCode ? 128 + signalNumber(child.signalCode) : child.exitCode,
          signal: child.signalCode
        };
      } else {
        cancellationSignal = signal;
      }
      if (killTimer) clearTimeout(killTimer);
      killProcessTree(child, "SIGTERM");
      graceTimer = setTimeout(() => {
        graceTimer = null;
        terminate();
        if (closedResult) finish(closedResult);
      }, options.killGraceMs ?? 2000);
    }
    function terminate() {
      if (killTimer) clearTimeout(killTimer);
      if (deadlineTimer) return;
      killProcessTree(child);
      // Also settle if a descendant escaped the group but retained a pipe.
      deadlineTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish({ status: 137, signal: "SIGKILL", stdout: cleanOutput(stdout), stderr, timedOut });
      }, options.killGraceMs ?? 2000);
    }

    // Single settle point so the timeout backstop and the 'close' event can't
    // both resolve, and every timer is cleared exactly once.
    function finish(result) {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (graceTimer) clearTimeout(graceTimer);
      removeSignalHandlers();
      if (inputError && result.status === 0) {
        result = { ...result, status: 1, stderr: result.stderr + `\nFailed to deliver stdin: ${inputError.message}\n` };
      }
      resolve(cancellationSignal ? {
        ...result, status: 128 + signalNumber(cancellationSignal),
        signal: cancellationSignal, cancelled: true
      } : { ...result, ...completedBeforeCancel });
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, options.timeoutMs);
    }

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (graceTimer) clearTimeout(graceTimer);
      removeSignalHandlers();
      reject(error);
    });
    child.on("close", (code, signal) => {
      const result = {
        status: signal ? 128 + signalNumber(signal) : (code ?? 0),
        signal: signal ?? null,
        stdout: cleanOutput(stdout),
        stderr,
        timedOut
      };
      // Preserve the grace period for descendants even if the direct child
      // closes its pipes first. The timer force-kills any remaining group.
      if (graceTimer) closedResult = result;
      else finish(result);
    });
  });
}

// Kill a child and any descendants it spawned. On POSIX the child is a process-
// group leader (spawned detached), so a negative PID signals the whole group.
// Falls back to a direct kill if the group is already gone or on Windows.
function killProcessTree(child, signal = "SIGKILL") {
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already exited — nothing to kill.
    }
  }
}

function signalNumber(signal) {
  // Standard shell convention: status = 128 + signal number. We don't need
  // the exact mapping for every platform; pick a stable nonzero default
  // (15 = SIGTERM) when the name isn't a known number we want to encode.
  const known = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15, SIGPIPE: 13, SIGHUP: 1, SIGQUIT: 3 };
  return known[signal] ?? 15;
}
