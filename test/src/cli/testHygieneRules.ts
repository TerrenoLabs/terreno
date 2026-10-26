/**
 * AST rules for the test-hygiene checker. Each rule targets a Bun test pattern that causes
 * order-dependent or timing-dependent failures:
 *
 * - `no-module-scope-mock-module`: `mock.module()` is process-wide and has no undo, so a call
 *   that runs at module load leaks into every later file in the process. Register mocks from a
 *   helper called in `beforeEach`/`beforeAll`/`describe` instead.
 * - `no-direct-barrel-mock`: mocking a shared barrel by one specifier (an alias like `@hooks`)
 *   leaves the other cache key (`hooks/index.ts`) bound to the real module. Route barrel mocks
 *   through helpers that register both keys.
 * - `no-sleep`: fixed sleeps are either too short on slow CI or waste time locally. Poll the
 *   real condition instead.
 * - `no-cache-busted-import`: `import("./x?bust")` creates a new module identity, so
 *   `mock.module()` registrations for `./x` no longer apply.
 * - `no-late-real-capture`: capturing the real barrel inside the mock factory can re-enter the
 *   in-progress registration and bind a partial module. Capture real exports at module scope.
 * - `no-component-snapshot`: `expect(ImportedComponent).toMatchSnapshot()` snapshots a function
 *   reference, not rendered output.
 *
 * Uses the TypeScript compiler API (not regex) so scope detection is reliable.
 */
import path from "node:path";
import ts from "typescript";

import {matchesAnyGlob, toPosixPath} from "./collectFiles";

export const HYGIENE_RULE_IDS = [
  "no-module-scope-mock-module",
  "no-direct-barrel-mock",
  "no-sleep",
  "no-cache-busted-import",
  "no-late-real-capture",
  "no-component-snapshot",
] as const;

export type HygieneRuleId = (typeof HYGIENE_RULE_IDS)[number];

export interface HygieneViolation {
  /** Path relative to the configured root, POSIX separators. */
  file: string;
  /** 1-based line. */
  line: number;
  ruleId: HygieneRuleId;
  message: string;
}

/** App-specific knowledge the rules need. Every field is optional; empty disables that aspect. */
export interface HygieneRuleConfig {
  /** Absolute directory that relative barrel paths and reported file paths are relative to. */
  rootDir: string;
  /**
   * Globs matched against bare (non-relative) import specifiers that name a shared barrel,
   * e.g. `@hooks`, `@store`, `@app/*`.
   */
  barrelAliases?: readonly string[];
  /**
   * Globs matched against the root-relative, extension-stripped path a relative specifier
   * resolves to, e.g. `hooks`, `store/sdk`. A trailing `/index` is also matched as its directory.
   */
  barrelPaths?: readonly string[];
  /** Globs of root-relative test files allowed to mock barrels directly (e.g. `tests/mocks/**`). */
  barrelMockAllowlist?: readonly string[];
  /**
   * Module names or path suffixes (e.g. `bunModuleAliases`) whose named imports are helpers that
   * register `mock.module()` internally and take the mock factory as their first argument.
   */
  mockHelperModules?: readonly string[];
  /** Module names or path suffixes exporting "get the real exports" helpers. */
  realExportGetterModules?: readonly string[];
  /** Regex source that a getter import's name must match (default: any name). */
  realExportGetterNamePattern?: string;
  /** Extra sleep callees flagged by `no-sleep`, as written at the call site (e.g. `Bun.sleep`). */
  sleepCallees?: readonly string[];
}

export const DEFAULT_SLEEP_CALLEES: readonly string[] = ["Bun.sleep"];

const stripExtension = (filePath: string): string =>
  filePath.replace(/\.(tsx?|jsx?|mjs|cjs)$/u, "");

/** Whether `specifier` is `entry` exactly or ends with `/entry` (ignoring a file extension). */
const specifierMatchesModule = ({
  specifier,
  modules,
}: {
  specifier: string;
  modules: readonly string[];
}): boolean => {
  const stripped = stripExtension(specifier);
  return modules.some((entry) => stripped === entry || stripped.endsWith(`/${entry}`));
};

