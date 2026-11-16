import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD)/i;
const URI_NAME = /(_URI|_URL)$/i;
const CREDENTIAL_URL = /:\/\/[^/\s:@]+:[^/\s@]+@/;
const URL_PASSWORD = /(:\/\/[^/\s:@]+:)([^/\s@]+)(@)/g;
const REDACTED = "[redacted]";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isSecretEnv = (name: string, value: string): boolean => {
  if (SECRET_NAME.test(name)) {
    return true;
  }
  return URI_NAME.test(name) && CREDENTIAL_URL.test(value);
};

/** Values from `.env*` files under the app, skipping heavy directories. */
export const collectEnvFileValues = (appDir: string): string[] => {
  const values: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || !existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") {
        continue;
      }
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.startsWith(".env")) {
        continue;
      }
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const match = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
        const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
        if (value) {
          values.push(value);
        }
      }
    }
  };
  walk(appDir, 0);
  return values;
};

/**
 * Replaces secret values with `[redacted]`: env vars named like secrets, credentials inside
 * connection URLs, and every value found in the app's `.env*` files.
 */
export const redact = (
  text: string,
  env: Record<string, string | undefined>,
  extraValues: string[] = []
): string => {
  const secrets = new Set<string>(extraValues.filter((value) => value.length > 0));
  for (const [name, value] of Object.entries(env)) {
    if (value && isSecretEnv(name, value)) {
      secrets.add(value);
    }
  }
  let result = text;
  // Longest first so a secret that contains another is replaced whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    result = result.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  return result.replace(URL_PASSWORD, `$1${REDACTED}$3`);
};
