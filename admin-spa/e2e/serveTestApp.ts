import path from "node:path";
import express from "express";
import {DateTime} from "luxon";
import {AdminSpaServeApp} from "../src/serve";
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_ADMIN_SESSION_COOKIE,
  E2E_ADMIN_SESSION_TOKEN,
  E2E_MEMBER_EMAIL,
  E2E_MEMBER_PASSWORD,
} from "./credentials";

// Pre-built bundle lives at admin-spa/dist. Resolved explicitly (rather than relying on
// the plugin's compiled-location default) so the e2e works when run from TS source.
const DIST_DIR = path.resolve(__dirname, "../dist");

const SESSION_COOKIE = E2E_ADMIN_SESSION_COOKIE;
const SESSION_TOKEN = E2E_ADMIN_SESSION_TOKEN;

const MEMBER_SESSION_COOKIE = "admin_spa_e2e_member_session";
const MEMBER_SESSION_TOKEN = "admin-spa-e2e-member-session-token";

const E2E_MEMBER_USER = {
  createdAt: DateTime.fromISO("2026-01-01T00:00:00Z").toISO(),
  email: E2E_MEMBER_EMAIL,
  emailVerified: true,
  id: "admin-spa-e2e-member-id",
  name: "Member E2E",
  updatedAt: DateTime.fromISO("2026-01-01T00:00:00Z").toISO(),
};

const E2E_ADMIN_USER = {
  createdAt: DateTime.fromISO("2026-01-01T00:00:00Z").toISO(),
  email: E2E_ADMIN_EMAIL,
  emailVerified: true,
  id: "admin-spa-e2e-user-id",
  name: "Admin E2E",
  updatedAt: DateTime.fromISO("2026-01-01T00:00:00Z").toISO(),
};

// Minimal admin config matching @terreno/admin-backend's /admin/config response shape,
// enough for AdminGate (200 = admin) and AdminHome (slot widgets) to render.
const ADMIN_CONFIG = {
  customScreens: [],
  home: {
    slots: {
      main: ["modelsGrid"],
    },
    title: "Admin",
  },
  models: [
    // A windowed sync model (string `_id`, `adminBroadcast`, a sync collection): the SPA
    // starts a syncdb client for it, which the shell must not wait on for its first render.
    {
      adminBroadcast: true,
      defaultSort: "-created",
      displayName: "Notes",
      fields: {
        _id: {required: false, type: "string"},
        body: {required: false, type: "string"},
      },
      listFields: ["body"],
      name: "Note",
      routePath: "/admin/notes",
      syncCollection: "notes",
    },
    {
      defaultSort: "-created",
      displayName: "Todos",
      fields: {
        completed: {required: false, type: "boolean"},
        title: {required: true, type: "string"},
      },
      listFields: ["title", "completed"],
      name: "Todo",
      routePath: "/admin/todos",
    },
    {
      defaultSort: "-created",
      displayName: "Users",
      fields: {
        admin: {required: false, type: "boolean"},
        email: {required: true, type: "string"},
      },
      listFields: ["email", "admin"],
      name: "User",
      routePath: "/admin/users",
    },
  ],
};

const hasSession = (req: express.Request): boolean => {
  return (req.headers.cookie ?? "").includes(`${SESSION_COOKIE}=${SESSION_TOKEN}`);
};

const hasMemberSession = (req: express.Request): boolean => {
  return (req.headers.cookie ?? "").includes(`${MEMBER_SESSION_COOKIE}=${MEMBER_SESSION_TOKEN}`);
};

/**
 * Minimal Express app that serves the pre-built admin SPA via `AdminSpaServeApp`,
 * plus an in-memory mock of the better-auth endpoints the SPA's login flow uses
 * (`/api/auth/sign-in/email`, `/api/auth/get-session`) and the admin metadata
 * endpoint (`/admin/config`). No database or real backend is required, so the
 * Playwright e2e can exercise the full anonymous -> login -> admin home
 * flow against the static bundle. Used by the smoke check and Playwright e2e.
 */
