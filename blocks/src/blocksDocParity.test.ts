import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {BLOCK_ERROR_CODES, BLOCK_WARNING_CODES} from "./errors";

const reference = readFileSync(
  join(import.meta.dir, "..", "..", "docs", "reference", "blocks.md"),
  "utf8"
);

describe("blocks reference parity", () => {
  it("names every error and warning code", () => {
    for (const code of Object.keys(BLOCK_ERROR_CODES)) {
      expect(reference).toContain(`\`${code}\``);
    }
    for (const code of Object.keys(BLOCK_WARNING_CODES)) {
      expect(reference).toContain(`\`${code}\``);
    }
  });
});
