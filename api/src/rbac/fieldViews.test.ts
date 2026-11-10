import {afterEach, describe, expect, it} from "bun:test";
import {assert} from "chai";

import {applyReadMask, getDisallowedWriteKeys} from "./fieldViews";
import type {FieldMask} from "./types";

describe("fieldViews", () => {
  it("applyReadMask picks only allowed read paths", () => {
    const doc = {name: "Todo", ownerId: "u1", secret: "hidden"};
    const masked = applyReadMask(doc, {omit: [], read: ["name", "ownerId"], write: ["name"]});
    expect(masked).toEqual({name: "Todo", ownerId: "u1"});
  });

  it("applyReadMask omits nested paths without mutating the original document", () => {
    const profile = {email: "a@b.com", phone: "555"};
    const doc = {profile};
    const masked = applyReadMask(doc, {
      omit: ["profile.phone"],
      read: "*",
      write: "*",
    });
    expect(masked).toEqual({profile: {email: "a@b.com"}});
    expect(profile.phone).toBe("555");
  });

  it("getDisallowedWriteKeys rejects nested keys outside a dotted write mask", () => {
    const disallowed = getDisallowedWriteKeys(
      {profile: {email: "a@b.com", phone: "555"}},
      {omit: [], read: "*", write: ["profile.email"]}
    );
    expect(disallowed).toEqual(["profile.phone"]);
  });

  it("getDisallowedWriteKeys rejects keys outside the write mask", () => {
    const disallowed = getDisallowedWriteKeys(
      {admin: true, name: "x"},
      {omit: [], read: "*", write: ["name"]}
    );
    expect(disallowed).toEqual(["admin"]);
  });

  it("applyReadMask returns primitives and null untouched", () => {
    const mask: FieldMask = {omit: ["anything"], read: ["name"], write: []};
    assert.equal(applyReadMask("plain", mask), "plain");
    assert.equal(applyReadMask(7, mask), 7);
    assert.isNull(applyReadMask(null, mask));
    assert.isUndefined(applyReadMask(undefined, mask));
  });

  it("applyReadMask maps over arrays, including nested arrays of documents", () => {
    const masked = applyReadMask(
      [{name: "a", secret: "s"}, {name: "b", secret: "s"}, "primitive"],
      {omit: [], read: ["name"], write: []}
    );
    assert.deepEqual(masked, [{name: "a"}, {name: "b"}, "primitive"]);
  });

  it("applyReadMask picks nested paths and skips paths missing from the document", () => {
    const masked = applyReadMask(
      {name: "Todo", profile: {email: "a@b.com", phone: "555"}},
      {omit: [], read: ["profile.email", "profile.missing", "absent.deep", "name"], write: []}
    );
    assert.deepEqual(masked, {name: "Todo", profile: {email: "a@b.com"}});
  });

  it("applyReadMask omits top-level paths and ignores omissions with no parent object", () => {
    const masked = applyReadMask(
      {name: "Todo", profile: {email: "a@b.com"}, secret: "hidden"},
      {omit: ["secret", "missing.deep", "profile.missing"], read: "*", write: []}
    );
    assert.deepEqual(masked, {name: "Todo", profile: {email: "a@b.com"}});
  });

  it("applyReadMask deep clones so mutating the result leaves the document intact", () => {
    const doc = {profile: {tags: ["a"]}};
    const masked = applyReadMask(doc, {omit: [], read: "*", write: []}) as {
      profile: {tags: string[]};
    };
    masked.profile.tags.push("b");
    assert.deepEqual(doc.profile.tags, ["a"]);
  });

  it("getDisallowedWriteKeys allows everything for a wildcard write mask", () => {
    assert.deepEqual(
      getDisallowedWriteKeys(
        {admin: true, profile: {email: "a@b.com"}},
        {
          omit: [],
          read: "*",
          write: "*",
        }
      ),
      []
    );
  });

  it("getDisallowedWriteKeys allows a whole subtree when its parent path is writable", () => {
    assert.deepEqual(
      getDisallowedWriteKeys(
        {profile: {email: "a@b.com", phone: "555"}},
        {
          omit: [],
          read: "*",
          write: ["profile"],
        }
      ),
      []
    );
  });

  it("getDisallowedWriteKeys reports the whole object when no nested path is writable", () => {
    assert.deepEqual(
      getDisallowedWriteKeys(
        {name: "x", profile: {email: "a@b.com"}},
        {
          omit: [],
          read: "*",
          write: ["name"],
        }
      ),
      ["profile"]
    );
  });

  it("getDisallowedWriteKeys returns nothing for an empty body", () => {
    assert.deepEqual(getDisallowedWriteKeys({}, {omit: [], read: "*", write: ["name"]}), []);
  });

  describe("prototype pollution", () => {
    afterEach(() => {
      delete (Object.prototype as Record<string, unknown>).polluted;
      delete (Object.prototype as Record<string, unknown>).__terrenoProbe;
    });

    it("applyReadMask does not copy a __proto__ read path onto Object.prototype", () => {
      const doc = JSON.parse('{"__proto__": {"polluted": "yes"}, "name": "Todo"}');
      const masked = applyReadMask(doc, {
        omit: [],
        read: ["name", "__proto__.polluted", "constructor.prototype.polluted"],
        write: [],
      });
      expect(masked).toEqual({name: "Todo"});
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("applyReadMask does not delete from Object.prototype through an omit path", () => {
      Object.defineProperty(Object.prototype, "__terrenoProbe", {
        configurable: true,
        enumerable: false,
        value: "kept",
        writable: true,
      });
      applyReadMask({name: "Todo"}, {omit: ["__proto__.__terrenoProbe"], read: "*", write: []});
      expect(({} as Record<string, unknown>).__terrenoProbe).toBe("kept");
    });
  });
});
