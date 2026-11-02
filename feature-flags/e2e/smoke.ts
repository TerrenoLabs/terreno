/**
 * Real-process smoke for @terreno/feature-flags. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * The smoke re-runs this file with `serve` as a child process: a TerrenoApp built from the
 * compiled `@terreno/api` and `@terreno/feature-flags` packages, with a seeded admin user, on a
 * free port, against `smokeMongoUri()`. The parent then checks over real HTTP that a signed-up
 * user cannot create a flag, the admin can, and the user's flag configuration resolves it to `on`. Exits non-zero on the first failed check.
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

/** The passport-local-mongoose static the child uses to seed the admin with a password. */
interface PassportLocalStatics {
  register: (user: unknown, password: string) => Promise<unknown>;
}

interface FlagDefinition {
  defaultVariant: string;
  disabled: boolean;
  variants: Record<string, boolean | string>;
}

/**
 * Child: the compiled API with auth, the compiled FeatureFlagsApp with its default admin-only
 * permissions, a health route, and one admin user seeded from `SMOKE_ADMIN_EMAIL` and
 * `SMOKE_ADMIN_PASSWORD`. The packages are imported here, not at the top, so the parent process
 * never loads them.
 */
const serve = async (): Promise<void> => {
  const {createdUpdatedPlugin, logger, TerrenoApp} = await import("@terreno/api");
  const {FeatureFlagsApp} = await import("@terreno/feature-flags");
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
  const registerUser = (User as unknown as PassportLocalStatics).register.bind(User);

  const healthPlugin = {
    register: (app: express.Application): void => {
      app.get("/health", (_req, res) => {
        res.json({healthy: mongoose.connection.readyState === 1});
      });
    },
  };

  await mongoose.connect(process.env.MONGO_URI as string);
  await registerUser(
    new User({admin: true, email: process.env.SMOKE_ADMIN_EMAIL, name: "Smoke admin"}),
    process.env.SMOKE_ADMIN_PASSWORD as string
  );

  const app = new TerrenoApp({
    loggingOptions: {logRequests: false},
    userModel: User as unknown as ConstructorParameters<typeof TerrenoApp>[0]["userModel"],
  })
    .register(new FeatureFlagsApp())
    .register(healthPlugin);
  app.start();
  await app.whenReady();
  logger.info(`[featureFlagsSmoke] serving on port ${process.env.PORT}`);
};

const expectStatus = async (res: Response, status: number, step: string): Promise<unknown> => {
  const body = await res.text();
  if (res.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${res.status}: ${body}`);
  }
  return body ? JSON.parse(body) : undefined;
};

const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const signIn = async ({
  baseUrl,
  email,
  password,
  route,
}: {
  baseUrl: string;
  email: string;
  password: string;
  route: "login" | "signup";
}): Promise<string> => {
  const step = `POST /auth/${route}`;
  const res = (await expectStatus(
    await fetch(`${baseUrl}/auth/${route}`, {
      body: JSON.stringify({email, password}),
      headers: {"Content-Type": "application/json"},
      method: "POST",
    }),
    200,
    step
  )) as {data: {token?: string}};
  if (!res.data.token) {
    throw new Error(`${step}: no token in the response`);
  }
  return res.data.token;
};

const fetchFlagConfiguration = async ({
  baseUrl,
  token,
}: {
  baseUrl: string;
  token: string;
}): Promise<Record<string, FlagDefinition>> => {
  const res = (await expectStatus(
    await fetch(`${baseUrl}/feature-flags/flagConfiguration`, {headers: authHeaders(token)}),
    200,
    "GET /feature-flags/flagConfiguration"
  )) as {data: Record<string, FlagDefinition>};
  return res.data;
};

/** Parent: boots the child and walks the happy path over HTTP. */
const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  const runId = startedAt.toMillis();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminEmail = `feature-flags-smoke-admin-${runId}@example.com`;
  const adminPassword = "feature-flags-smoke-admin-password-1";
  const flagKey = `feature-flags-smoke-${runId}`;
  let server: SpawnedProcess | undefined;

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {
        MONGO_URI: await smokeMongoUri({databaseName: "featureFlagsSmoke"}),
        PORT: String(port),
        REFRESH_TOKEN_SECRET: "feature-flags-smoke-refresh-secret",
        SESSION_SECRET: "feature-flags-smoke-session-secret",
        SMOKE_ADMIN_EMAIL: adminEmail,
        SMOKE_ADMIN_PASSWORD: adminPassword,
        TOKEN_ISSUER: "feature-flags-smoke",
        TOKEN_SECRET: "feature-flags-smoke-token-secret",
      },
      timeoutMs: 20000,
      url: `${baseUrl}/health`,
    });

    const userToken = await signIn({
      baseUrl,
      email: `feature-flags-smoke-user-${runId}@example.com`,
      password: "feature-flags-smoke-user-password-1",
      route: "signup",
    });
    const flagBody = JSON.stringify({
      enabled: true,
      key: flagKey,
      name: "Feature flags smoke",
      rolloutPercentage: 100,
      type: "boolean",
    });
    await expectStatus(
      await fetch(`${baseUrl}/feature-flags/flags`, {
        body: flagBody,
        headers: authHeaders(userToken),
        method: "POST",
      }),
      405,
      "POST /feature-flags/flags as a non-admin"
    );
    console.info("✅ POST /feature-flags/flags refuses a signed-up non-admin user");

    const adminToken = await signIn({
      baseUrl,
      email: adminEmail,
      password: adminPassword,
      route: "login",
    });
    const created = (await expectStatus(
      await fetch(`${baseUrl}/feature-flags/flags`, {
        body: flagBody,
        headers: authHeaders(adminToken),
        method: "POST",
      }),
      201,
      "POST /feature-flags/flags"
    )) as {data: {key: string}};
    if (created.data.key !== flagKey) {
      throw new Error(
        `POST /feature-flags/flags: created key ${created.data.key} is not ${flagKey}`
      );
    }
    console.info("✅ POST /feature-flags/flags creates an enabled boolean flag as the admin");

    const after = await fetchFlagConfiguration({baseUrl, token: userToken});
    const flag = after[flagKey];
    if (!flag) {
      throw new Error(`GET /feature-flags/flagConfiguration: ${flagKey} is missing`);
    }
    if (flag.disabled || flag.defaultVariant !== "on" || flag.variants.on !== true) {
      throw new Error(
        `GET /feature-flags/flagConfiguration: ${flagKey} is not on: ${JSON.stringify(flag)}`
      );
    }
    console.info("✅ GET /feature-flags/flagConfiguration resolves the flag to on for the user");
  } catch (error: unknown) {
    if (server) {
      console.error(`--- server output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
    await stopSmokeMongo();
  }

  console.info(`feature-flags smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
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
