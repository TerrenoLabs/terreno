import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import path from "node:path";

import * as api from "./index";

const readSource = (file: string): string => readFileSync(path.join(__dirname, file), "utf8");

// Matches a single JSDoc block that holds `@deprecated` and `59.0.0` and ends right above `declaration`.
const deprecatedJsDocAbove = (source: string, declaration: string): RegExpMatchArray | null => {
  const body = "(?:(?!\\*/)[\\s\\S])*";
  const escaped = declaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(
    new RegExp(`/\\*\\*${body}@deprecated${body}59\\.0\\.0${body}\\*/\\s*\\n${escaped}\\b`)
  );
};

describe("deprecated legacy exports", () => {
  it("keeps all four exported and working", () => {
    expect(typeof api.createRouterWithAuth).toBe("function");
    expect(typeof api.setupEnvironment).toBe("function");
    expect(api.gooseRestRouter === api.modelRouter).toBe(true);
  });

  it("tags createRouterWithAuth as deprecated until 59.0.0", () => {
    expect(
      deprecatedJsDocAbove(readSource("expressServer.ts"), "export const createRouterWithAuth")
    ).not.toBeNull();
  });

  it("names the firebase-jwt requirement on createRouterWithAuth", () => {
    const source = readSource("expressServer.ts");
    const match = source.match(
      /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*\nexport const createRouterWithAuth\b/
    );
    expect(match?.[0]).toContain("firebase-jwt");
  });

  it("names the replacements on createRouterWithAuth and setupEnvironment", () => {
    const source = readSource("expressServer.ts");
    const jsDocOf = (declaration: string): string =>
      source.match(new RegExp(`/\\*\\*(?:(?!\\*/)[\\s\\S])*\\*/\\s*\\n${declaration}\\b`))?.[0] ??
      "";
    expect(jsDocOf("export const createRouterWithAuth")).toContain("authenticateMiddleware");
    expect(jsDocOf("export const setupEnvironment")).toContain("TerrenoApp");
  });

  it("tags setupEnvironment as deprecated until 59.0.0", () => {
    expect(
      deprecatedJsDocAbove(readSource("expressServer.ts"), "export const setupEnvironment")
    ).not.toBeNull();
  });

  it("tags gooseRestRouter as deprecated until 59.0.0 and points at modelRouter", () => {
    const match = deprecatedJsDocAbove(readSource("api.ts"), "export const gooseRestRouter");
    expect(match).not.toBeNull();
    expect(match?.[0]).toContain("modelRouter");
  });

  it("tags GooseRESTOptions as deprecated until 59.0.0 and points at ModelRouterOptions", () => {
    const match = deprecatedJsDocAbove(readSource("api.ts"), "export type GooseRESTOptions");
    expect(match).not.toBeNull();
    expect(match?.[0]).toContain("ModelRouterOptions");
  });
});
