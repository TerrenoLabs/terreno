import {describe, it} from "bun:test";
import {assert} from "chai";

import {getAiSessionId} from "./aiSession";

describe("getAiSessionId", () => {
  it("returns the same id for every call in one app run", () => {
    const first = getAiSessionId();
    assert.isNotEmpty(first);
    assert.equal(getAiSessionId(), first);
  });
});
