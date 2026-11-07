import {describe, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

import {
  collectSourceRuleViolations,
  collectSourceRuleViolationsInFile,
  isScopedProductionFile,
} from "./lib";

const fixture = (
  relativePath: string,
  source: string
): ReturnType<typeof collectSourceRuleViolationsInFile> => {
  return collectSourceRuleViolationsInFile({relativePath, source});
};

const rulesOf = (source: string): string[] => {
  return fixture("api/src/sample.ts", source).map((violation) => violation.rule);
};

describe("source-rules scanner", () => {
  it("skips tests, isolated files, and generated SDKs", () => {
    assert.isFalse(isScopedProductionFile("api/src/foo.test.ts"));
    assert.isFalse(isScopedProductionFile("ai/src/isolated/gptStream.isolated.ts"));
    assert.isFalse(isScopedProductionFile("example-frontend/app/index.tsx"));
    assert.isFalse(isScopedProductionFile("demo/stories/Button.tsx"));
    assert.isFalse(isScopedProductionFile("scripts/check-source-rules/lib.ts"));
    assert.isTrue(isScopedProductionFile("api/src/plugins.ts"));
    assert.isTrue(isScopedProductionFile("ui/src/Button.tsx"));
    assert.isFalse(isScopedProductionFile("ui/src/types/react-dom.d.ts"));
  });

  it("fails a new production file that uses banned forms", () => {
    const source = `
export function loadNow() {
  const stamp = Date.now();
  console.log(stamp);
  throw new Error("nope");
  void Model.findOne({id: "1"});
  return value as any;
}
`;
    const rules = [...new Set(rulesOf(source))];
    assert.includeMembers(rules, [
      "as-any",
      "console-log",
      "date",
      "find-one",
      "function-declaration",
      "throw-new-error",
    ]);
  });

  it("allows mongoose this-bound hooks, collection.findOne, overloads, and biome-ignored any", () => {
    const source = `
export function modelRouter<T>(path: string, model: ModelLike<T>): Router;
export function modelRouter<T>(model: ModelLike<T>): Router;
export function modelRouter<T>(pathOrModel: string | ModelLike<T>): Router {
  return pathOrModel as Router;
}

schema.pre("save", function () {
  this.updated = DateTime.now();
});

schema.statics.findOneOrNone = async function (filter: object) {
  return this.find(filter);
};

userSchema.method("getDisplayName", function (this: UserDocument): string {
  return this.name;
});

const preQueryWrite = async function (this: Query<unknown, never>): Promise<void> {
  return;
};

mongoose.Query.prototype.exec = function () {
  return originalExec.call(this);
};

const hiddenDoc = await model.collection.findOne({_id: id});

schema.pre<Query<unknown, unknown>>("find", function () {
  return;
});

schema.pre("deleteOne", {document: true, query: false}, function () {
  return;
});

schema.virtual("ownerId").get(function () {
  return;
});

// biome-ignore lint/suspicious/noExplicitAny: schema generic
const schemaType = model as any;
void schemaType;
`;
    assert.deepEqual(rulesOf(source), []);
  });

  it("allows async mongoose hooks with blanked string args", () => {
    const source = `
schema.pre("save", async function () {
  this.updated = DateTime.now();
});
`;
    assert.deepEqual(rulesOf(source), []);
  });

  it("does not let a nearby mongoose hook whitelist a later function", () => {
    const source = `
schema.pre("save", () => {
  return;
});

export function leaked() {
  return 1;
}
`;
    assert.deepEqual(rulesOf(source), ["function-declaration"]);
  });

  it("still flags const name = function () assignments", () => {
    const rules = rulesOf("export const load = function () {\n  return 1;\n}\n");
    assert.deepEqual(rules, ["function-declaration"]);
  });

  it("ignores comments and allows console.info", () => {
    const source = `
export const log = (): void => {
  // console.log("debug");
  console.info("ok");
};
`;
    assert.deepEqual(rulesOf(source), []);
  });

  it("does not flag findOneAndUpdate or findOneOrNone", () => {
    const source = `
export const load = async (): Promise<void> => {
  await Model.findOneAndUpdate({id: "1"}, {name: "x"});
  await findOneOrNoneFor(Model, {id: "1"});
};
`;
    assert.deepEqual(rulesOf(source), []);
  });

  it("fails the repo walk when a new scoped file trips a rule", () => {
    const root = mkdtempSync(join(tmpdir(), "terreno-source-rules-"));
    try {
      mkdirSync(join(root, "api/src"), {recursive: true});
      writeFileSync(join(root, "api/src/ok.ts"), 'export const ping = (): string => "ok";\n');
      writeFileSync(
        join(root, "api/src/bad.ts"),
        'export function boom() { throw new Error("x"); }\n'
      );
      writeFileSync(
        join(root, "api/src/ok.test.ts"),
        "export function testHelper() { Date.now(); }\n"
      );

      const violations = collectSourceRuleViolations(root);
      assert.equal(violations.length, 2);
      assert.isTrue(violations.every((violation) => violation.file === "api/src/bad.ts"));
    } finally {
      rmSync(root, {force: true, recursive: true});
    }
  });
});
