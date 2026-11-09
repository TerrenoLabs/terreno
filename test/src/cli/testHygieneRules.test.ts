import {describe, expect, it} from "bun:test";

import {
  type HygieneRuleConfig,
  type HygieneRuleId,
  resolvesToBarrel,
  runHygieneRules,
} from "./testHygieneRules";

const ROOT = "/repo/app";

/** A template-literal substitution written into synthetic source text. */
const PLACEHOLDER = ["$", "{n}"].join("");

const BASE_CONFIG: HygieneRuleConfig = {
  barrelAliases: ["@hooks", "@store/*"],
  barrelMockAllowlist: ["tests/mocks/**"],
  barrelPaths: ["hooks", "store/sdk"],
  mockHelperModules: ["bunModuleAliases"],
  realExportGetterModules: ["realModuleSnapshots"],
  realExportGetterNamePattern: "^getReal[A-Za-z]*Exports$",
  rootDir: ROOT,
};

const check = ({
  source,
  file = "hooks/foo.test.ts",
  rule,
  config = BASE_CONFIG,
}: {
  source: string | string[];
  file?: string;
  rule: HygieneRuleId;
  config?: HygieneRuleConfig;
}): {lines: number[]; messages: string[]} => {
  const {violations} = runHygieneRules({
    config,
    fileName: `${ROOT}/${file}`,
    rules: [rule],
    sourceText: Array.isArray(source) ? source.join("\n") : source,
  });
  return {lines: violations.map((v) => v.line), messages: violations.map((v) => v.message)};
};

describe("no-module-scope-mock-module", () => {
  const rule = "no-module-scope-mock-module";

  it("flags a direct module-scope mock.module()", () => {
    expect(
      check({rule, source: ['import {mock} from "bun:test";', 'mock.module("./x", () => ({}));']})
        .lines
    ).toEqual([2]);
  });

  it("allows mock.module() inside beforeEach and describe callbacks", () => {
    const source = [
      "beforeEach(() => {",
      '  mock.module("./x", () => ({}));',
      "});",
      'describe("d", () => {',
      '  mock.module("./y", () => ({}));',
      "});",
    ];
    expect(check({rule, source}).lines).toEqual([]);
  });

  it("flags module-scope calls to same-file helpers that transitively register mocks", () => {
    const source = [
      'const inner = (): void => { mock.module("./x", () => ({})); };',
      "function outer(): void { inner(); }",
      "const unrelated = (): number => 1;",
      "outer();",
      "unrelated();",
      "beforeEach(() => outer());",
    ];
    expect(check({rule, source}).lines).toEqual([4]);
  });

  it("does not loop on recursive helpers", () => {
    const source = ["function a(): void { b(); }", "function b(): void { a(); }", "a();"];
    expect(check({rule, source}).lines).toEqual([]);
  });

  it("flags imported mock helpers at module scope but not inside hooks", () => {
    const source = [
      'import {mockHooks} from "../tests/mocks/bunModuleAliases";',
      "mockHooks(() => ({}));",
      "beforeAll(() => { mockHooks(() => ({})); });",
      "const setup = (): void => { mockHooks(() => ({})); };",
      "setup();",
    ];
    expect(check({rule, source}).lines).toEqual([2, 5]);
  });

  it("ignores helper modules when none are configured", () => {
    const source = ['import {mockHooks} from "./bunModuleAliases";', "mockHooks(() => ({}));"];
    expect(check({config: {rootDir: ROOT}, rule, source}).lines).toEqual([]);
  });
});

describe("no-direct-barrel-mock", () => {
  const rule = "no-direct-barrel-mock";

  it("flags alias and relative barrel specifiers, including index files", () => {
    const source = [
      'mock.module("@hooks", () => ({}));',
      'mock.module("@store/sdk", () => ({}));',
      'mock.module("../hooks/index.ts", () => ({}));',
      'mock.module("../store/sdk", () => ({}));',
      'mock.module("./local", () => ({}));',
      'mock.module("react-native", () => ({}));',
    ];
    expect(check({rule, source}).lines).toEqual([1, 2, 3, 4]);
  });

  it("skips allowlisted mock helper files", () => {
    expect(
      check({
        file: "tests/mocks/aliases.test.ts",
        rule,
        source: 'mock.module("@hooks", () => ({}));',
      }).lines
    ).toEqual([]);
  });
});

describe("resolvesToBarrel", () => {
  it("returns false for relative specifiers when no barrel paths are configured", () => {
    expect(
      resolvesToBarrel({
        config: {rootDir: ROOT},
        fromFile: `${ROOT}/a/b.test.ts`,
        specifier: "../hooks",
      })
    ).toBe(false);
  });
});

