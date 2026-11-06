import {describe, it} from "bun:test";
import {assert} from "chai";

import {asJsonBody, withQueryString} from "./adminRpc";

describe("withQueryString", () => {
  it("omits empty params and stringifies the rest", () => {
    assert.strictEqual(withQueryString({url: "/comms/messages"}), "/comms/messages");
    assert.strictEqual(
      withQueryString({params: {limit: 20, page: 1, q: ""}, url: "/comms/messages"}),
      "/comms/messages?limit=20&page=1"
    );
  });

  it("repeats the key for each non-empty list entry", () => {
    assert.strictEqual(
      withQueryString({
        params: {limit: 20, prompt: ["summarize", "", "title"]},
        url: "/ai/observability/traces",
      }),
      "/ai/observability/traces?limit=20&prompt=summarize&prompt=title"
    );
  });

  it("asJsonBody preserves JSON objects for adminRequest", () => {
    assert.deepEqual(asJsonBody({kind: "bulk-patch"}), {kind: "bulk-patch"});
  });
});
