import {describe, it} from "bun:test";
import {assert} from "chai";

import {
  assertSyncCollectionName,
  assertTsIdentifier,
  emitTsPropertyKey,
  emitTsString,
} from "./safeIdentifiers";

describe("assertTsIdentifier", () => {
  it("accepts TypeScript identifiers", () => {
    assert.equal(assertTsIdentifier({label: "name", value: "Todo"}), "Todo");
    assert.equal(assertTsIdentifier({label: "name", value: "_id"}), "_id");
  });

  it("rejects quote and statement injection", () => {
    assert.throws(
      () => assertTsIdentifier({label: "collection", value: 'todos"; process.exit(1); //'}),
      /not a TypeScript identifier/
    );
  });
});

describe("assertSyncCollectionName", () => {
  it("accepts hyphenated collection names", () => {
    assert.equal(
      assertSyncCollectionName({label: "collection", value: "notification-preferences"}),
      "notification-preferences"
    );
  });

  it("accepts collection tags derived from nested route paths", () => {
    assert.equal(
      assertSyncCollectionName({label: "collection", value: "gpt/histories"}),
      "gpt/histories"
    );
    assert.equal(
      assertSyncCollectionName({label: "collection", value: "mcp/service-tokens"}),
      "mcp/service-tokens"
    );
  });

  it("rejects empty, leading, trailing, and doubled path segments", () => {
    for (const value of ["/gpt", "gpt/", "gpt//histories", "gpt/../histories", ""]) {
      assert.throws(
        () => assertSyncCollectionName({label: "collection", value}),
        /not a valid sync collection name/
      );
    }
  });

  it("rejects unsafe collection names", () => {
    assert.throws(
      () =>
        assertSyncCollectionName({
          label: "collection",
          value: 'notifications"; process.exit(1); //',
        }),
      /not a valid sync collection name/
    );
  });
});

describe("emitTsString", () => {
  it("JSON-escapes quotes so they cannot close a generated string", () => {
    assert.equal(emitTsString('todos"; process.exit(1); //'), '"todos\\"; process.exit(1); //"');
  });
});

describe("emitTsPropertyKey", () => {
  it("emits bare identifiers", () => {
    assert.equal(emitTsPropertyKey("title"), "title");
  });

  it("quotes keys that are not identifiers", () => {
    assert.equal(emitTsPropertyKey('foo"; bar'), '"foo\\"; bar"');
  });
});
