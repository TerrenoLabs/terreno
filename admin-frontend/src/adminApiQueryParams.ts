import qs from "qs";

/**
 * Serializes admin list query params for modelRouter-compatible GET requests.
 * Uses bracket notation for nested operators (`$in`, `$regex`, ranges).
 */
const serializeAdminApiQueryParams = (params: Record<string, unknown>): string => {
  return qs.stringify(params);
};

/** Builds a list URL with a pre-serialized query string (avoids base-query object coercion). */
const buildAdminApiListQueryUrl = (
  routePath: string,
  params: Record<string, unknown> | undefined
): string => {
  if (!params || Object.keys(params).length === 0) {
    return routePath;
  }
  const queryString = serializeAdminApiQueryParams(params);
  if (queryString === "") {
    return routePath;
  }
  return `${routePath}?${queryString}`;
};

/** List request shape (method + serialized URL) for admin model routes. */
export const buildAdminApiListQueryRequest = (
  routePath: string,
  params: Record<string, unknown> | undefined
): {method: "GET"; url: string} => ({
  method: "GET",
  url: buildAdminApiListQueryUrl(routePath, params),
});
