import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join, relative, resolve} from "node:path";

const SCOPED_PACKAGES = [
  "admin-backend",
  "admin-frontend",
  "ai",
  "api",
  "example-backend",
  "ui",
] as const;

const BACKEND_PACKAGES = new Set(["admin-backend", "ai", "api", "example-backend"]);

type SourceRuleId =
  | "as-any"
  | "console-log"
  | "date"
  | "find-one"
  | "function-declaration"
  | "throw-new-error";

export interface SourceRuleViolation {
  column: number;
  file: string;
  line: number;
  rule: SourceRuleId;
  snippet: string;
}

const IGNORED_DIR_NAMES = new Set([
  ".expo",
  ".next",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
]);

const GENERATED_FILE_NAMES = new Set(["apiSdk.ts", "syncDbSdk.ts"]);

const isTestOrHarnessFile = (relativePath: string): boolean => {
  if (
    /\.test\./.test(relativePath) ||
    /\.spec\./.test(relativePath) ||
    /\.isolated\./.test(relativePath)
  ) {
    return true;
  }
  if (relativePath.includes("/isolated/") || relativePath.includes("/__tests__/")) {
    return true;
  }
  if (relativePath.endsWith("/bunSetup.ts") || relativePath.endsWith("/setupTests.ts")) {
    return true;
  }
  return false;
};

const isGeneratedFile = (fileName: string): boolean => {
  if (GENERATED_FILE_NAMES.has(fileName)) {
    return true;
  }
  if (fileName.endsWith("OpenApiSdk.ts") || fileName.endsWith(".gen.ts")) {
    return true;
  }
  return false;
};

const isSourceFile = (fileName: string): boolean => /\.tsx?$/.test(fileName);

export const isScopedProductionFile = (relativePath: string): boolean => {
  const packageName = relativePath.split("/")[0];
  if (!SCOPED_PACKAGES.includes(packageName as (typeof SCOPED_PACKAGES)[number])) {
    return false;
  }
  if (!relativePath.startsWith(`${packageName}/src/`)) {
    return false;
  }
  const fileName = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  if (fileName.endsWith(".d.ts")) {
    return false;
  }
  if (!isSourceFile(fileName) || isGeneratedFile(fileName) || isTestOrHarnessFile(relativePath)) {
    return false;
  }
  return true;
};

const shouldSkipDirectory = (dirName: string): boolean => {
  return IGNORED_DIR_NAMES.has(dirName) || dirName.startsWith(".");
};

const walkScopedSourceFiles = (repoRoot: string): string[] => {
  const files: string[] = [];

  const walk = (directory: string): void => {
    if (!existsSync(directory)) {
      return;
    }
    for (const entry of readdirSync(directory)) {
      const fullPath = join(directory, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        if (!shouldSkipDirectory(entry)) {
          walk(fullPath);
        }
        continue;
      }
      const relativePath = relative(repoRoot, fullPath);
      if (isScopedProductionFile(relativePath)) {
        files.push(fullPath);
      }
    }
  };

  for (const packageName of SCOPED_PACKAGES) {
    walk(join(repoRoot, packageName, "src"));
  }
  return files.sort();
};

const blankCommentsAndStrings = (source: string): string => {
  let output = "";
  let index = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  const pushBlank = (char: string): void => {
    output += char === "\n" ? "\n" : " ";
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += "\n";
      } else {
        output += " ";
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 2;
        inBlockComment = false;
        continue;
      }
      pushBlank(char);
      index += 1;
      continue;
    }

    if (inSingle) {
      if (char === "\\") {
        output += "  ";
        index += 2;
        continue;
      }
      if (char === "'") {
        inSingle = false;
        output += "'";
        index += 1;
        continue;
      }
      pushBlank(char);
      index += 1;
      continue;
    }

    if (inDouble) {
      if (char === "\\") {
        output += "  ";
        index += 2;
        continue;
      }
      if (char === '"') {
        inDouble = false;
        output += '"';
        index += 1;
        continue;
      }
      pushBlank(char);
      index += 1;
      continue;
    }

    if (inTemplate) {
      if (char === "\\") {
        output += "  ";
        index += 2;
        continue;
      }
      if (char === "`") {
        inTemplate = false;
        output += "`";
        index += 1;
        continue;
      }
      pushBlank(char);
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      output += "  ";
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      output += "  ";
      index += 2;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      output += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      output += char;
      index += 1;
      continue;
    }
    if (char === "`") {
      inTemplate = true;
      output += char;
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
};

