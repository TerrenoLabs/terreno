import {describe, expect, it} from "bun:test";
import {DateTime} from "luxon";

import {generateEntityId, generateObjectId, isObjectIdHex} from "./entityIds";

describe("generateObjectId", () => {
  it("mints a 24-hex id whose first 4 bytes are the current Unix seconds", () => {
    const before = Math.floor(DateTime.now().toSeconds());
    const id = generateObjectId();
    const after = Math.floor(DateTime.now().toSeconds());
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    const seconds = Number.parseInt(id.slice(0, 8), 16);
    expect(seconds).toBeGreaterThanOrEqual(before);
    expect(seconds).toBeLessThanOrEqual(after);
  });

  it("encodes the timestamp big-endian and zero-pads it", () => {
    expect(generateObjectId({nowSeconds: 1}).slice(0, 8)).toBe("00000001");
    expect(generateObjectId({nowSeconds: 0x65f0c0de}).slice(0, 8)).toBe("65f0c0de");
  });

  it("fills the tail from the random source when crypto.getRandomValues is missing", () => {
    const original = globalThis.crypto.getRandomValues;
    try {
      (globalThis.crypto as {getRandomValues?: unknown}).getRandomValues = undefined;
      expect(generateObjectId({nowSeconds: 1, random: () => 0.5})).toBe(
        `00000001${"80".repeat(8)}`
      );
    } finally {
      globalThis.crypto.getRandomValues = original;
    }
  });

  it("does not repeat across many ids minted in the same second", () => {
    const ids = new Set(Array.from({length: 10_000}, () => generateObjectId({nowSeconds: 1})));
    expect(ids.size).toBe(10_000);
  });
});

describe("generateEntityId", () => {
  it("mints a UUID by default and an ObjectId for objectId collections", () => {
    expect(generateEntityId(undefined)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(generateEntityId("uuid")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(isObjectIdHex(generateEntityId("objectId"))).toBe(true);
  });
});

describe("isObjectIdHex", () => {
  it("accepts only 24 hex characters", () => {
    expect(isObjectIdHex("65f0c0ffee0000000000ABCD")).toBe(true);
    expect(isObjectIdHex("abcdefghijkl")).toBe(false);
    expect(isObjectIdHex(crypto.randomUUID())).toBe(false);
    expect(isObjectIdHex("65f0c0ffee0000000000abcd0")).toBe(false);
  });
});
