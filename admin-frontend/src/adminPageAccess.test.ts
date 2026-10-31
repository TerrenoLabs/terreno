import {describe, it} from "bun:test";
import {assert} from "chai";

import {isAdminPageForbiddenError} from "./adminPageAccess";

describe("isAdminPageForbiddenError", () => {
  it("detects 403 errors across request error shapes", () => {
    assert.isTrue(isAdminPageForbiddenError({status: 403}));
    assert.isTrue(isAdminPageForbiddenError({originalStatus: 403, status: "FETCH_ERROR"}));
    assert.isTrue(isAdminPageForbiddenError({status: {status: 403}}));
  });

  it("ignores other failures", () => {
    assert.isFalse(isAdminPageForbiddenError(undefined));
    assert.isFalse(isAdminPageForbiddenError({status: 500}));
    assert.isFalse(isAdminPageForbiddenError(new Error("Failed to load")));
  });
});
