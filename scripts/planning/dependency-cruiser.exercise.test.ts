import {describe, it} from "bun:test";
import {assert} from "chai";
import {allExtensions, cruise} from "dependency-cruiser";

describe("dependency-cruiser", (): void => {
  it("lists TypeScript as a supported extension", (): void => {
    const typescript = allExtensions.find((extension) => extension.extension === ".ts");
    assert.isDefined(typescript);
    assert.isTrue(typescript?.available);
  });

  it("cruises a planning script and reports no circular imports", async (): Promise<void> => {
    const result = await cruise(["scripts/planning/updateDependenciesPr.ts"], {
      ruleSet: {
        forbidden: [
          {
            from: {},
            name: "no-circular",
            severity: "error",
            to: {circular: true},
          },
        ],
      },
      skipAnalysisNotInRules: true,
    });

    assert.equal(result.exitCode, 0);
    assert.isObject(result.output);
    if (typeof result.output === "string") {
      assert.fail("expected structured cruise output");
    }
    assert.isAbove(result.output.modules.length, 0);
  });
});