const lineAndColumnAt = (
  text: string,
  index: number
): {
  column: number;
  line: number;
} => {
  let line = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === "\n") {
      line += 1;
      lineStart = cursor + 1;
    }
  }
  return {column: index - lineStart + 1, line};
};

const snippetAtLine = (source: string, line: number): string => {
  const lines = source.split("\n");
  return (lines[line - 1] ?? "").trim();
};

const skipWhitespace = (text: string, index: number): number => {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
};

const skipBalanced = (text: string, openIndex: number, open: string, close: string): number => {
  let depth = 0;
  for (let cursor = openIndex; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
  }
  return text.length;
};

const isWordChar = (char: string | undefined): boolean => {
  return char !== undefined && /[\w$]/.test(char);
};

const isFunctionKeywordAt = (text: string, index: number): boolean => {
  if (text.slice(index, index + 8) !== "function") {
    return false;
  }
  if (isWordChar(text[index + 8])) {
    return false;
  }
  const after = skipWhitespace(text, index + 8);
  const afterChar = text[after];
  if (afterChar !== "(" && (afterChar === undefined || !/[A-Za-z_$]/.test(afterChar))) {
    return false;
  }
  if (isWordChar(text[index - 1])) {
    return false;
  }
  if (text[index - 1] === ".") {
    return false;
  }
  return true;
};

const readFunctionName = (text: string, functionIndex: number): string | undefined => {
  let cursor = skipWhitespace(text, functionIndex + 8);
  if (cursor >= text.length || !/[A-Za-z_$]/.test(text[cursor] ?? "")) {
    return undefined;
  }
  const start = cursor;
  cursor += 1;
  while (cursor < text.length && isWordChar(text[cursor])) {
    cursor += 1;
  }
  return text.slice(start, cursor);
};

const classifyFunctionSignature = (
  text: string,
  functionIndex: number
): "body" | "overload" | "unknown" => {
  let cursor = skipWhitespace(text, functionIndex + 8);
  if (cursor < text.length && /[A-Za-z_$]/.test(text[cursor] ?? "")) {
    while (cursor < text.length && isWordChar(text[cursor])) {
      cursor += 1;
    }
  }
  cursor = skipWhitespace(text, cursor);
  if (text[cursor] === "<") {
    cursor = skipBalanced(text, cursor, "<", ">");
    cursor = skipWhitespace(text, cursor);
  }
  if (text[cursor] !== "(") {
    return "unknown";
  }
  cursor = skipBalanced(text, cursor, "(", ")");
  cursor = skipWhitespace(text, cursor);
  if (text[cursor] === ":") {
    cursor += 1;
    let depthParen = 0;
    let depthAngle = 0;
    let depthBracket = 0;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === "(") {
        depthParen += 1;
      } else if (char === ")") {
        depthParen -= 1;
      } else if (char === "<") {
        depthAngle += 1;
      } else if (char === ">") {
        depthAngle -= 1;
      } else if (char === "[") {
        depthBracket += 1;
      } else if (char === "]") {
        depthBracket -= 1;
      } else if (depthParen === 0 && depthAngle === 0 && depthBracket === 0) {
        if (char === "{" || char === ";") {
          break;
        }
      }
      cursor += 1;
    }
    cursor = skipWhitespace(text, cursor);
  }
  if (text[cursor] === ";") {
    return "overload";
  }
  if (text[cursor] === "{") {
    return "body";
  }
  return "unknown";
};

const signatureSlice = (text: string, functionIndex: number): string => {
  let cursor = functionIndex;
  let depthParen = 0;
  let depthAngle = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "(") {
      depthParen += 1;
    } else if (char === ")") {
      depthParen -= 1;
    } else if (char === "<") {
      depthAngle += 1;
    } else if (char === ">") {
      depthAngle -= 1;
    } else if (depthParen === 0 && depthAngle === 0 && (char === "{" || char === ";")) {
      return text.slice(functionIndex, cursor + 1);
    }
    cursor += 1;
  }
  return text.slice(functionIndex, Math.min(text.length, functionIndex + 400));
};