/** Determines whether a `mock.module()`/`require()`/`import()` specifier targets a shared barrel. */
export const resolvesToBarrel = ({
  config,
  fromFile,
  specifier,
}: {
  config: HygieneRuleConfig;
  fromFile: string;
  specifier: string;
}): boolean => {
  if (!specifier.startsWith(".")) {
    return matchesAnyGlob({filePath: specifier, globs: config.barrelAliases ?? []});
  }
  const barrelPaths = config.barrelPaths ?? [];
  if (barrelPaths.length === 0) {
    return false;
  }
  const resolved = stripExtension(path.resolve(path.dirname(fromFile), specifier));
  const relativeToRoot = toPosixPath(path.relative(config.rootDir, resolved));
  const candidates = [relativeToRoot];
  if (relativeToRoot.endsWith("/index")) {
    candidates.push(relativeToRoot.slice(0, -"/index".length));
  }
  return candidates.some((candidate) => matchesAnyGlob({filePath: candidate, globs: barrelPaths}));
};

const isMockModuleCallee = (expression: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(expression) &&
  ts.isIdentifier(expression.expression) &&
  expression.expression.text === "mock" &&
  expression.name.text === "module";

const isMockModuleCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && isMockModuleCallee(node.expression);

const isFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

/** Whether `node` runs at module load (no enclosing function). */
const isAtModuleScope = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) {
      return false;
    }
    current = current.parent;
  }
  return true;
};

const makeViolation = ({
  sourceFile,
  node,
  ruleId,
  message,
}: {
  sourceFile: ts.SourceFile;
  node: ts.Node;
  ruleId: HygieneRuleId;
  message: string;
}): HygieneViolation => {
  const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {file: sourceFile.fileName, line: line + 1, message, ruleId};
};

/** Calls `visitor` for every node in `root`, depth first. */
const walk = (root: ts.Node, visitor: (node: ts.Node) => void): void => {
  const visit = (node: ts.Node): void => {
    visitor(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
};

/** Collects named functions (`function foo() {}` and `const foo = () => {}`) in the file. */
const collectNamedFunctions = (
  sourceFile: ts.SourceFile
): Map<string, ts.FunctionLikeDeclaration> => {
  const namedFunctions = new Map<string, ts.FunctionLikeDeclaration>();
  walk(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      namedFunctions.set(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      namedFunctions.set(node.name.text, node.initializer);
    }
  });
  return namedFunctions;
};

/** Collects local names of named imports whose module specifier matches `modules`. */
const collectNamedImportsFrom = ({
  sourceFile,
  modules,
  namePattern,
}: {
  sourceFile: ts.SourceFile;
  modules: readonly string[];
  namePattern?: RegExp;
}): Set<string> => {
  const names = new Set<string>();
  if (modules.length === 0) {
    return names;
  }
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !specifierMatchesModule({modules, specifier: statement.moduleSpecifier.text})
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }
    for (const element of bindings.elements) {
      if (!namePattern || namePattern.test(element.name.text)) {
        names.add(element.name.text);
      }
    }
  }
  return names;
};

interface RuleContext {
  sourceFile: ts.SourceFile;
  config: HygieneRuleConfig;
  /** Root-relative POSIX path of the file under check. */
  relativeFile: string;
  mockHelperNames: Set<string>;
}

/** Whether `fn` transitively (through same-file named functions) calls `mock.module()` or a helper. */
const createMockRegistrationDetector = ({
  sourceFile,
  mockHelperNames,
}: {
  sourceFile: ts.SourceFile;
  mockHelperNames: Set<string>;
}): ((fn: ts.FunctionLikeDeclaration) => boolean) => {
  const namedFunctions = collectNamedFunctions(sourceFile);
  const memo = new Map<ts.FunctionLikeDeclaration, boolean>();
  const visiting = new Set<ts.FunctionLikeDeclaration>();

  const registersMock = (fn: ts.FunctionLikeDeclaration): boolean => {
    const cached = memo.get(fn);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(fn)) {
      return false;
    }
    visiting.add(fn);
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) {
        return;
      }
      if (isMockModuleCall(node)) {
        found = true;
        return;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const target = namedFunctions.get(name);
        if (mockHelperNames.has(name) || (target && registersMock(target))) {
          found = true;
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body ?? fn);
    visiting.delete(fn);
    memo.set(fn, found);
    return found;
  };

  return registersMock;
};

