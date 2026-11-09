import {describe, expect, it} from "bun:test";
import {DEFAULT_APP_CONFIG} from "../appConfig";
import {
  type AdminSpaRequestScope,
  getAdminSpaRequest,
  runInAdminSpaRequest,
} from "../serverContext";

// Isolated file: the cache-busted import below evaluates serverContext.ts a second time, and
// Bun's coverage counts that copy apart, so it runs in its own coverage pass.
const makeScope = (userId: string): AdminSpaRequestScope =>
  ({
    appConfig: DEFAULT_APP_CONFIG,
    basePath: "/console",
    session: {userId},
  }) as unknown as AdminSpaRequestScope;

describe("admin SPA request scope across module copies", () => {
  it("shares the scope with a second copy of the module, as render.js is bundled separately", async () => {
    // A cache-busted import evaluates serverContext.ts again, like the Expo bundle's own copy.
    const second = (await import(
      `../serverContext?copy=${Math.random()}`
    )) as typeof import("../serverContext");
    expect(second.getAdminSpaRequest).not.toBe(getAdminSpaRequest);
    const scope = makeScope("shared");
    const seen = runInAdminSpaRequest(scope, () => second.getAdminSpaRequest());
    expect(seen).toBe(scope);
  });
});
