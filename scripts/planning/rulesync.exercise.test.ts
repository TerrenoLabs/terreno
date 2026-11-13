import {describe, it} from "bun:test";
import {assert} from "chai";
import {ALL_FEATURES, ALL_TOOL_TARGETS, generate} from "rulesync";

describe("rulesync", (): void => {
  it("lists the Cursor and skills targets this repo generates", (): void => {
    assert.include([...ALL_TOOL_TARGETS], "cursor");
    assert.include([...ALL_FEATURES], "skills");
  });

  it("dry-runs generate for Cursor skills without writing", async (): Promise<void> => {
    const result = await generate({
      dryRun: true,
      features: ["skills"],
      silent: true,
      targets: ["cursor"],
    });

    assert.isNumber(result.skillsCount);
    assert.isNumber(result.rulesCount);
    assert.isArray(result.skillsPaths);
  });
});
