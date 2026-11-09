import {describe, it} from "bun:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import bunTypesPackage from "bun-types/package.json" with {type: "json"};
import {assert} from "chai";

const require = createRequire(import.meta.url);

describe("bun-types", (): void => {
  it("ships the test-globals types this repo references", (): void => {
    assert.equal(bunTypesPackage.name, "bun-types");
    assert.equal(bunTypesPackage.types, "./index.d.ts");
    const testGlobalsPath = require.resolve("bun-types/test-globals.d.ts");
    const contents = readFileSync(testGlobalsPath, "utf8");
    assert.include(contents, "describe");
  });
});