export const createTestApp = (): express.Express => {
  const app = express();
  app.use(express.json());

  // Mock better-auth email sign-in: valid credentials set a session cookie.
  app.post("/api/auth/sign-in/email", (req, res) => {
    const {email, password} = req.body ?? {};
    if (email === E2E_MEMBER_EMAIL && password === E2E_MEMBER_PASSWORD) {
      res.cookie(MEMBER_SESSION_COOKIE, MEMBER_SESSION_TOKEN, {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      });
      res.json({redirect: false, token: MEMBER_SESSION_TOKEN, user: E2E_MEMBER_USER});
      return;
    }
    if (email !== E2E_ADMIN_EMAIL || password !== E2E_ADMIN_PASSWORD) {
      res.status(401).json({
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      });
      return;
    }
    res.cookie(SESSION_COOKIE, SESSION_TOKEN, {httpOnly: true, path: "/", sameSite: "lax"});
    res.json({redirect: false, token: SESSION_TOKEN, user: E2E_ADMIN_USER});
  });

  // Mock better-auth session lookup: returns the session for the cookie, else null.
  app.get("/api/auth/get-session", (req, res) => {
    if (hasMemberSession(req) && !hasSession(req)) {
      res.json({
        session: {
          expiresAt: DateTime.now().plus({days: 7}).toISO(),
          id: "admin-spa-e2e-member-session-id",
          token: MEMBER_SESSION_TOKEN,
          userId: E2E_MEMBER_USER.id,
        },
        user: E2E_MEMBER_USER,
      });
      return;
    }
    if (!hasSession(req)) {
      res.json(null);
      return;
    }
    res.json({
      session: {
        expiresAt: DateTime.now().plus({days: 7}).toISO(),
        id: "admin-spa-e2e-session-id",
        token: SESSION_TOKEN,
        userId: E2E_ADMIN_USER.id,
      },
      user: E2E_ADMIN_USER,
    });
  });

  // Mock better-auth sign-out: clears the session cookie.
  app.post("/api/auth/sign-out", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, {path: "/"});
    res.clearCookie(MEMBER_SESSION_COOKIE, {path: "/"});
    res.json({success: true});
  });

  // Mock admin metadata endpoint: 200 for the signed-in admin, 401 otherwise
  // (AdminGate treats 200 as "admin" and 401 as "logged out").
  app.get("/admin/config", (req, res) => {
    if (hasMemberSession(req) && !hasSession(req)) {
      res.status(403).json({title: "Admins only"});
      return;
    }
    if (!hasSession(req)) {
      res.status(401).json({title: "Not authenticated"});
      return;
    }
    res.json(ADMIN_CONFIG);
  });

  // Mock profile endpoint the gate fetches for the shell payload (`GET /auth/me`).
  app.get("/auth/me", (req, res) => {
    if (hasMemberSession(req) && !hasSession(req)) {
      res.json({data: {_id: E2E_MEMBER_USER.id, admin: false, email: E2E_MEMBER_EMAIL}});
      return;
    }
    if (!hasSession(req)) {
      res.status(401).json({title: "Not authenticated"});
      return;
    }
    res.json({data: {_id: E2E_ADMIN_USER.id, admin: true, email: E2E_ADMIN_EMAIL}});
  });

  // Stand-in for the real session middleware: the SSR gate reads `req.user`, which the
  // backend's Better Auth middleware sets from the session cookie.
  app.use((req, _res, next) => {
    if (hasSession(req)) {
      (req as unknown as {user: unknown}).user = {_id: E2E_ADMIN_USER.id, admin: true};
    } else if (hasMemberSession(req)) {
      (req as unknown as {user: unknown}).user = {_id: E2E_MEMBER_USER.id, admin: false};
    }
    next();
  });

  const plugin = new AdminSpaServeApp({
    appConfig: {
      brandName: "Terreno Admin (e2e)",
      primaryColor: "#2563EB",
      providers: ["email", "google"],
    },
    basePath: "/console",
    distDir: DIST_DIR,
  });
  plugin.register(app);
  return app;
};

// Run directly (e.g. `bun e2e/serveTestApp.ts`) to start the server for Playwright.
if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4100);
  createTestApp().listen(port, () => {
    console.info(`[admin-spa e2e] serving SPA at http://localhost:${port}/console/`);
  });
}
