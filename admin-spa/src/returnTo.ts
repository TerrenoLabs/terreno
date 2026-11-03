/**
 * Accept a post-login destination only when it is an in-app path: one leading `/`, no second
 * `/` right after it, no backslash and no scheme. Anything else (an absolute URL, a
 * protocol-relative `//host`, `/\host`, a relative path) is an open redirect and yields
 * undefined. A repeated query parameter uses its first value.
 */
export const sanitizeReturnTo = (value: string | string[] | undefined): string | undefined => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) {
    return undefined;
  }
  if (candidate.includes("\\")) {
    return undefined;
  }
  return candidate;
};
