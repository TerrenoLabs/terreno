import {describe, it} from "bun:test";
import {assert} from "chai";

import {compileTemplate} from "./compileTemplate";

describe("compileTemplate", () => {
  it("replaces {{var}} placeholders from the variable map", () => {
    assert.equal(compileTemplate("Hello {{name}}", {name: "Ada"}), "Hello Ada");
  });

  it("leaves unknown placeholders empty", () => {
    assert.equal(compileTemplate("Hello {{name}}", {}), "Hello ");
  });
});
