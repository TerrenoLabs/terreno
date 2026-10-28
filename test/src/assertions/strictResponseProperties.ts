const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Lists the dot-separated path of every property in `value`. Arrays add no path segment, so
 * `{data: [{email}]}` yields `data` and `data.email`; that lets one allowlist cover list and
 * single-document responses.
 */
export const collectPropertyPaths = (value: unknown, prefix = ""): string[] => {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => collectPropertyPaths(item, prefix)))];
  }
  if (!isPlainObject(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...collectPropertyPaths(child, path)];
  });
};

const isPathAllowed = (path: string, allowedPaths: string[]): boolean =>
  allowedPaths.some(
    (allowed) =>
      allowed === path || allowed.startsWith(`${path}.`) || path.startsWith(`${allowed}.`)
  );

/**
 * Fails when a response exposes any property outside `allowedPaths`.
 *
 * Guards permission-scoped endpoints against leaking fields (PHI, secrets) when someone adds a
 * field to a model or a populate. A path is allowed when it is listed, is an ancestor of a listed
 * path, or sits under a listed path (listing `address` allows `address.city`).
 */
export const assertStrictResponseProperties = (body: unknown, allowedPaths: string[]): void => {
  const unexpected = collectPropertyPaths(body).filter(
    (path) => !isPathAllowed(path, allowedPaths)
  );
  if (unexpected.length > 0) {
    throw new Error(`Unexpected field(s) in response: ${unexpected.join(", ")}`);
  }
};
