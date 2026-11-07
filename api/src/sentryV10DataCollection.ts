import type {BunOptions} from "@sentry/bun";

/**
 * Sentry v11 collects more request/user data by default than v10 did with `sendDefaultPii` unset.
 * Use this baseline anywhere `@sentry/bun` v11 is initialized so behavior matches the prior major.
 */
export const SENTRY_V10_DATA_COLLECTION: NonNullable<BunOptions["dataCollection"]> = {
  cookies: false,
  databaseQueryData: false,
  genAI: {inputs: false, outputs: false},
  graphQL: {document: false, variables: false},
  httpBodies: [],
  httpHeaders: {
    request: {deny: ["forwarded", "-ip", "remote-", "via", "-user"]},
    response: {deny: ["forwarded", "-ip", "remote-", "via", "-user"]},
  },
  urlQueryParams: {deny: ["forwarded", "-ip", "remote-", "via", "-user"]},
  userInfo: false,
};
