import {describe, it} from "bun:test";
import {assert} from "chai";

import {getAiSessionId} from "./aiSession";

describe("getAiSessionId", () => {
  it("returns the same random UUID for every call in one app run", () => {
    const first = getAiSessionId();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(getAiSessionId(), first);
  });
});
