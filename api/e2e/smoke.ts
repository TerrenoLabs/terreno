/**
 * Real-process smoke for @terreno/api. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * The smoke re-runs this file with `serve` as a child process: a minimal TerrenoApp built from
 * the compiled package with one modelRouter model, on a free port, against `smokeMongoUri()`.
 * The parent then checks over real HTTP that `/health` answers, a user can sign up, and that
 * user can create and list a document. Exits non-zero on the first failed check.
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

interface SmokeWidget {
  _id: string;
  name: string;
  ownerId: string;
}

/**
 * Child: the compiled API with auth, one owner-scoped model, and a health plugin. The API is
 * imported here, not at the top, so the parent process never loads it.
 */
const serve = async (): Promise<void> => {
  const {createdUpdatedPlugin, logger, modelRouter, OwnerQueryFilter, Permissions, TerrenoApp} =
    await import("@terreno/api");
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
    ownerId: {description: "User who owns the widget", ref: "User", type: String},
  });
  widgetSchema.plugin(createdUpdatedPlugin);
  const Widget = mongoose.model("Widget", widgetSchema);

  const widgetRouter = modelRouter("/widgets", Widget, {
    permissions: {
      create: [Permissions.IsAuthenticated],
      delete: [],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsOwner],
      update: [],
    },
    preCreate: (body, req) => {
      const user = req.user as unknown as {_id: string};
      return {...(body as {name: string}), ownerId: String(user._id)};
    },
    queryFilter: OwnerQueryFilter,
  });

  const healthPlugin = {
    register: (app: express.Application): void => {
      app.get("/health", (_req, res) => {
        res.json({healthy: mongoose.connection.readyState === 1});
      });
    },
  };

  await mongoose.connect(process.env.MONGO_URI as string);
  const app = new TerrenoApp({
    loggingOptions: {logRequests: false},
    userModel: User as unknown as ConstructorParameters<typeof TerrenoApp>[0]["userModel"],
  })
    .register(widgetRouter)
    .register(healthPlugin);
  app.start();
  await app.whenReady();
  logger.info(`[apiSmoke] serving on port ${process.env.PORT}`);
};

const expectStatus = async (res: Response, status: number, step: string): Promise<unknown> => {
  const body = await res.text();
  if (res.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${res.status}: ${body}`);
  }
  return body ? JSON.parse(body) : undefined;
};

/** Parent: boots the child and walks the happy path over HTTP. */
const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: SpawnedProcess | undefined;

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {
        MONGO_URI: await smokeMongoUri({databaseName: "apiSmoke"}),
        PORT: String(port),
        REFRESH_TOKEN_SECRET: "api-smoke-refresh-secret",
        SESSION_SECRET: "api-smoke-session-secret",
        TOKEN_ISSUER: "api-smoke",
        TOKEN_SECRET: "api-smoke-token-secret",
      },
      timeoutMs: 20000,
      url: `${baseUrl}/health`,
    });

    const health = (await expectStatus(await fetch(`${baseUrl}/health`), 200, "GET /health")) as {
      healthy: boolean;
    };
    if (!health.healthy) {
      throw new Error("GET /health: server reports unhealthy");
    }
    console.info("✅ GET /health is healthy");

    const email = `api-smoke-${startedAt.toMillis()}@example.com`;
    const signup = (await expectStatus(
      await fetch(`${baseUrl}/auth/signup`, {
        body: JSON.stringify({email, password: "api-smoke-password-1"}),
        headers: {"Content-Type": "application/json"},
        method: "POST",
      }),
      200,
      "POST /auth/signup"
    )) as {data: {token: string; userId: string}};
    const headers = {
      Authorization: `Bearer ${signup.data.token}`,
      "Content-Type": "application/json",
    };
    console.info("✅ POST /auth/signup returns a token");

    const created = (await expectStatus(
      await fetch(`${baseUrl}/widgets`, {
        body: JSON.stringify({name: "Smoke widget"}),
        headers,
        method: "POST",
      }),
      201,
      "POST /widgets"
    )) as {data: SmokeWidget};
    if (created.data.ownerId !== String(signup.data.userId)) {
      throw new Error(`POST /widgets: ownerId ${created.data.ownerId} is not the new user`);
    }
    console.info("✅ POST /widgets creates an owned widget");

    const listed = (await expectStatus(
      await fetch(`${baseUrl}/widgets`, {headers}),
      200,
      "GET /widgets"
    )) as {data: SmokeWidget[]};
    if (!listed.data.some((widget) => widget._id === created.data._id)) {
      throw new Error("GET /widgets: the created widget is missing from the list");
    }
    console.info("✅ GET /widgets lists it");
  } catch (error: unknown) {
    if (server) {
      console.error(`--- server output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
    await stopSmokeMongo();
  }

  console.info(`api smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
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