const findModuleScopeMockViolations = ({
  sourceFile,
  mockHelperNames,
}: RuleContext): HygieneViolation[] => {
  const namedFunctions = collectNamedFunctions(sourceFile);
  const registersMock = createMockRegistrationDetector({mockHelperNames, sourceFile});
  const violations: HygieneViolation[] = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !isAtModuleScope(node)) {
      return;
    }
    if (isMockModuleCallee(node.expression)) {
      violations.push(
        makeViolation({
          message:
            "mock.module() executes at module load; wrap it in a helper called from beforeEach/beforeAll/describe.",
          node,
          ruleId: "no-module-scope-mock-module",
          sourceFile,
        })
      );
      return;
    }
    if (!ts.isIdentifier(node.expression)) {
      return;
    }
    const name = node.expression.text;
    if (mockHelperNames.has(name)) {
      violations.push(
        makeViolation({
          message: `${name}() registers mock.module() and is invoked at module scope; call it from beforeEach/beforeAll/describe instead.`,
          node,
          ruleId: "no-module-scope-mock-module",
          sourceFile,
        })
      );
      return;
    }
    const target = namedFunctions.get(name);
    if (target && registersMock(target)) {
      violations.push(
        makeViolation({
          message: `${name}() registers mock.module() and is invoked at module scope; call it from beforeEach/beforeAll/describe instead.`,
          node,
          ruleId: "no-module-scope-mock-module",
          sourceFile,
        })
      );
    }
  });
  return violations;
};

const findDirectBarrelMockViolations = ({
  sourceFile,
  config,
  relativeFile,
}: RuleContext): HygieneViolation[] => {
  if (matchesAnyGlob({filePath: relativeFile, globs: config.barrelMockAllowlist ?? []})) {
    return [];
  }
  const violations: HygieneViolation[] = [];
  walk(sourceFile, (node) => {
    if (!isMockModuleCall(node)) {
      return;
    }
    const [specifierArg] = node.arguments;
    if (
      specifierArg &&
      ts.isStringLiteralLike(specifierArg) &&
      resolvesToBarrel({config, fromFile: sourceFile.fileName, specifier: specifierArg.text})
    ) {
      violations.push(
        makeViolation({
          message: `mock.module("${specifierArg.text}") targets a shared barrel directly; use a helper that registers every specifier the barrel resolves under.`,
          node,
          ruleId: "no-direct-barrel-mock",
          sourceFile,
        })
      );
    }
  });
  return violations;
};

/** Whether `node` is `setTimeout(resolve, N)` (optionally as a statement or return value). */
const isSetTimeoutOnResolve = ({
  node,
  resolveName,
}: {
  node: ts.Node;
  resolveName: string;
}): boolean => {
  let expr: ts.Node = node;
  if (ts.isExpressionStatement(node)) {
    expr = node.expression;
  } else if (ts.isReturnStatement(node) && node.expression) {
    expr = node.expression;
  }
  if (
    !ts.isCallExpression(expr) ||
    !ts.isIdentifier(expr.expression) ||
    expr.expression.text !== "setTimeout"
  ) {
    return false;
  }
  const [firstArg] = expr.arguments;
  return Boolean(firstArg && ts.isIdentifier(firstArg) && firstArg.text === resolveName);
};

/** Whether `node` is `new Promise((resolve) => setTimeout(resolve, N))` with no other logic. */
const isBareSleepPromise = (node: ts.Node): boolean => {
  if (
    !ts.isNewExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== "Promise"
  ) {
    return false;
  }
  const [executor] = node.arguments ?? [];
  if (!executor || !(ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))) {
    return false;
  }
  const [resolveParam] = executor.parameters;
  if (!resolveParam || !ts.isIdentifier(resolveParam.name)) {
    return false;
  }
  const statements: readonly ts.Node[] = ts.isBlock(executor.body)
    ? executor.body.statements
    : [executor.body];
  return (
    statements.length === 1 &&
    isSetTimeoutOnResolve({node: statements[0], resolveName: resolveParam.name.text})
  );
};

