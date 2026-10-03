import {describe, expect, it} from "bun:test";

import {type BlockError, sortBlockErrors} from "./errors";

const error = (path: string, code: BlockError["code"]): BlockError => ({
  code,
  fix: "Fix it.",
  message: "Bad.",
  path,
});

describe("sortBlockErrors", () => {
  it("orders shorter paths first, indexes numerically, and codes alphabetically", () => {
    const sorted = sortBlockErrors([
      error("blocks[10].text", "TOO_LONG"),
      error("blocks[2].text", "MISSING_REQUIRED"),
      error("blocks[2].text", "INVALID_TYPE"),
      error("blocks[2]", "UNKNOWN_KEY"),
      error("blocks.name", "INVALID_ENUM"),
    ]);
    expect(sorted.map((item) => `${item.path} ${item.code}`)).toEqual([
      "blocks[2] UNKNOWN_KEY",
      "blocks[2].text INVALID_TYPE",
      "blocks[2].text MISSING_REQUIRED",
      "blocks[10].text TOO_LONG",
      "blocks.name INVALID_ENUM",
    ]);
  });
});
