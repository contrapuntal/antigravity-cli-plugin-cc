// Adapted from codex-plugin-cc (Apache-2.0). See top-level NOTICE.

export function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options = {};
  const positionals = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (passthrough) {
      positionals.push(token);
      continue;
    }

    if (token === "--") {
      passthrough = true;
      continue;
    }

    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    if (token.startsWith("--")) {
      const [rawKey, inlineValue] = token.slice(2).split("=", 2);
      const key = aliasMap[rawKey] ?? rawKey;

      if (booleanOptions.has(key)) {
        options[key] = inlineValue === undefined ? true : inlineValue !== "false";
        continue;
      }

      if (valueOptions.has(key)) {
        const nextValue = inlineValue ?? argv[index + 1];
        if (nextValue === undefined) {
          throw new Error(`Missing value for --${rawKey}`);
        }
        options[key] = nextValue;
        if (inlineValue === undefined) {
          index += 1;
        }
        continue;
      }

      positionals.push(token);
      continue;
    }

    const shortKey = token.slice(1);
    const key = aliasMap[shortKey] ?? shortKey;

    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }

    if (valueOptions.has(key)) {
      const nextValue = argv[index + 1];
      if (nextValue === undefined) {
        throw new Error(`Missing value for -${shortKey}`);
      }
      options[key] = nextValue;
      index += 1;
      continue;
    }

    positionals.push(token);
  }

  return { options, positionals };
}

export function splitRawArgumentString(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const character of raw) {
    if (escaping) {
      // Consume the backslash only when it escapes whitespace, the active
      // quote, or another backslash. Otherwise keep it literal so Windows
      // paths (C:\src\file) and regexes (/\d+/) survive tokenization intact.
      if (/\s/.test(character) || character === quote || character === "\\") {
        current += character;
      } else {
        current += "\\" + character;
      }
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += "\\";
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

// agy's print mode takes --model with either a display name (e.g.
// "Gemini 3.8 Flash (Low)") or a model ID (e.g. "gemini-3.8-flash-low") as
// listed by `agy models`. No name is pinned here on purpose: agy's catalog
// rotates upstream and --model is strictly validated, so a stale example
// becomes a wrong one. Values pass through unchanged; the alias map is a hook
// for future shorthand (e.g. "flash") and currently empty.
const MODEL_ALIASES = {};

export function resolveModelAlias(model) {
  if (!model) return null;
  return MODEL_ALIASES[model] ?? model;
}

// Reviews default to whatever model the user has selected in the agy TUI; the
// plugin pins no default (agy model values are display names that vary by
// account and version). null means "pass no --model flag". An explicit
// --model on the command overrides this.
export const DEFAULT_REVIEW_MODEL = null;