/** Returns `a.b.c` for identifier/property-access callees, otherwise undefined. */
const getCalleeText = (expr: ts.Expression): string | undefined => {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const left = getCalleeText(expr.expression);
    return left ? `${left}.${expr.name.text}` : undefined;
  }
  return undefined;
};

const findSleepViolations = ({sourceFile, config}: RuleContext): HygieneViolation[] => {
  const sleepCallees = new Set(config.sleepCallees ?? DEFAULT_SLEEP_CALLEES);
  const violations: HygieneViolation[] = [];
  walk(sourceFile, (node) => {
    if (isBareSleepPromise(node)) {
      violations.push(
        makeViolation({
          message: "Bare setTimeout sleep; poll the actual condition (e.g. waitFor) instead.",
          node,
          ruleId: "no-sleep",
          sourceFile,
        })
      );
      return;
    }
    if (!ts.isCallExpression(node)) {
      return;
    }
    const callee = getCalleeText(node.expression);
    if (callee && sleepCallees.has(callee)) {
      violations.push(
        makeViolation({
          message: `${callee}() sleeps for a fixed time; poll the actual condition (e.g. waitFor) instead.`,
          node,
          ruleId: "no-sleep",
          sourceFile,
        })
      );
    }
  });
  return violations;
};

/** Whether a string/template/concatenation expression contains a literal `?`. */
const containsQuestionMark = (node: ts.Expression): boolean => {
  if (ts.isStringLiteralLike(node)) {
    return node.text.includes("?");
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text.includes("?") ||
      node.templateSpans.some((span) => span.literal.text.includes("?"))
    );
  }
  if (ts.isBinaryExpression(node)) {
    return containsQuestionMark(node.left) || containsQuestionMark(node.right);
  }
  if (ts.isParenthesizedExpression(node)) {
    return containsQuestionMark(node.expression);
  }
  return false;
};

const isDynamicImportCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;

const isRequireCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === "require";

const findCacheBustedImportViolations = ({sourceFile}: RuleContext): HygieneViolation[] => {
  const violations: HygieneViolation[] = [];
  walk(sourceFile, (node) => {
    if (!isDynamicImportCall(node)) {
      return;
    }
    const [arg] = node.arguments;
    if (arg && containsQuestionMark(arg)) {
      violations.push(
        makeViolation({
          message:
            "Dynamic import specifier contains a cache-busting '?'; module identity must stay stable for mock.module to apply.",
          node,
          ruleId: "no-cache-busted-import",
          sourceFile,
        })
      );
    }
  });
  return violations;
};

const getMockFactory = ({
  node,
  mockHelperNames,
}: {
  node: ts.Node;
  mockHelperNames: Set<string>;
}): ts.ArrowFunction | ts.FunctionExpression | undefined => {
  let factory: ts.Expression | undefined;
  if (isMockModuleCall(node)) {
    factory = node.arguments[1];
  } else if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    mockHelperNames.has(node.expression.text)
  ) {
    factory = node.arguments[0];
  }
  if (factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
    return factory;
  }
  return undefined;
};