describe("no-sleep", () => {
  const rule = "no-sleep";

  it("flags bare setTimeout promises in expression and block form", () => {
    const source = [
      "await new Promise((resolve) => setTimeout(resolve, 10));",
      "await new Promise(function (r) { setTimeout(r, 10); });",
      "await new Promise((r) => { return setTimeout(r, 0); });",
    ];
    expect(check({rule, source}).lines).toEqual([1, 2, 3]);
  });

  it("does not flag promises with other logic or timers that do not resolve", () => {
    const source = [
      "await new Promise((resolve) => { done = resolve; setTimeout(resolve, 10); });",
      "await new Promise((resolve) => setTimeout(() => resolve(1), 10));",
      "await new Promise(() => setTimeout(cb, 10));",
      "new Foo((resolve) => setTimeout(resolve, 1));",
      "new Promise(executor);",
      "new Promise(({a}) => setTimeout(a, 1));",
    ];
    expect(check({rule, source}).lines).toEqual([]);
  });

  it("flags configured sleep callees, defaulting to Bun.sleep", () => {
    const source = ["await Bun.sleep(5);", "await timeout(5);", "await other.thing(5);"];
    expect(check({rule, source}).lines).toEqual([1]);
    expect(
      check({config: {...BASE_CONFIG, sleepCallees: ["timeout"]}, rule, source}).lines
    ).toEqual([2]);
  });
});

describe("no-cache-busted-import", () => {
  const rule = "no-cache-busted-import";

  it("flags ? in string, template, and concatenated dynamic import specifiers", () => {
    const source = [
      'await import("./a?x");',
      `await import(\`./a?${PLACEHOLDER}\`);`,
      `await import(\`./${PLACEHOLDER}?x\`);`,
      'await import("./a" + ("?" + n));',
      'await import("./a");',
      "await import(name);",
    ];
    expect(check({rule, source}).lines).toEqual([1, 2, 3, 4]);
  });
});

describe("no-late-real-capture", () => {
  const rule = "no-late-real-capture";

  it("flags real barrel capture inside mock.module and helper factories", () => {
    const source = [
      'import {mockHooks} from "../tests/mocks/bunModuleAliases";',
      'import {getRealHooksExports, other} from "../tests/mocks/realModuleSnapshots";',
      'mock.module("@hooks", () => ({...require("@hooks")}));',
      'mockHooks(async () => ({...(await import("../hooks"))}));',
      "mockHooks(() => ({...getRealHooksExports()}));",
      "mockHooks(() => ({...other()}));",
      'mock.module("./x", () => ({...require("./local")}));',
      'const real = require("@hooks");',
    ];
    expect(check({rule, source}).lines).toEqual([3, 4, 5]);
  });
});

describe("no-component-snapshot", () => {
  const rule = "no-component-snapshot";

  it("flags snapshots of imported bindings but not render results", () => {
    const source = [
      'import Default, {Named} from "./C";',
      'import * as Ns from "./D";',
      'const {Dyn} = await import("./E");',
      'const Req = require("./F");',
      "expect(Default).toMatchSnapshot();",
      "expect(Named).toMatchSnapshot();",
      "expect(Ns).toMatchSnapshot();",
      "expect(Dyn).toMatchSnapshot();",
      "expect(Req).toMatchSnapshot();",
      "expect(render(Named).toJSON()).toMatchSnapshot();",
      "const tree = 1;",
      "expect(tree).toMatchSnapshot();",
      "other(Named).toMatchSnapshot();",
    ];
    expect(check({rule, source}).lines).toEqual([5, 6, 7, 8, 9]);
  });
});

describe("runHygieneRules", () => {
  it("runs every rule by default, reports root-relative paths, and parses TSX", () => {
    const {violations} = runHygieneRules({
      config: BASE_CONFIG,
      fileName: `${ROOT}/components/Foo.test.tsx`,
      sourceText: [
        'import {Foo} from "./Foo";',
        'mock.module("@hooks", () => ({}));',
        "const el = <Foo bar />;",
        "expect(Foo).toMatchSnapshot();",
      ].join("\n"),
    });
    expect(violations.map((v) => [v.file, v.line, v.ruleId])).toEqual([
      ["components/Foo.test.tsx", 2, "no-direct-barrel-mock"],
      ["components/Foo.test.tsx", 2, "no-module-scope-mock-module"],
      ["components/Foo.test.tsx", 4, "no-component-snapshot"],
    ]);
  });
});
