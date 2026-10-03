import {expect} from "bun:test";

import {HARNESS_ERRORS, type HarnessErrorKindName} from "../harness/errors";

/**
 * Asymmetric matcher for a harness `APIError`: its stable `code` and `title` for `kind`, and
 * a `detail` that contains `detail` (a string) or matches it (a RegExp). Use with
 * `toThrow(...)`, `rejects.toThrow(...)`, or `toEqual(...)`.
 */
export const harnessErrorMatching = (
  kind: HarnessErrorKindName,
  detail: string | RegExp
): unknown => {
  const {code, status, title} = HARNESS_ERRORS[kind];
  return expect.objectContaining({
    code,
    detail:
      typeof detail === "string" ? expect.stringContaining(detail) : expect.stringMatching(detail),
    message: title,
    status,
  });
};
