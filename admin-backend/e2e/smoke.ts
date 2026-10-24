/**
 * Real-process smoke for @terreno/admin-backend. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * The smoke re-runs this file with `serve` as a child process: a minimal TerrenoApp from the
 * compiled `@terreno/api` with one `modelRouter` model that declares `admin:`, and the compiled
 * `AdminApp`, on a free port, against `smokeMongoUri()`. The child seeds one admin user, because
 * signup never grants admin. The parent then checks over real HTTP that the admin reads the admin
 * config and lists the model's documents, and that a signed-up non-admin is denied both. Exits
 * non-zero on the first failed check.
 */
import {
  freePort,
  type SpawnedProcess,
  smokeMongoUri,
  spawnUntilReady,
  stopSmokeMongo,
} from "@terreno/test";
import type express from "express";
import {DateTime} from "luxon";
import type {Schema} from "mongoose";

const SERVE_ARG = "serve";
const PASSWORD = "admin-backend-smoke-password-1";
const WIDGET_DISPLAY_NAME = "Smoke widgets";
/** AdminApp mounts a model at `basePath` + its modelRouter path; the app also serves `/widgets`. */
const ADMIN_WIDGETS_PATH = "/admin/widgets";

interface AdminConfigModel {
  displayName: string;
  name: string;
  routePath: string;
}

interface SmokeWidget {
  _id: string;
  name: string;
}

/**
 * Child: the compiled API with auth, one admin-enabled model, the compiled AdminApp, and a health
 * plugin. Both packages are imported here, not at the top, so the parent process never loads
 * them.
 */
const serve = async (): Promise<void> => {
  const {createdUpdatedPlugin, logger, modelRouter, Permissions, TerrenoApp} = await import(
    "@terreno/api"
  );
  const {AdminApp} = await import("@terreno/admin-backend");
  const {default: mongoose} = await import("mongoose");
  const {default: passportLocalMongoose} = await import("passport-local-mongoose");

  const userSchema = new mongoose.Schema({
    admin: {default: false, description: "Whether the user is an admin", type: Boolean},
    email: {description: "Sign-in email", type: String},
    name: {description: "Display name", type: String},
  });
  userSchema.plugin(passportLocalMongoose as unknown as (schema: Schema, options: object) => void, {
    usernameCaseInsensitive: true,
    usernameField: "email",
  });
  userSchema.plugin(createdUpdatedPlugin);
  const User = mongoose.model("User", userSchema);

  const widgetSchema = new mongoose.Schema({
    name: {description: "Widget name", required: true, type: String},
  });
  widgetSchema.plugin(createdUpdatedPlugin);
  const Widget = mongoose.model("Widget", widgetSchema);

  const widgetRouter = modelRouter("/widgets", Widget, {
    admin: {displayName: WIDGET_DISPLAY_NAME, listFields: ["name", "created"]},
    permissions: {
      create: [Permissions.IsAdmin],
      delete: [Permissions.IsAdmin],
      list: [Permissions.IsAdmin],
      read: [Permissions.IsAdmin],
      update: [Permissions.IsAdmin],
    },
  });

  const healthPlugin = {
    register: (app: express.Application): void => {
      app.get("/health", (_req, res) => {
        res.json({healthy: mongoose.connection.readyState === 1});
      });
    },
  };

  await mongoose.connect(process.env.MONGO_URI as string);
  await (
    User as unknown as {register: (user: object, password: string) => Promise<unknown>}
  ).register(
    {admin: true, email: process.env.SMOKE_ADMIN_EMAIL, name: "Smoke admin"},
    process.env.SMOKE_ADMIN_PASSWORD as string
  );
  await Widget.create({name: process.env.SMOKE_WIDGET_NAME});

  const app = new TerrenoApp({
    loggingOptions: {logRequests: false},
    userModel: User as unknown as ConstructorParameters<typeof TerrenoApp>[0]["userModel"],
  })
    .register(widgetRouter)
    .register(new AdminApp({}))
    .register(healthPlugin);
  app.start();
  await app.whenReady();
  logger.info(`[adminBackendSmoke] serving on port ${process.env.PORT}`);
};

