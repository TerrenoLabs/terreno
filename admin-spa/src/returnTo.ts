// Any ASCII control character or whitespace; a valid in-app path never contains one.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const UNSAFE_RETURN_TO_CHARS = /[\u0000-\u001f\u007f\s\\]/;

/**
 * Accept a post-login destination only when it is an in-app path ("/oauth/consent?request=abc"):
 * one leading `/`, no second `/` right after it, no backslash, whitespace or control character,
 * and not the login page itself. Anything else (an absolute URL, a protocol-relative `//host`,
 * `/\\host`, a relative path) is an open redirect and yields undefined. A repeated query
 * parameter uses its first value. The server gate and the client share this one rule.
 */
export const sanitizeReturnTo = (value: unknown): string | undefined => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return undefined;
  }
  if (UNSAFE_RETURN_TO_CHARS.test(candidate) || candidate.startsWith("/login")) {
    return undefined;
  }
  return candidate;
};
