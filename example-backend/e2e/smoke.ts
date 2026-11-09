/**
 * Real-process smoke for example-backend. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * Boots `src/index.ts` as a child process with `spawnExampleBackend()` on a free port against the
 * smoke's own database, and checks over real HTTP that `/health` reports healthy and that
 * `test@example.com` cannot sign in yet. It then runs the seed script's `users` step in this
 * process, the way `bun run seed --only users` does, and checks that the seeded user signs in
 * through Better Auth and that `/auth/me` returns that user for the session token.
 * Exits non-zero on the first failed check.
 */
import {
  type ExampleBackend,
  freePort,
  smokeMongoUri,
  spawnExampleBackend,
  stopSmokeMongo,
} from "@terreno/test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

// The first user from `TEST_USERS` in src/scripts/seed-test-data.ts.
const SEEDED_EMAIL = "test@example.com";
const SEEDED_PASSWORD = "testpassword123";
// Matches the secret `spawnExampleBackend()` gives the server, so the seed's accounts verify there.
const BETTER_AUTH_SECRET = "terreno-smoke-better-auth-secret-32";
// Against a persistent replica set (`TERRENO_TEST_MONGODB_URI`) the database outlives the run, like
// rtk's and syncdb's, so later boots skip first-boot work (index builds, migrations, consent sync).
// The in-memory fallback starts empty every run, so it always pays that work.
const DATABASE_NAME = "exampleBackendSmoke";
// Better Auth's own collections, plus the app's `User` collection the seed links them to.
const AUTH_COLLECTIONS = ["user", "account", "session"];
// example-backend runs startup work (migrations, consent sync) before /health turns 200.
const BACKEND_READY_TIMEOUT_MS = 120000;

interface Seed {
  runSeeds: typeof import("@terreno/api").runSeeds;
  seedSteps: typeof import("../src/scripts/seed-test-data").seedSteps;
}

interface SignInResponse {
  token?: string;
  user?: {email?: string; id?: string};
}

interface MeResponse {
  data?: {email?: string};
}

const expectStatus = async (res: Response, status: number, step: string): Promise<unknown> => {
  const body = await res.text();
  if (res.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${res.status}: ${body}`);
  }
  return body ? JSON.parse(body) : undefined;
};

const signIn = (baseUrl: string): Promise<Response> =>
  fetch(`${baseUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify({email: SEEDED_EMAIL, password: SEEDED_PASSWORD}),
    headers: {"Content-Type": "application/json"},
    method: "POST",
  });

/**
 * Loads the seed script and connects it to the smoke database. The seed reads `MONGO_URI` and
 * the Better Auth settings from the environment, as it does under `bun run seed`.
 */
const prepareSeed = async ({
  baseUrl,
  mongoUri,
}: {
  baseUrl: string;
  mongoUri: string;
}): Promise<Seed> => {
  process.env.BETTER_AUTH_SECRET = BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_URL = baseUrl;
  process.env.MONGO_URI = mongoUri;
  const {seedSteps} = await import("../src/scripts/seed-test-data");
  const {runSeeds} = await import("@terreno/api");
  const {connectToMongoDB} = await import("../src/utils/database");
  await connectToMongoDB();
  return {runSeeds, seedSteps};
};

/** Removes every account an earlier run seeded, so only this run's seed can create the user. */
const clearSeededUsers = async (): Promise<void> => {
  const {User} = await import("../src/models/user");
  await User.deleteMany({});
  for (const collection of AUTH_COLLECTIONS) {
    await mongoose.connection.db?.collection(collection).deleteMany({});
  }
};

const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  let backend: ExampleBackend | undefined;

  try {
    const mongoUri = await smokeMongoUri({databaseName: DATABASE_NAME});
    const port = await freePort();
    // The seed's imports load while the server boots; both reach the database before the checks.
    const [seed] = await Promise.all([
      prepareSeed({baseUrl: `http://127.0.0.1:${port}`, mongoUri}).then(async (loaded) => {
        await clearSeededUsers();
        return loaded;
      }),
      // Boot-time seeding stays off so only the seed step can create the user.
      spawnExampleBackend({
        env: {SEED_DEFAULTS: "false"},
        mongoUri,
        port,
        timeoutMs: BACKEND_READY_TIMEOUT_MS,
      }).then((spawned) => {
        backend = spawned;
      }),
    ]);
    if (!backend) {
      throw new Error("spawnExampleBackend resolved without a backend");
    }
    const {baseUrl} = backend;

    const health = (await expectStatus(await fetch(`${baseUrl}/health`), 200, "GET /health")) as {
      healthy?: boolean;
    };
    if (health.healthy !== true) {
      throw new Error(`GET /health: expected healthy: true, got ${JSON.stringify(health)}`);
    }
    console.info("✅ src/index.ts boots and GET /health reports healthy: true");

    await expectStatus(await signIn(baseUrl), 401, "POST /api/auth/sign-in/email before seeding");
    console.info(`✅ ${SEEDED_EMAIL} cannot sign in before the seed runs`);

    // runSeeds throws on a failed step; the sign-in below proves the user was written.
    await seed.runSeeds({name: "example-backend smoke", only: ["users"], steps: seed.seedSteps});
    console.info(`✅ the seed's users step creates ${SEEDED_EMAIL}`);

    const session = (await expectStatus(
      await signIn(baseUrl),
      200,
      "POST /api/auth/sign-in/email"
    )) as SignInResponse;
    if (!session.token || session.user?.email !== SEEDED_EMAIL) {
      throw new Error(
        `POST /api/auth/sign-in/email: expected a token for ${SEEDED_EMAIL}, got ${JSON.stringify(session)}`
      );
    }
    console.info(`✅ the seeded ${SEEDED_EMAIL} signs in through Better Auth`);

    const me = (await expectStatus(
      await fetch(`${baseUrl}/auth/me`, {headers: {Authorization: `Bearer ${session.token}`}}),
      200,
      "GET /auth/me"
    )) as MeResponse;
    if (me.data?.email !== SEEDED_EMAIL) {
      throw new Error(`GET /auth/me: expected ${SEEDED_EMAIL}, got ${JSON.stringify(me)}`);
    }
    console.info(`✅ GET /auth/me returns ${SEEDED_EMAIL} for the session token`);
  } catch (error: unknown) {
    if (backend) {
      console.error(`--- example-backend output ---\n${backend.output()}`);
    }
    throw error;
  } finally {
    await backend?.stop();
    // Same teardown as `bun run seed`: stop the Configuration change stream, then disconnect.
    const {Configuration} = await import("../src/models/configuration");
    await Configuration.shutdown();
    await mongoose.disconnect();
    await stopSmokeMongo();
  }

  console.info(`example-backend smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
};

run().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
