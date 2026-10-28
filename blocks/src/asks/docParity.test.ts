import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {ASK_ERROR_CODES} from "./errors";
import {ASK_LIMITS} from "./limits";

const REFERENCE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "docs",
  "reference",
  "agent-ui-asks.md"
);

const reference = readFileSync(REFERENCE_PATH, "utf8");

const section = (heading: string): string => {
  const start = reference.indexOf(`\n## ${heading}\n`);
  if (start < 0) {
    throw new Error(`docs/reference/agent-ui-asks.md has no "## ${heading}" section.`);
  }
  const end = reference.indexOf("\n## ", start + 1);
  return reference.slice(start, end < 0 ? undefined : end);
};

const tableRows = (text: string): string[][] =>
  text
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) =>
      line
        .slice(1, -1)
        .split(" | ")
        .map((cell) => cell.trim().replace(/^`|`$/g, ""))
    );

const flattenLimits = (value: object, prefix = ""): [string, string][] =>
  Object.entries(value).flatMap(([key, child]): [string, string][] => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (child instanceof RegExp) {
      return [[path, child.source]];
    }
    if (typeof child === "object" && child !== null) {
      return flattenLimits(child, path);
    }
    return [[path, String(child)]];
  });

describe("docs/reference/agent-ui-asks.md", () => {
  it("documents every error code with the meaning from ASK_ERROR_CODES", () => {
    const documented = Object.fromEntries(
      tableRows(section("Error codes")).map(([code, meaning]) => [code, meaning])
    );
    expect(documented).toEqual({...ASK_ERROR_CODES});
  });

  it("documents every ASK_LIMITS value", () => {
    const documented = Object.fromEntries(
      tableRows(section("Limits")).map(([key, value]) => [key, value])
    );
    expect(documented).toEqual(Object.fromEntries(flattenLimits(ASK_LIMITS)));
  });
});
