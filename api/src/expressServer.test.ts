import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {Writable} from "node:stream";
import express, {type Router} from "express";
import supertest from "supertest";
import winston from "winston";

import type {UserModel as UserModelType} from "./auth";
import {
  createRouter,
  createRouterWithAuth,
  cronjob,
  logRequests,
  setupEnvironment,
  wrapScript,
} from "./expressServer";
import {logger, winstonLogger} from "./logger";
import {TerrenoApp} from "./terrenoApp";
import {UserModel} from "./tests";

const typedUserModel = UserModel as unknown as UserModelType;

// `routeMount` is set by createRouter's internal middleware and is not part of the
// Express request types.
interface RouteMountRequest extends express.Request {
  routeMount?: string[] | string;
}

describe("expressServer", () => {
  describe("setupEnvironment", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset env to a clean state with required values
      process.env = {
        ...originalEnv,
        REFRESH_TOKEN_SECRET: "test-refresh-secret",
        SESSION_SECRET: "test-session-secret",
        TOKEN_ISSUER: "test-issuer",
        TOKEN_SECRET: "test-secret",
      };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("throws error when TOKEN_ISSUER is not set", () => {
      process.env.TOKEN_ISSUER = "";
      expect(() => setupEnvironment()).toThrow("TOKEN_ISSUER must be set in env.");
    });

    it("throws error when TOKEN_SECRET is not set", () => {
      process.env.TOKEN_SECRET = "";
      expect(() => setupEnvironment()).toThrow("TOKEN_SECRET must be set.");
    });

    it("throws error when REFRESH_TOKEN_SECRET is not set", () => {
      process.env.REFRESH_TOKEN_SECRET = "";
      expect(() => setupEnvironment()).toThrow("REFRESH_TOKEN_SECRET must be set.");
    });

    it("throws error when SESSION_SECRET is not set", () => {
      process.env.SESSION_SECRET = "";
      expect(() => setupEnvironment()).toThrow("SESSION_SECRET must be set.");
    });

    it("does not throw when all required env vars are set", () => {
      expect(() => setupEnvironment()).not.toThrow();
    });
  });

  describe("logRequests", () => {
    it("attaches request and session context to route logs", async () => {
      const logs: string[] = [];
      const logStream = new Writable({
        write(chunk, _encoding, callback) {
          logs.push(chunk.toString());
          callback();
        },
      });
      const transport = new winston.transports.Stream({
        format: winston.format.json(),
        stream: logStream,
      });

      const app = new TerrenoApp({
        configureApp: (router) => {
          router.get("/context-test", (req, res) => {
            logger.info("context route log");
            return res.json({requestId: req.requestId, sessionId: req.sessionId});
          });
        },
        logRequests: false,
        skipListen: true,
        userModel: typedUserModel,
      }).build();
      winstonLogger.add(transport);

      const res = await supertest(app)
        .get("/context-test")
        .set("X-Request-ID", "req-123")
        .set("X-Session-ID", "session-123")
        .expect(200);

      expect(res.headers["x-request-id"]).toBe("req-123");
      expect(res.headers["x-session-id"]).toBe("session-123");
      expect(res.body).toEqual({requestId: "req-123", sessionId: "session-123"});

      const parsedLog = logs
        .map((entry) => JSON.parse(entry))
        .find((entry) => entry.message === "context route log");
      expect(parsedLog).toBeDefined();
      expect(parsedLog.requestId).toBe("req-123");
      expect(parsedLog.sessionId).toBe("session-123");

      winstonLogger.remove(transport);
    });

    it("logs request with admin user type", () => {
      const req = {
        body: {},
        method: "GET",
        url: "/test",
        user: {admin: true, id: "admin-123"},
      };
      const res = {
        locals: {},
        on: () => {},
      };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      logRequests(req, res, next);
      expect(nextCalled).toBe(true);
    });

    it("logs request with test user type", () => {
      const req = {
        body: {},
        method: "GET",
        url: "/test",
        user: {id: "test-123", testUser: true},
      };
      const res = {
        locals: {},
        on: () => {},
      };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      logRequests(req, res, next);
      expect(nextCalled).toBe(true);
    });

    it("logs request with custom user type", () => {
      const req = {
        body: {},
        method: "GET",
        url: "/test",
        user: {id: "user-123", type: "CustomType"},
      };
      const res = {
        locals: {},
        on: () => {},
      };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      logRequests(req, res, next);
      expect(nextCalled).toBe(true);
    });

    it("masks password in body", () => {
      const req = {
        body: {password: "secret123", username: "testuser"},
        method: "POST",
        url: "/login",
      };
      const res = {
        locals: {},
        on: () => {},
      };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      logRequests(req, res, next);
      expect(nextCalled).toBe(true);
      // Original body should not be modified
      expect(req.body.password).toBe("secret123");
    });

    it("redacts token and newPassword in logged request bodies", () => {
      const logged: string[] = [];
      const originalDebug = logger.debug;
      logger.debug = ((message: string) => {
        logged.push(message);
      }) as typeof logger.debug;
      try {
        const req = {
          body: {newPassword: "fresh-secret", token: "one-time-token", username: "testuser"},
          method: "POST",
          url: "/auth/resetPassword",
        };
        const res = {
          locals: {},
          on: () => {},
        };
        logRequests(req as never, res as never, () => {});
        const combined = logged.join("\n");
        expect(combined).toContain("<REDACTED>");
        expect(combined).not.toContain("fresh-secret");
        expect(combined).not.toContain("one-time-token");
        expect(req.body.token).toBe("one-time-token");
        expect(req.body.newPassword).toBe("fresh-secret");
      } finally {
        logger.debug = originalDebug;
      }
    });

    it("redacts free-text note and reason fields that can hold PHI", () => {
      const logged: string[] = [];
      const originalDebug = logger.debug;
      logger.debug = ((message: string) => {
        logged.push(message);
      }) as typeof logger.debug;
      try {
        const req = {
          body: {
            consentFormId: "form-1",
            note: "Guardian Jane agreed by phone",
            provisionalNote: "Also mentioned the diagnosis",
            reason: "Signed for the wrong member",
          },
          method: "POST",
          url: "/consent-responses/provisional",
        };
        logRequests(req as never, {locals: {}, on: () => {}} as never, () => {});
        const combined = logged.join("\n");
        expect(combined).not.toContain("Guardian Jane");
        expect(combined).not.toContain("diagnosis");
        expect(combined).not.toContain("wrong member");
        expect(combined).toContain("form-1");
        expect(req.body.note).toBe("Guardian Jane agreed by phone");
      } finally {
        logger.debug = originalDebug;
      }
    });

    it("redacts credentials under any key name and at any depth in logged bodies", () => {
      const logged: string[] = [];
      const originalDebug = logger.debug;
      logger.debug = ((message: string) => {
        logged.push(message);
      }) as typeof logger.debug;
      try {
        const req = {
          body: {
            client_secret: "dummy-client-secret",
            code_verifier: "dummy-code-verifier",
            currentPassword: "dummy-current-pass",
            idToken: {token: "dummy-id-token"},
            integrations: [{apiKey: "dummy-api-key", name: "listed-integration"}],
            otp: "123456",
            provider: "google",
            refresh_token: "dummy-refresh-token",
          },
          method: "POST",
          url: "/api/auth/sign-in/social",
        };
        logRequests(req as never, {locals: {}, on: () => {}} as never, () => {});
        const combined = logged.join("\n");
        for (const secret of [
          "dummy-client-secret",
          "dummy-code-verifier",
          "dummy-current-pass",
          "dummy-id-token",
          "dummy-api-key",
          "123456",
          "dummy-refresh-token",
        ]) {
          expect(combined).not.toContain(secret);
        }
        expect(combined).toContain("google");
        expect(combined).toContain("listed-integration");
        expect(req.body.idToken.token).toBe("dummy-id-token");
      } finally {
        logger.debug = originalDebug;
      }
    });

    it("redacts OAuth codes and other credential query params in request URLs", () => {
      const logged: string[] = [];
      const originalDebug = logger.debug;
      logger.debug = ((message: string) => {
        logged.push(message);
      }) as typeof logger.debug;
      try {
        const req = {
          method: "GET",
          url: "/api/auth/callback/google?code=dummy-oauth-code&state=abc&client_secret=dummy-cs",
        };
        logRequests(req as never, {locals: {}, on: () => {}} as never, () => {});
        const combined = logged.join("\n");
        expect(combined).not.toContain("dummy-oauth-code");
        expect(combined).not.toContain("dummy-cs");
        expect(combined).toContain("state=abc");
      } finally {
        logger.debug = originalDebug;
      }
    });

    it("redacts token query params in request URLs", () => {
      const logged: string[] = [];
      const originalDebug = logger.debug;
      logger.debug = ((message: string) => {
        logged.push(message);
      }) as typeof logger.debug;
      try {
        const req = {
          body: {},
          method: "GET",
          url: "/api/auth/verify-email?token=one-time-token",
        };
        const res = {
          locals: {},
          on: () => {},
        };
        logRequests(req as never, res as never, () => {});
        const combined = logged.join("\n");
        expect(combined).toContain("token=%3CREDACTED%3E");
        expect(combined).not.toContain("one-time-token");
      } finally {
        logger.debug = originalDebug;
      }
    });

    it("triggers onFinished callback with route info", async () => {
      const app = express();
      app.use(logRequests);
      app.get("/test", (req, res) => {
        (req as RouteMountRequest).routeMount = "/api";
        res.json({ok: true});
      });

      await supertest(app).get("/test").expect(200);
    });

    it("triggers onFinished callback without route (for 404)", async () => {
      const app = express();
      app.use(logRequests);
      // No routes defined, so it will 404

      await supertest(app).get("/nonexistent").expect(404);
    });

    it("logs slow GET requests when enabled", async () => {
      const app = express();
      // Store logging options
      app.use((_req, res, next) => {
        res.locals.loggingOptions = {
          logSlowRequests: true,
          logSlowRequestsReadMs: 1, // Very low threshold to trigger slow request warning
        };
        next();
      });
      app.use(logRequests);
      app.get("/slow", async (_req, res) => {
        // Add small delay to exceed threshold
        await new Promise((resolve) => setTimeout(resolve, 10));
        res.json({ok: true});
      });

      await supertest(app).get("/slow").expect(200);
    });

    it("logs slow write requests when enabled", async () => {
      const app = express();
      app.use(express.json());
      app.use((_req, res, next) => {
        res.locals.loggingOptions = {
          logSlowRequests: true,
          logSlowRequestsWriteMs: 1, // Very low threshold
        };
        next();
      });
      app.use(logRequests);
      app.post("/slow", async (_req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        res.json({ok: true});
      });

      await supertest(app).post("/slow").send({data: "test"}).expect(200);
    });

    it("handles request with route path only (no routeMount)", async () => {
      const app = express();
      app.use(logRequests);
      app.get("/test", (_req, res) => {
        // No routeMount set
        res.json({ok: true});
      });

      await supertest(app).get("/test").expect(200);
    });
  });

  describe("createRouter", () => {
    it("creates router with root path and adds routes", () => {
      let routesCalled = false;
      const addRoutes = (router: Router) => {
        routesCalled = true;
        router.get("/test", (_req, res) => res.send("ok"));
      };

      const result = createRouter("/api", addRoutes);

      expect(result[0]).toBe("/api");
      expect(routesCalled).toBe(true);
      expect(result.length).toBe(2); // [path, router]
    });

    it("creates router with middleware", () => {
      const middleware1: express.RequestHandler = (_req, _res, next) => next();
      const middleware2: express.RequestHandler = (_req, _res, next) => next();
      const addRoutes = () => {};

      const result = createRouter("/api", addRoutes, [middleware1, middleware2]);

      expect(result[0]).toBe("/api");
      expect(result.length).toBe(4); // [path, middleware1, middleware2, router]
    });

    it("routePathMiddleware sets routeMount on request", () => {
      const addRoutes = (router: Router) => {
        router.get("/test", (req, res) => {
          res.json({routeMount: (req as RouteMountRequest).routeMount});
        });
      };

      const result = createRouter("/api", addRoutes);
      const app = express();
      app.use(...(result as [string, ...express.RequestHandler[]]));

      // The routePathMiddleware is internal, but we can verify the router works
      expect(result[0]).toBe("/api");
    });
  });

  describe("createRouterWithAuth", () => {
    it("creates router with passport authentication middleware", () => {
      let routesCalled = false;
      const addRoutes = (router: Router) => {
        routesCalled = true;
        router.get("/protected", (_req, res) => res.send("ok"));
      };

      const result = createRouterWithAuth("/secure", addRoutes);

      expect(result[0]).toBe("/secure");
      expect(routesCalled).toBe(true);
      // Should have path + passport middleware + router = 3 elements minimum
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("includes additional middleware", () => {
      const customMiddleware: express.RequestHandler = (_req, _res, next) => next();
      const addRoutes = () => {};

      const result = createRouterWithAuth("/secure", addRoutes, [customMiddleware]);

      expect(result[0]).toBe("/secure");
      // path + passport + customMiddleware + router
      expect(result.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("cronjob", () => {
    it("accepts custom cron schedule for hourly", () => {
      const callback = () => {};

      // Every hour at minute 0
      expect(() => cronjob("test-hourly", "0 * * * *", callback)).not.toThrow();
    });

    it("accepts custom cron schedule for minutely", () => {
      const callback = () => {};

      // Every minute
      expect(() => cronjob("test-minutely", "* * * * *", callback)).not.toThrow();
    });

    it("accepts custom cron schedule", () => {
      const callback = () => {};

      // Every day at midnight
      expect(() => cronjob("test-custom", "0 0 * * *", callback)).not.toThrow();
    });

    it("throws error for invalid cron schedule", () => {
      const callback = () => {};

      expect(() => cronjob("test-invalid", "invalid-cron", callback)).toThrow(
        "Failed to create cronjob"
      );
    });

    it("accepts hourly alias", () => {
      const callback = () => {};
      expect(() => cronjob("test-hourly-alias", "hourly", callback)).not.toThrow();
    });

    it("accepts minutely alias", () => {
      const callback = () => {};
      expect(() => cronjob("test-minutely-alias", "minutely", callback)).not.toThrow();
    });
  });

  describe("createRouter routePathMiddleware", () => {
    it("initializes routeMount array when not present", async () => {
      const addRoutes = (router: Router) => {
        router.get("/test", (req, res) => {
          res.json({routeMount: (req as RouteMountRequest).routeMount});
        });
      };

      const result = createRouter("/api", addRoutes);
      const app = express();
      app.use(...(result as [string, ...express.RequestHandler[]]));

      const response = await supertest(app).get("/api/test").expect(200);
      expect(response.body.routeMount).toEqual(["/api"]);
    });

    it("appends to existing routeMount array", async () => {
      const addRoutes = (router: Router) => {
        router.get("/test", (req, res) => {
          res.json({routeMount: (req as RouteMountRequest).routeMount});
        });
      };

      // Create nested routers
      const innerResult = createRouter("/inner", addRoutes);
      const outerAddRoutes = (router: Router) => {
        router.use(...(innerResult as [string, ...express.RequestHandler[]]));
      };
      const outerResult = createRouter("/outer", outerAddRoutes);

      const app = express();
      app.use(...(outerResult as [string, ...express.RequestHandler[]]));

      const response = await supertest(app).get("/outer/inner/test").expect(200);
      expect(response.body.routeMount).toEqual(["/outer", "/inner"]);
    });
  });

  describe("TerrenoApp", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        REFRESH_TOKEN_SECRET: "test-refresh-secret",
        SESSION_SECRET: "test-session-secret",
        TOKEN_EXPIRES_IN: "1h",
        TOKEN_ISSUER: "test-issuer",
        TOKEN_SECRET: "test-secret",
      };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("creates server with skipListen option", () => {
      const configureApp = (): void => {};

      const app = new TerrenoApp({
        configureApp,
        skipListen: true,
        userModel: typedUserModel,
      }).build();

      expect(app).toBeDefined();
    });

    it("creates server with beforeJsonSetup option", () => {
      let middlewareCalled = false;
      const configureApp = (): void => {};

      const app = new TerrenoApp({
        beforeJsonSetup: (httpApp: express.Application) => {
          middlewareCalled = true;
          const passthrough: express.RequestHandler = (_req, _res, next) => next();
          httpApp.use(passthrough);
        },
        configureApp,
        skipListen: true,
        userModel: typedUserModel,
      }).build();

      expect(app).toBeDefined();
      expect(middlewareCalled).toBe(true);
    });

    it("creates server with custom corsOrigin", () => {
      const configureApp = (): void => {};

      const app = new TerrenoApp({
        configureApp,
        corsOrigin: "https://example.com",
        skipListen: true,
        userModel: typedUserModel,
      }).build();

      expect(app).toBeDefined();
    });

    it("does not log requests when loggingOptions.logRequests is false", async () => {
      const logged: string[] = [];
      const originalDebug = logger.debug;
      logger.debug = ((message: string) => {
        logged.push(message);
      }) as typeof logger.debug;
      try {
        const app = new TerrenoApp({
          configureApp: (httpApp: Router) => {
            httpApp.post("/echo", (_req, res) => {
              res.json({ok: true});
            });
          },
          loggingOptions: {
            disableConsoleLogging: true,
            disableFileLogging: true,
            logRequests: false,
          },
          skipListen: true,
          userModel: typedUserModel,
        }).build();

        await supertest(app).post("/echo").send({note: "dummy-logged-body"}).expect(200);

        expect(logged.join("\n")).not.toContain("dummy-logged-body");
      } finally {
        logger.debug = originalDebug;
      }
    });

    it("creates server with authOptions", () => {
      const configureApp = (): void => {};

      const app = new TerrenoApp({
        authOptions: {
          generateJWTPayload: (user) => ({customField: "test", id: user._id}),
          generateTokenExpiration: () => "2h",
        },
        configureApp,
        skipListen: true,
        userModel: typedUserModel,
      }).build();

      expect(app).toBeDefined();
    });
  });

  describe("logRequests edge cases", () => {
    it("warns for request without route but with success status code", async () => {
      const app = express();
      app.use(logRequests);
      // Middleware that sets statusCode < 400 but doesn't define route
      app.use((_req, res) => {
        res.status(200).json({ok: true});
      });

      await supertest(app).get("/no-route").expect(200);
    });

    it("handles request with routeMount as string (legacy)", async () => {
      const app = express();
      app.use(logRequests);
      app.get("/test", (req, res) => {
        (req as RouteMountRequest).routeMount = "/api"; // String instead of array
        res.json({ok: true});
      });

      await supertest(app).get("/test").expect(200);
    });
  });

  describe("TerrenoApp with full integration", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        REFRESH_TOKEN_SECRET: "test-refresh-secret",
        SESSION_SECRET: "test-session-secret",
        TOKEN_EXPIRES_IN: "1h",
        TOKEN_ISSUER: "test-issuer",
        TOKEN_SECRET: "test-secret",
      };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("sets Sentry transaction ID tag from header", async () => {
      const configureApp = (httpApp: Router) => {
        httpApp.get("/test", (_req, res) => {
          res.json({ok: true});
        });
      };

      const app = new TerrenoApp({
        configureApp,
        skipListen: true,
        userModel: typedUserModel,
      }).build();

      await supertest(app).get("/test").set("X-Transaction-ID", "txn-123").expect(200);
    });

    it("sets Sentry session ID tag from header", async () => {
      const configureApp = (httpApp: Router) => {
        httpApp.get("/test", (_req, res) => {
          res.json({ok: true});
        });
      };

      const app = new TerrenoApp({
        configureApp,
        skipListen: true,
        userModel: typedUserModel,
      }).build();

      await supertest(app).get("/test").set("X-Session-ID", "session-456").expect(200);
    });

    it("sets both transaction and session ID tags", async () => {
      const configureApp = (httpApp: Router) => {
        httpApp.get("/test", (_req, res) => {
          res.json({ok: true});
        });
      };

      const app = new TerrenoApp({
        configureApp,
        skipListen: true,
        userModel: typedUserModel,
      }).build();

      await supertest(app)
        .get("/test")
        .set("X-Transaction-ID", "txn-123")
        .set("X-Session-ID", "session-456")
        .expect(200);
    });

    it("handles fallthrough error handler", async () => {
      const configureApp = (httpApp: Router) => {
        httpApp.get("/error", () => {
          throw new Error("Unexpected error");
        });
      };

      const app = new TerrenoApp({
        configureApp,
        skipListen: true,
        userModel: typedUserModel,
      }).build();

      await supertest(app).get("/error").expect(500);
    });

    it("handles loggingOptions passed to TerrenoApp", async () => {
      const configureApp = (httpApp: Router) => {
        httpApp.get("/test", (_req, res) => {
          res.json({ok: true});
        });
      };

      const app = new TerrenoApp({
        configureApp,
        loggingOptions: {
          logSlowRequests: true,
          logSlowRequestsReadMs: 100,
        },
        skipListen: true,
        userModel: typedUserModel,
      }).build();

      await supertest(app).get("/test").expect(200);
    });

    it("re-throws when configureApp throws during build", () => {
      const configureApp = () => {
        throw new Error("Route init boom");
      };

      expect(() =>
        new TerrenoApp({
          configureApp,
          skipListen: true,
          userModel: typedUserModel,
        }).build()
      ).toThrow("Route init boom");
    });
  });

  describe("wrapScript", () => {
    const originalExit = process.exit;

    beforeEach(() => {
      process.env = {
        ...process.env,
        REFRESH_TOKEN_SECRET: "test-refresh-secret",
        SESSION_SECRET: "test-session-secret",
        TOKEN_EXPIRES_IN: "1h",
        TOKEN_ISSUER: "test-issuer",
        TOKEN_SECRET: "test-secret",
      };
      // Prevent process.exit from killing the test runner
      process.exit = mock(() => {
        throw new Error("__EXIT__");
      }) as unknown as typeof process.exit;
    });

    afterEach(() => {
      process.exit = originalExit;
    });

    it("calls process.exit(0) on success", async () => {
      const func = async () => "done";
      await expect(wrapScript(func, {terminateTimeout: 0})).rejects.toThrow("__EXIT__");
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it("calls process.exit(1) on error", async () => {
      const func = async () => {
        throw new Error("script failed");
      };
      await expect(wrapScript(func, {terminateTimeout: 0})).rejects.toThrow("__EXIT__");
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("calls onFinish with the result", async () => {
      let finishResult: unknown;
      const func = async () => "result-value";
      const onFinish = async (r: unknown) => {
        finishResult = r;
      };
      await expect(wrapScript(func, {onFinish, terminateTimeout: 0})).rejects.toThrow("__EXIT__");
      expect(finishResult).toBe("result-value");
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it("sets up warn and terminate timeouts when terminateTimeout is not 0", async () => {
      const func = async () => "ok";
      await expect(wrapScript(func, {terminateTimeout: 600})).rejects.toThrow("__EXIT__");
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it("passes slackChannel option through", async () => {
      const func = async () => "ok";
      await expect(
        wrapScript(func, {slackChannel: "test-channel", terminateTimeout: 0})
      ).rejects.toThrow("__EXIT__");
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe("wrapScript", () => {
    const originalExit = process.exit;
    const originalSetTimeout = globalThis.setTimeout;
    const timerIds: ReturnType<typeof setTimeout>[] = [];

    beforeEach(() => {
      process.exit = mock(() => {
        throw new Error("process.exit called");
      }) as unknown as typeof process.exit;
      // Capture timer handles so we can clear them after each test
      globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
        const id = originalSetTimeout(...args);
        timerIds.push(id);
        return id;
      }) as typeof setTimeout;
    });

    afterEach(() => {
      for (const id of timerIds) {
        clearTimeout(id);
      }
      timerIds.length = 0;
      globalThis.setTimeout = originalSetTimeout;
      process.exit = originalExit;
    });

    it("runs a successful script and calls process.exit(0)", async () => {
      const func = mock(async () => "done");

      await expect(wrapScript(func, {terminateTimeout: 0})).rejects.toThrow("process.exit called");

      expect(func).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it("calls onFinish callback on success", async () => {
      const onFinish = mock(async () => {});
      const func = mock(async () => "result");

      await expect(wrapScript(func, {onFinish, terminateTimeout: 0})).rejects.toThrow(
        "process.exit called"
      );

      expect(onFinish).toHaveBeenCalledWith("result");
    });

    it("calls process.exit(1) when script throws", async () => {
      const func = mock(async () => {
        throw new Error("script failure");
      });

      await expect(wrapScript(func, {terminateTimeout: 0})).rejects.toThrow("process.exit called");

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("sets up timeout warnings when terminateTimeout is not 0", async () => {
      const func = mock(async () => "done");

      await expect(wrapScript(func, {terminateTimeout: 600})).rejects.toThrow(
        "process.exit called"
      );

      expect(func).toHaveBeenCalled();
    });

    it("uses default terminateTimeout when not specified", async () => {
      const func = mock(async () => "done");

      await expect(wrapScript(func)).rejects.toThrow("process.exit called");

      expect(func).toHaveBeenCalled();
    });

    it("fires warning timeout callback when script is slow", async () => {
      // terminateTimeout = 0.3s → warnTime = 150ms, closeTime = 300ms
      // The func takes 200ms, so the warn callback fires at 150ms,
      // but func completes at 200ms before the terminate callback at 300ms.
      // afterEach clears the terminate timer.
      const func = mock(
        () => new Promise<string>((resolve) => originalSetTimeout(() => resolve("done"), 200))
      );
      try {
        await wrapScript(func, {terminateTimeout: 0.3});
      } catch {
        // process.exit(0) throws
      }
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe("TerrenoApp with listen (skipListen false)", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        PORT: "0", // Use port 0 to let OS assign a random free port
        REFRESH_TOKEN_SECRET: "test-refresh-secret",
        SESSION_SECRET: "test-session-secret",
        TOKEN_EXPIRES_IN: "1h",
        TOKEN_ISSUER: "test-issuer",
        TOKEN_SECRET: "test-secret",
      };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("starts the server when skipListen is false", async () => {
      const configureApp = (): void => {};
      const http = await import("node:http");
      const originalListen = http.Server.prototype.listen;
      http.Server.prototype.listen = mock(function (this: unknown, ...args: unknown[]) {
        const cb = args.find((a: unknown) => typeof a === "function") as (() => void) | undefined;
        if (cb) {
          cb();
        }
        return this;
      }) as unknown as typeof originalListen;
      try {
        const app = new TerrenoApp({
          configureApp,
          skipListen: false,
          userModel: typedUserModel,
        }).start();
        expect(app).toBeDefined();
      } finally {
        http.Server.prototype.listen = originalListen;
      }
    });

    it("handles listen errors", async () => {
      const configureApp = (): void => {};
      const http = require("node:http") as typeof import("node:http");
      const originalListen = http.Server.prototype.listen;
      const originalExit = process.exit;
      const exit = mock(() => undefined);
      process.exit = exit as unknown as typeof process.exit;
      http.Server.prototype.listen = mock(() => {
        throw new Error("listen failed");
      }) as unknown as typeof originalListen;
      try {
        new TerrenoApp({
          configureApp,
          skipListen: false,
          userModel: typedUserModel,
        }).start();
        // start() binds listen first, then awaits ensureSyncIndexes(), so the
        // exit-on-listen-error path still settles asynchronously if listen throws.
        const deadline = Date.now() + 2_000;
        while (exit.mock.calls.length === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(exit).toHaveBeenCalledWith(1);
      } finally {
        http.Server.prototype.listen = originalListen;
        process.exit = originalExit;
      }
    });
  });

  describe("TerrenoApp with listen", () => {
    const originalEnv = process.env;
    const http = require("node:http") as typeof import("node:http");
    let activeServer: import("node:http").Server | null = null;
    let originalListen: typeof http.Server.prototype.listen | null = null;

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        PORT: "0",
        REFRESH_TOKEN_SECRET: "test-refresh-secret",
        SESSION_SECRET: "test-session-secret",
        TOKEN_EXPIRES_IN: "1h",
        TOKEN_ISSUER: "test-issuer",
        TOKEN_SECRET: "test-secret",
      };

      originalListen = http.Server.prototype.listen;
      http.Server.prototype.listen = function (
        this: import("node:http").Server,
        ...args: unknown[]
      ) {
        activeServer = this;
        return (originalListen as (...listenArgs: unknown[]) => import("node:http").Server).apply(
          this,
          args
        );
      } as typeof http.Server.prototype.listen;
    });

    afterEach(async () => {
      process.env = originalEnv;
      if (originalListen) {
        http.Server.prototype.listen = originalListen;
      }
      if (activeServer) {
        const server = activeServer;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        activeServer = null;
      }
    });

    it("starts listening on a port when skipListen is false", async () => {
      const configureApp = (): void => {};

      const app = new TerrenoApp({
        configureApp,
        skipListen: false,
        userModel: typedUserModel,
      }).start();

      expect(app).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("attaches the Express app to an already-listening httpServer", async () => {
      const http = await import("node:http");
      const holder = http.createServer((_req, res) => {
        res.writeHead(503);
        res.end("starting");
      });
      await new Promise<void>((resolve) => {
        holder.listen(0, "127.0.0.1", () => {
          resolve();
        });
      });
      const address = holder.address();
      const port = typeof address === "object" && address ? address.port : 0;
      try {
        new TerrenoApp({
          configureApp: (app) => {
            app.get("/ping", (_req, res) => {
              res.json({ok: true});
            });
          },
          httpServer: holder,
          skipListen: false,
          userModel: typedUserModel,
        }).start();
        const deadline = Date.now() + 2_000;
        let status = 0;
        while (Date.now() < deadline) {
          const response = await fetch(`http://127.0.0.1:${port}/ping`);
          status = response.status;
          if (status === 200) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(status).toBe(200);
      } finally {
        await new Promise<void>((resolve, reject) => {
          holder.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    });
  });

  describe("wrapScript timeout callbacks", () => {
    const originalEnv = process.env;
    const originalExit = process.exit;
    const originalSetTimeout = globalThis.setTimeout;
    const timerIds: ReturnType<typeof setTimeout>[] = [];
    const timerCallbacks: Array<{callback: () => void; delay: number}> = [];

    beforeEach(() => {
      process.env = {
        ...process.env,
        REFRESH_TOKEN_SECRET: "test-refresh-secret",
        SESSION_SECRET: "test-session-secret",
        TOKEN_EXPIRES_IN: "1h",
        TOKEN_ISSUER: "test-issuer",
        TOKEN_SECRET: "test-secret",
      };
      process.exit = mock(() => {
        throw new Error("__EXIT__");
      }) as unknown as typeof process.exit;

      timerCallbacks.length = 0;
      timerIds.length = 0;
      globalThis.setTimeout = ((cb: () => void, delay: number) => {
        timerCallbacks.push({callback: cb, delay});
        const id = originalSetTimeout(cb, delay);
        timerIds.push(id);
        return id;
      }) as typeof setTimeout;
    });

    afterEach(() => {
      for (const id of timerIds) {
        clearTimeout(id);
      }
      globalThis.setTimeout = originalSetTimeout;
      process.exit = originalExit;
      process.env = originalEnv;
    });

    it("registers warn and terminate timeouts with correct delays", async () => {
      const func = async () => "ok";
      await expect(wrapScript(func, {terminateTimeout: 100})).rejects.toThrow("__EXIT__");

      const warnTimer = timerCallbacks.find((t) => t.delay === 50000);
      const closeTimer = timerCallbacks.find((t) => t.delay === 100000);
      expect(warnTimer).toBeDefined();
      expect(closeTimer).toBeDefined();
    });

    it("terminate timeout callback reports the timeout and exits with code 2", async () => {
      const func = async () => "ok";
      await expect(wrapScript(func, {terminateTimeout: 100})).rejects.toThrow("__EXIT__");

      const closeTimer = timerCallbacks.find((t) => t.delay === 100000);
      expect(closeTimer).toBeDefined();

      const runCloseTimer = closeTimer?.callback as unknown as () => Promise<void>;
      await expect(runCloseTimer()).rejects.toThrow("__EXIT__");
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });

  describe("TerrenoApp error handling", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        REFRESH_TOKEN_SECRET: "test-refresh-secret",
        SESSION_SECRET: "test-session-secret",
        TOKEN_EXPIRES_IN: "1h",
        TOKEN_ISSUER: "test-issuer",
        TOKEN_SECRET: "test-secret",
      };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("throws when configureApp throws during build", () => {
      const configureApp = () => {
        throw new Error("route initialization failed");
      };

      expect(() =>
        new TerrenoApp({
          configureApp,
          skipListen: true,
          userModel: typedUserModel,
        }).build()
      ).toThrow("route initialization failed");
    });
  });
});
