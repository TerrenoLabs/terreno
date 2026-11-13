import {describe, expect, it} from "bun:test";

import {SENTRY_V10_DATA_COLLECTION} from "./sentryV10DataCollection";

describe("SENTRY_V10_DATA_COLLECTION", () => {
  it("turns off the data Sentry 11 collects by default", () => {
    expect(SENTRY_V10_DATA_COLLECTION.cookies).toBe(false);
    expect(SENTRY_V10_DATA_COLLECTION.userInfo).toBe(false);
    expect(SENTRY_V10_DATA_COLLECTION.databaseQueryData).toBe(false);
    expect(SENTRY_V10_DATA_COLLECTION.httpBodies).toEqual([]);
    expect(SENTRY_V10_DATA_COLLECTION.genAI).toEqual({inputs: false, outputs: false});
  });

  it("denies IP-like headers and query params", () => {
    const denied = ["forwarded", "-ip", "remote-", "via", "-user"];
    expect(SENTRY_V10_DATA_COLLECTION.httpHeaders).toEqual({
      request: {deny: denied},
      response: {deny: denied},
    });
    expect(SENTRY_V10_DATA_COLLECTION.urlQueryParams).toEqual({deny: denied});
  });
});
