/// <reference types="node" />
/**
 * `@terreno/syncdb/buildNumber` — node-only helpers for `app.config.ts` that
 * stamp `extra.buildNumber`, which `useUpgradeCheck` sends to `/version-check`.
 * Never import this from app runtime code: it shells out to git.
 */
import {execSync} from "node:child_process";

/**
 * Coerce a value to a valid build number (finite positive integer), or undefined.
 * Useful for validating build numbers from environment variables, config overrides, etc.
 */
export const coerceBuildNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
};

interface ResolveBuildNumberOptions {
  /** Hard-coded override — set to a number to test version-check behavior locally. */
  override?: number;
  /** Existing build number from Expo config (`config.extra?.buildNumber`). */
  configValue?: unknown;
  /** Environment variable name to read (default: `"EXPO_PUBLIC_BUILD_NUMBER"`). */
  envVar?: string;
}

/**
 * Resolve a build number using the standard Terreno priority chain:
 *   1. `override` (for local testing)
 *   2. `configValue` (from existing Expo config / EAS Build)
 *   3. `EXPO_PUBLIC_BUILD_NUMBER` env var (or custom `envVar`)
 *   4. `git rev-list --count HEAD`
 *   5. `undefined` (version check will be skipped)
 *
 * Import this in your `app.config.ts` to avoid duplicating the resolution logic:
 * ```ts
 * import {resolveBuildNumber} from "@terreno/syncdb/buildNumber";
 *
 * export default ({config}) => ({
 *   ...config,
 *   extra: {...config.extra, buildNumber: resolveBuildNumber({configValue: config.extra?.buildNumber})},
 * });
 * ```
 */
export const resolveBuildNumber = (options: ResolveBuildNumberOptions = {}): number | undefined => {
  const {override, configValue, envVar = "EXPO_PUBLIC_BUILD_NUMBER"} = options;

  const fromOverride = coerceBuildNumber(override);
  if (fromOverride !== undefined) {
    return fromOverride;
  }

  const fromConfig = coerceBuildNumber(configValue);
  if (fromConfig !== undefined) {
    return fromConfig;
  }

  const envValue = process.env[envVar];
  if (envValue) {
    const fromEnv = coerceBuildNumber(envValue);
    if (fromEnv !== undefined) {
      return fromEnv;
    }
  }

  try {
    return parseInt(execSync("git rev-list --count HEAD").toString().trim(), 10);
  } catch {
    // Leave undefined so the version check is skipped in environments without git
    return undefined;
  }
};
