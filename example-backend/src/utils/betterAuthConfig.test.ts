/** Verifies CORS_ORIGINS parsing, including Vercel preview wildcard origins. */
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import supertest from "supertest";

import {start} from "../server";
import {buildBetterAuthConfig, getCorsOrigins, toCorsOrigin} from "./betterAuthConfig";

const PREVIEW_PATTERN = "https://terreno-frontend-*-terrenolabs.vercel.app";

const matches = (origin: string | RegExp, candidate: string): boolean =>
  typeof origin === "string" ? origin === candidate : origin.test(candidate);

describe("toCorsOrigin", () => {
  it("passes exact origins through unchanged", () => {
    expect(toCorsOrigin("https://terreno-frontend.vercel.app")).toBe(
      "https://terreno-frontend.vercel.app"
    );
  });

  it("matches Vercel per-deployment and branch preview hosts", () => {
    const origin = toCorsOrigin(PREVIEW_PATTERN);
    expect(matches(origin, "https://terreno-frontend-a1b2c3d4e-terrenolabs.vercel.app")).toBe(true);
    expect(matches(origin, "https://terreno-frontend-git-fix-login-terrenolabs.vercel.app")).toBe(
      true
    );
  });

  it("rejects hosts that widen the wildcard past one label or onto another team", () => {
    const origin = toCorsOrigin(PREVIEW_PATTERN);
    expect(matches(origin, "https://terreno-frontend-x.evil.com-terrenolabs.vercel.app")).toBe(
      false
    );
    expect(matches(origin, "https://terreno-frontend-abc-otherteam.vercel.app")).toBe(false);
    expect(matches(origin, "http://terreno-frontend-abc-terrenolabs.vercel.app")).toBe(false);
    expect(matches(origin, "https://terreno-frontend--terrenolabs.vercel.app")).toBe(false);
    expect(matches(origin, "https://terreno-frontend-abc-terrenolabs.vercel.app.evil.com")).toBe(
      false
    );
  });
});

describe("CORS_ORIGINS", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = `https://terreno-frontend.vercel.app, ${PREVIEW_PATTERN}`;
  });

  afterEach(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "CORS_ORIGINS");
    } else {
      process.env.CORS_ORIGINS = previous;
    }
  });

  it("keeps the dev origins and adds exact and wildcard entries", () => {
    const origins = getCorsOrigins();
    expect(origins).toContain("http://localhost:8082");
    expect(origins).toContain("https://terreno-frontend.vercel.app");
    expect(origins.some((origin) => origin instanceof RegExp)).toBe(true);
  });

  it("hands Better Auth the raw wildcard pattern", () => {
    const config = buildBetterAuthConfig();
    expect(config?.trustedOrigins).toContain(PREVIEW_PATTERN);
    expect(config?.trustedOrigins).toContain("https://terreno-frontend.vercel.app");
  });

  it("reflects a preview origin on preflight and refuses an unlisted one", async () => {
    const app = await start(true);
    const preview = "https://terreno-frontend-a1b2c3d4e-terrenolabs.vercel.app";

    const allowed = await supertest(app)
      .options("/openapi.json")
      .set("Origin", preview)
      .set("Access-Control-Request-Method", "GET");
    expect(allowed.headers["access-control-allow-origin"]).toBe(preview);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const refused = await supertest(app)
      .options("/openapi.json")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "GET");
    expect(refused.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
