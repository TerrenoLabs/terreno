import {describe, expect, it} from "bun:test";
import express from "express";
import supertest from "supertest";

import {apiErrorMiddleware} from "../errors";
import {createMemoryRateLimitStore} from "./memoryStore";
import {createRouteRateLimitMiddleware, type RouteRateLimitOptions} from "./routeRateLimit";

const buildApp = (
  options: Partial<RouteRateLimitOptions> & {userId?: string} = {}
): express.Application => {
  const {userId, ...limitOptions} = options;
  const app = express();
  app.set("trust proxy", true);
  app.use((req, _res, next) => {
    if (userId) {
      (req as unknown as {user: {id: string}}).user = {id: userId};
    }
    next();
  });
  app.post(
    "/upload",
    createRouteRateLimitMiddleware({max: 1, name: "upload", windowMs: 60_000, ...limitOptions}),
    (_req, res) => {
      res.json({ok: true});
    }
  );
  app.use(apiErrorMiddleware);
  return app;
};

describe("createRouteRateLimitMiddleware", () => {
  it("allows max requests per IP then returns 429 with Retry-After", async () => {
    const app = buildApp();
    await supertest(app).post("/upload").set("X-Forwarded-For", "1.1.1.1").expect(200);
    const res = await supertest(app).post("/upload").set("X-Forwarded-For", "1.1.1.1").expect(429);
    expect(res.headers["retry-after"]).toBe("60");
    expect(res.headers["ratelimit-policy"]).toBe("1;w=60");
    expect(res.body.title).toBe("Too many requests");
  });

  it("keeps separate buckets per IP", async () => {
    const app = buildApp();
    await supertest(app).post("/upload").set("X-Forwarded-For", "1.1.1.1").expect(200);
    await supertest(app).post("/upload").set("X-Forwarded-For", "2.2.2.2").expect(200);
  });

  it("resets after the window elapses", async () => {
    let now = 1_000_000;
    const app = buildApp({now: () => now});
    await supertest(app).post("/upload").expect(200);
    await supertest(app).post("/upload").expect(429);
    now += 60_000;
    await supertest(app).post("/upload").expect(200);
  });

  it("keys by user when keyBy is user", async () => {
    const storeImpl = createMemoryRateLimitStore();
    const appA = buildApp({keyBy: "user", storeImpl, userId: "a"});
    const appB = buildApp({keyBy: "user", storeImpl, userId: "b"});
    await supertest(appA).post("/upload").set("X-Forwarded-For", "1.1.1.1").expect(200);
    await supertest(appB).post("/upload").set("X-Forwarded-For", "1.1.1.1").expect(200);
    await supertest(appA).post("/upload").set("X-Forwarded-For", "2.2.2.2").expect(429);
  });

  it("namespaces buckets by name", async () => {
    const storeImpl = createMemoryRateLimitStore();
    await supertest(buildApp({name: "one", storeImpl}))
      .post("/upload")
      .expect(200);
    await supertest(buildApp({name: "two", storeImpl}))
      .post("/upload")
      .expect(200);
    await supertest(buildApp({name: "one", storeImpl}))
      .post("/upload")
      .expect(429);
  });

  it("rejects invalid configuration", () => {
    expect(() => createRouteRateLimitMiddleware({max: 0, name: "x", windowMs: 1000})).toThrow();
    expect(() => createRouteRateLimitMiddleware({max: 1, name: "", windowMs: 1000})).toThrow();
  });
});
