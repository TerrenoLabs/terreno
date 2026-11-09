export type FlagValue = string | boolean | string[];

export interface ParsedArgs {
  flags: Record<string, FlagValue>;
  positionals: string[];
}

const appendFlag = (flags: Record<string, FlagValue>, key: string, value: string): void => {
  const existing = flags[key];
  if (existing === undefined) {
    flags[key] = value;
    return;
  }
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  flags[key] = [String(existing), value];
};

export const parseArgs = (argv: string[]): ParsedArgs => {
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) {
      continue;
    }
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq >= 0) {
        appendFlag(flags, token.slice(2, eq), token.slice(eq + 1));
        continue;
      }
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        flags[key] = true;
        continue;
      }
      appendFlag(flags, key, next);
      i += 1;
      continue;
    }
    if (token.startsWith("-") && token.length === 2 && token !== "-") {
      const key = token.slice(1);
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        flags[key] = true;
        continue;
      }
      appendFlag(flags, key, next);
      i += 1;
      continue;
    }
    positionals.push(token);
  }

  return {flags, positionals};
};

export const flagBoolean = (flags: Record<string, FlagValue>, ...keys: string[]): boolean => {
  for (const key of keys) {
    const value = flags[key];
    if (value === true || value === "true" || value === "1") {
      return true;
    }
  }
  return false;
};

export const flagString = (
  flags: Record<string, FlagValue>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = flags[key];
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value) && typeof value[value.length - 1] === "string") {
      return value[value.length - 1];
    }
  }
  return undefined;
};

export const flagList = (flags: Record<string, FlagValue>, ...keys: string[]): string[] => {
  const values: string[] = [];
  for (const key of keys) {
    const value = flags[key];
    if (typeof value === "string") {
      values.push(value);
      continue;
    }
    if (Array.isArray(value)) {
      values.push(...value);
    }
  }
  return values;
};