const isAllowedThisBoundFunction = (text: string, functionIndex: number): boolean => {
  return /\bthis\s*:/.test(signatureSlice(text, functionIndex));
};

const HOOK_CALLEES = new Set([
  "forwardRef",
  "get",
  "method",
  "post",
  "postSync",
  "pre",
  "preSync",
  "set",
  "virtual",
]);

const isImmediateFunctionAssignment = (prefix: string): boolean => {
  return /\.\w+\s*=\s*(?:async\s+)?$/.test(prefix);
};

const isImmediateCallArgument = (prefix: string): boolean => {
  const withoutAsync = prefix
    .replace(/\s+$/, "")
    .replace(/async\s*$/, "")
    .replace(/\s+$/, "");
  return /[,(]$/.test(withoutAsync);
};

const skipTrailingAsync = (lookback: string): number => {
  let index = lookback.length - 1;
  while (index >= 0 && /\s/.test(lookback[index] ?? "")) {
    index -= 1;
  }
  if (index >= 4 && lookback.slice(index - 4, index + 1) === "async") {
    index -= 5;
    while (index >= 0 && /\s/.test(lookback[index] ?? "")) {
      index -= 1;
    }
  }
  return index;
};

const enclosingCallOpenParen = (lookback: string): number | undefined => {
  let index = skipTrailingAsync(lookback);
  if (lookback[index] !== "(" && lookback[index] !== ",") {
    return undefined;
  }
  let depth = 0;
  for (; index >= 0; index -= 1) {
    const char = lookback[index];
    if (char === ")") {
      depth += 1;
    } else if (char === "(") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }
  return undefined;
};

const calleeNameBefore = (lookback: string, openParen: number): string => {
  let index = openParen - 1;
  while (index >= 0 && /\s/.test(lookback[index] ?? "")) {
    index -= 1;
  }
  if (lookback[index] === ">") {
    let angle = 1;
    index -= 1;
    while (index >= 0 && angle > 0) {
      if (lookback[index] === ">") {
        angle += 1;
      } else if (lookback[index] === "<") {
        angle -= 1;
      }
      index -= 1;
    }
    while (index >= 0 && /\s/.test(lookback[index] ?? "")) {
      index -= 1;
    }
  }
  const end = index + 1;
  while (index >= 0 && /[A-Za-z0-9_$]/.test(lookback[index] ?? "")) {
    index -= 1;
  }
  return lookback.slice(index + 1, end);
};

const isAllowedHookOrSchemaFunction = (text: string, functionIndex: number): boolean => {
  const lookback = text.slice(Math.max(0, functionIndex - 400), functionIndex);
  if (isImmediateFunctionAssignment(lookback)) {
    return true;
  }
  if (!isImmediateCallArgument(lookback)) {
    return false;
  }
  const openParen = enclosingCallOpenParen(lookback);
  if (openParen === undefined) {
    return false;
  }
  const callee = calleeNameBefore(lookback, openParen);
  if (!HOOK_CALLEES.has(callee)) {
    return false;
  }
  if ((callee === "get" || callee === "set") && !/\.virtual\s*\(/.test(lookback)) {
    return false;
  }
  return true;
};

const isDeclareFunction = (text: string, functionIndex: number): boolean => {
  const lookback = text.slice(Math.max(0, functionIndex - 20), functionIndex);
  return /declare\s+$/.test(lookback);
};

const hasBiomeNoExplicitAnyIgnore = (originalLines: string[], line: number): boolean => {
  const start = Math.max(0, line - 6);
  for (let index = start; index < line; index += 1) {
    const candidate = originalLines[index] ?? "";
    if (/biome-ignore(?:-all)?\s+lint\/suspicious\/noExplicitAny/.test(candidate)) {
      return true;
    }
  }
  return false;
};

const collectFunctionViolations = (
  relativePath: string,
  original: string,
  blanked: string
): SourceRuleViolation[] => {
  const violations: SourceRuleViolation[] = [];
  const seenOverloads = new Set<string>();

  for (let index = 0; index < blanked.length; index += 1) {
    if (!isFunctionKeywordAt(blanked, index)) {
      continue;
    }
    if (isDeclareFunction(blanked, index)) {
      continue;
    }
    const name = readFunctionName(blanked, index);
    const kind = classifyFunctionSignature(blanked, index);
    if (kind === "overload") {
      if (name !== undefined) {
        seenOverloads.add(name);
      }
      continue;
    }
    if (name !== undefined && seenOverloads.has(name)) {
      continue;
    }
    if (isAllowedThisBoundFunction(blanked, index)) {
      continue;
    }
    if (isAllowedHookOrSchemaFunction(blanked, index)) {
      continue;
    }

    const {column, line} = lineAndColumnAt(blanked, index);
    violations.push({
      column,
      file: relativePath,
      line,
      rule: "function-declaration",
      snippet: snippetAtLine(original, line),
    });
  }

  return violations;
};

const collectRegexViolations = ({
  blanked,
  original,
  originalLines,
  packageName,
  relativePath,
}: {
  blanked: string;
  original: string;
  originalLines: string[];
  packageName: string;
  relativePath: string;
}): SourceRuleViolation[] => {
  const violations: SourceRuleViolation[] = [];

  const pushMatches = (pattern: RegExp, rule: SourceRuleId): void => {
    pattern.lastIndex = 0;
    for (const match of blanked.matchAll(pattern)) {
      const index = match.index ?? 0;
      const {column, line} = lineAndColumnAt(blanked, index);
      violations.push({
        column,
        file: relativePath,
        line,
        rule,
        snippet: snippetAtLine(original, line),
      });
    }
  };

  pushMatches(/\bnew Date\s*\(|\bDate\.now\s*\(/g, "date");
  pushMatches(/\bconsole\.log\s*\(/g, "console-log");

  if (BACKEND_PACKAGES.has(packageName)) {
    pushMatches(/\bthrow\s+new\s+Error\s*\(/g, "throw-new-error");

    for (const match of blanked.matchAll(/\.findOne\s*\(/g)) {
      const index = match.index ?? 0;
      const prefix = blanked.slice(Math.max(0, index - "collection".length), index);
      if (prefix === "collection") {
        continue;
      }
      const {column, line} = lineAndColumnAt(blanked, index);
      violations.push({
        column,
        file: relativePath,
        line,
        rule: "find-one",
        snippet: snippetAtLine(original, line),
      });
    }
  }

  for (const match of blanked.matchAll(/\bas any\b/g)) {
    const index = match.index ?? 0;
    const {column, line} = lineAndColumnAt(blanked, index);
    if (hasBiomeNoExplicitAnyIgnore(originalLines, line)) {
      continue;
    }
    violations.push({
      column,
      file: relativePath,
      line,
      rule: "as-any",
      snippet: snippetAtLine(original, line),
    });
  }

  return violations;
};

export const collectSourceRuleViolationsInFile = ({
  relativePath,
  source,
}: {
  relativePath: string;
  source: string;
}): SourceRuleViolation[] => {
  const blanked = blankCommentsAndStrings(source);
  const originalLines = source.split("\n");
  const packageName = relativePath.split("/")[0] ?? "";
  return [
    ...collectFunctionViolations(relativePath, source, blanked),
    ...collectRegexViolations({
      blanked,
      original: source,
      originalLines,
      packageName,
      relativePath,
    }),
  ];
};

export const collectSourceRuleViolations = (repoRoot: string): SourceRuleViolation[] => {
  const root = resolve(repoRoot);
  const violations: SourceRuleViolation[] = [];
  for (const filePath of walkScopedSourceFiles(root)) {
    const relativePath = relative(root, filePath);
    const source = readFileSync(filePath, "utf8");
    violations.push(...collectSourceRuleViolationsInFile({relativePath, source}));
  }
  return violations.sort((left, right) => {
    const fileOrder = left.file.localeCompare(right.file);
    if (fileOrder !== 0) {
      return fileOrder;
    }
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    return left.column - right.column;
  });
};

export const formatViolationReport = (violations: SourceRuleViolation[]): string => {
  const lines = violations.map((violation) => {
    return `  ${violation.file}:${violation.line}:${violation.column}  [${violation.rule}]  ${violation.snippet}`;
  });
  return [
    `check-source-rules: found ${violations.length} production source-rule violation(s):`,
    "",
    ...lines,
    "",
    "Fix the hit or use an allowed form (Luxon DateTime, APIError, findExactlyOne/findOneOrNone, console.info/logger, typed casts).",
    "See docs/explanation/source-rules.md",
  ].join("\n");
};
