export const MIN_VERSION = "58.0.0";
export const LOCAL_VERSION = "local";

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

export const parseSemver = (version: string): [number, number, number] | undefined => {
  const match = STABLE.exec(version);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

export const compareSemver = (a: string, b: string): number => {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) {
    return a.localeCompare(b);
  }
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
};

export interface ListVersionsOptions {
  fromVersion?: string;
  includeLocal?: boolean;
}

/** Throws when `fromVersion` is below the supported floor. */
export const assertSupportedFloor = (fromVersion: string): void => {
  if (!parseSemver(fromVersion) || compareSemver(fromVersion, MIN_VERSION) < 0) {
    throw new Error(`--from-version ${fromVersion} is below the ${MIN_VERSION} floor`);
  }
};

/**
 * Every stable release at or above `fromVersion` (default and floor 58.0.0), ascending,
 * prereleases excluded, then `local` last unless `includeLocal` is false.
 */
export const listVersions = (
  registryJson: {versions?: Record<string, unknown>} | string[],
  {fromVersion = MIN_VERSION, includeLocal = true}: ListVersionsOptions = {}
): string[] => {
  assertSupportedFloor(fromVersion);
  const all = Array.isArray(registryJson) ? registryJson : Object.keys(registryJson.versions ?? {});
  const stable = all
    .filter((version) => parseSemver(version) && compareSemver(version, fromVersion) >= 0)
    .sort(compareSemver);
  return includeLocal ? [...stable, LOCAL_VERSION] : stable;
};

export const fetchRegistryVersions = async (
  fetchImpl: typeof fetch = fetch
): Promise<{versions: Record<string, unknown>}> => {
  const response = await fetchImpl("https://registry.npmjs.org/create-terreno-app");
  if (!response.ok) {
    throw new Error(`npm registry returned ${String(response.status)}`);
  }
  return (await response.json()) as {versions: Record<string, unknown>};
};