const findLateRealCaptureViolations = ({
  sourceFile,
  config,
  mockHelperNames,
}: RuleContext): HygieneViolation[] => {
  const getterNames = collectNamedImportsFrom({
    modules: config.realExportGetterModules ?? [],
    namePattern: config.realExportGetterNamePattern
      ? new RegExp(config.realExportGetterNamePattern, "u")
      : undefined,
    sourceFile,
  });
  const violations: HygieneViolation[] = [];
  const checkFactoryNode = (node: ts.Node): void => {
    if (isRequireCall(node) || isDynamicImportCall(node)) {
      const [specifierArg] = node.arguments;
      if (
        specifierArg &&
        ts.isStringLiteralLike(specifierArg) &&
        resolvesToBarrel({config, fromFile: sourceFile.fileName, specifier: specifierArg.text})
      ) {
        violations.push(
          makeViolation({
            message: `Captures the real "${specifierArg.text}" barrel inside a mock factory; capture it at module scope before mock registration instead.`,
            node,
            ruleId: "no-late-real-capture",
            sourceFile,
          })
        );
      }
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      getterNames.has(node.expression.text)
    ) {
      violations.push(
        makeViolation({
          message: `Calls ${node.expression.text}() inside a mock factory; call it at module scope before mock registration instead.`,
          node,
          ruleId: "no-late-real-capture",
          sourceFile,
        })
      );
    }
  };
  walk(sourceFile, (node) => {
    const factory = getMockFactory({mockHelperNames, node});
    if (factory) {
      walk(factory.body, checkFactoryNode);
    }
  });
  return violations;
};

const addBindingNames = ({name, out}: {name: ts.BindingName; out: Set<string>}): void => {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      addBindingNames({name: element.name, out});
    }
  }
};

/** Names bound to module imports: static imports plus `const {X} = await import()/require()`. */
const collectImportedNames = (sourceFile: ts.SourceFile): Set<string> => {
  const importedNames = new Set<string>();
  walk(sourceFile, (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const {importClause} = node;
      if (importClause.name) {
        importedNames.add(importClause.name.text);
      }
      const bindings = importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          importedNames.add(element.name.text);
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        importedNames.add(bindings.name.text);
      }
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = ts.isAwaitExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (isDynamicImportCall(init) || isRequireCall(init)) {
        addBindingNames({name: node.name, out: importedNames});
      }
    }
  });
  return importedNames;
};

const findComponentSnapshotViolations = ({sourceFile}: RuleContext): HygieneViolation[] => {
  const importedNames = collectImportedNames(sourceFile);
  const violations: HygieneViolation[] = [];
  walk(sourceFile, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "toMatchSnapshot"
    ) {
      return;
    }
    const receiver = node.expression.expression;
    if (
      !ts.isCallExpression(receiver) ||
      !ts.isIdentifier(receiver.expression) ||
      receiver.expression.text !== "expect"
    ) {
      return;
    }
    const [arg] = receiver.arguments;
    if (arg && ts.isIdentifier(arg) && importedNames.has(arg.text)) {
      violations.push(
        makeViolation({
          message: `expect(${arg.text}).toMatchSnapshot() snapshots the imported reference, not rendered output; render it first.`,
          node,
          ruleId: "no-component-snapshot",
          sourceFile,
        })
      );
    }
  });
  return violations;
};

const RULES: Record<HygieneRuleId, (context: RuleContext) => HygieneViolation[]> = {
  "no-cache-busted-import": findCacheBustedImportViolations,
  "no-component-snapshot": findComponentSnapshotViolations,
  "no-direct-barrel-mock": findDirectBarrelMockViolations,
  "no-late-real-capture": findLateRealCaptureViolations,
  "no-module-scope-mock-module": findModuleScopeMockViolations,
  "no-sleep": findSleepViolations,
};

/**
 * Runs the enabled rules against one parsed file. Pure and filesystem free. Returned violations
 * carry the root-relative path and are not yet suppression filtered.
 */
export const runHygieneRules = ({
  fileName,
  sourceText,
  config,
  rules = HYGIENE_RULE_IDS,
}: {
  /** Absolute path, used for relative-specifier resolution and reported paths. */
  fileName: string;
  sourceText: string;
  config: HygieneRuleConfig;
  rules?: readonly HygieneRuleId[];
}): {violations: HygieneViolation[]} => {
  const isJsx = /\.[jt]sx$/u.test(fileName);
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const context: RuleContext = {
    config,
    mockHelperNames: collectNamedImportsFrom({
      modules: config.mockHelperModules ?? [],
      sourceFile,
    }),
    relativeFile: toPosixPath(path.relative(config.rootDir, fileName)),
    sourceFile,
  };
  const violations = rules
    .flatMap((ruleId) => RULES[ruleId](context))
    .map((violation) => ({...violation, file: context.relativeFile}))
    .sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId));
  return {violations};
};