const expectStatus = async (res: Response, status: number, step: string): Promise<unknown> => {
  const body = await res.text();
  if (res.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${res.status}: ${body}`);
  }
  return body ? JSON.parse(body) : undefined;
};

const bearer = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const signIn = async (
  baseUrl: string,
  route: "login" | "signup",
  email: string
): Promise<string> => {
  const res = (await expectStatus(
    await fetch(`${baseUrl}/auth/${route}`, {
      body: JSON.stringify({email, password: PASSWORD}),
      headers: {"Content-Type": "application/json"},
      method: "POST",
    }),
    200,
    `POST /auth/${route}`
  )) as {data: {token: string}};
  return res.data.token;
};

/** Parent: boots the child and walks the admin read path and the non-admin denial over HTTP. */
const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  const runId = startedAt.toMillis();
  const adminEmail = `admin-backend-smoke-admin-${runId}@example.com`;
  const widgetName = `Smoke widget ${runId}`;
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: SpawnedProcess | undefined;

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {
        MONGO_URI: await smokeMongoUri({databaseName: "adminBackendSmoke"}),
        PORT: String(port),
        REFRESH_TOKEN_SECRET: "admin-backend-smoke-refresh-secret",
        SESSION_SECRET: "admin-backend-smoke-session-secret",
        SMOKE_ADMIN_EMAIL: adminEmail,
        SMOKE_ADMIN_PASSWORD: PASSWORD,
        SMOKE_WIDGET_NAME: widgetName,
        TOKEN_ISSUER: "admin-backend-smoke",
        TOKEN_SECRET: "admin-backend-smoke-token-secret",
      },
      timeoutMs: 30000,
      url: `${baseUrl}/health`,
    });

    const adminToken = await signIn(baseUrl, "login", adminEmail);
    console.info("✅ POST /auth/login signs in the seeded admin");

    const config = (await expectStatus(
      await fetch(`${baseUrl}/admin/config`, {headers: bearer(adminToken)}),
      200,
      "GET /admin/config as admin"
    )) as {models: AdminConfigModel[]};
    const widgetModel = config.models.find((model) => model.displayName === WIDGET_DISPLAY_NAME);
    if (!widgetModel) {
      throw new Error(
        `GET /admin/config: the "${WIDGET_DISPLAY_NAME}" model is missing: ${JSON.stringify(config.models)}`
      );
    }
    if (widgetModel.routePath !== ADMIN_WIDGETS_PATH) {
      throw new Error(
        `GET /admin/config: expected routePath ${ADMIN_WIDGETS_PATH}, got ${widgetModel.routePath}`
      );
    }
    console.info(`✅ GET /admin/config lists the ${widgetModel.name} model`);

    const list = (await expectStatus(
      await fetch(`${baseUrl}${ADMIN_WIDGETS_PATH}`, {headers: bearer(adminToken)}),
      200,
      `GET ${ADMIN_WIDGETS_PATH} as admin`
    )) as {data: SmokeWidget[]};
    if (!list.data.some((widget) => widget.name === widgetName)) {
      throw new Error(
        `GET ${ADMIN_WIDGETS_PATH}: the seeded widget is missing: ${JSON.stringify(list.data)}`
      );
    }
    console.info(`✅ GET ${ADMIN_WIDGETS_PATH} lists the seeded widget`);

    const userToken = await signIn(
      baseUrl,
      "signup",
      `admin-backend-smoke-user-${runId}@example.com`
    );
    console.info("✅ POST /auth/signup signs in a non-admin user");

    await expectStatus(
      await fetch(`${baseUrl}/admin/config`, {headers: bearer(userToken)}),
      403,
      "GET /admin/config as non-admin"
    );
    console.info("✅ GET /admin/config returns 403 for the non-admin");

    // modelRouter answers a permission denial on a CRUD route with 405, not 403.
    await expectStatus(
      await fetch(`${baseUrl}${ADMIN_WIDGETS_PATH}`, {headers: bearer(userToken)}),
      405,
      `GET ${ADMIN_WIDGETS_PATH} as non-admin`
    );
    console.info(`✅ GET ${ADMIN_WIDGETS_PATH} returns 405 for the non-admin`);
  } catch (error: unknown) {
    if (server) {
      console.error(`--- server output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
    await stopSmokeMongo();
  }

  console.info(`admin-backend smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
};

const main = process.argv[2] === SERVE_ARG ? serve : run;
main().then(
  () => {
    if (main === run) {
      process.exit(0);
    }
  },
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
