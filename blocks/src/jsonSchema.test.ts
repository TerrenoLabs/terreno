import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import Ajv from "ajv";

import {blocksJsonSchema} from "./jsonSchema";
import {parseBlocks} from "./parse";
import {blocksSchema} from "./schema";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("blocksJsonSchema", () => {
  it("accepts and rejects the same parsed fixtures as the Zod schema", () => {
    const ajv = new Ajv({allErrors: true, strict: false});
    const validate = ajv.compile(blocksJsonSchema);
    const files = [
      ...readdirSync(join(fixturesDir, "valid")).map((name) => join("valid", name)),
      ...readdirSync(join(fixturesDir, "invalid")).map((name) => join("invalid", name)),
    ];
    let compared = 0;
    for (const name of files) {
      const parsed = parseBlocks(readFileSync(join(fixturesDir, name), "utf8"));
      if (!parsed.ok) {
        continue;
      }
      compared += 1;
      const zodOk = blocksSchema.safeParse(parsed.value).success;
      const ajvOk = validate(parsed.value) === true;
      expect(ajvOk).toBe(zodOk);
    }
    expect(compared).toBeGreaterThan(0);
  });
});
