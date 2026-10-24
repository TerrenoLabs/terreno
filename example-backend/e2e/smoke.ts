/**
 * Real-process smoke for example-backend. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * Boots `src/index.ts` as a child process with `spawnExampleBackend()` on a free port against a
 * fresh database from `smokeMongoUri()`, and checks over real HTTP that `/health` reports
 * healthy and that `test@example.com` cannot sign in yet. It then runs the real seed script
 * (`src/scripts/seed-test-data.ts --only users`) as a child process and checks that the seeded
 * user signs in through Better Auth and that `/auth/me` returns that user for the session token.
 * Exits non-zero on the first failed check.
 */
import {resolve} from "node:path";
import {
  type ExampleBackend,
  runBin,
  smokeMongoUri,
  spawnExampleBackend,
  stopSmokeMongo,
} from "@terreno/test";
import {DateTime} from "luxon";

const BACKEND_DIR = resolve(import.meta.dir, "..");
// The first user from `TEST_USERS` in src/scripts/seed-test-data.ts.
const SEEDED_EMAIL = "test@example.com";
const SEEDED_PASSWORD = "testpassword123";
// example-backend runs startup work (migrations, consent sync) before /health turns 200.
const BACKEND_READY_TIMEOUT_MS = 120000;
// The seed script loads most of the backend's modules, so it starts as slowly as the server.
const SEED_TIMEOUT_MS = 120000;

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

const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  let backend: ExampleBackend | undefined;

  try {
    // A database per run, so users from an earlier run against a persistent Mongo cannot sign in.
    const mongoUri = await smokeMongoUri({
      databaseName: `exampleBackendSmoke${startedAt.toMillis()}`,
    });
    // Boot-time seeding stays off so only the seed script can create the user.
    backend = await spawnExampleBackend({
      backendDir: BACKEND_DIR,
      env: {SEED_DEFAULTS: "false"},
      mongoUri,
      timeoutMs: BACKEND_READY_TIMEOUT_MS,
    });
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

    // The seed shares the server's database and Better Auth settings, as `bun run seed` does.
    const seed = await runBin({
      args: ["--only", "users"],
      bin: "src/scripts/seed-test-data.ts",
      cwd: BACKEND_DIR,
      env: {
        BETTER_AUTH_SECRET: "terreno-smoke-better-auth-secret-32",
        BETTER_AUTH_URL: baseUrl,
        MONGO_URI: mongoUri,
      },
      timeoutMs: SEED_TIMEOUT_MS,
    });
    if (seed.exitCode !== 0) {
      throw new Error(`seed --only users: exited ${seed.exitCode}\n${seed.stdout}\n${seed.stderr}`);
    }
    console.info(`✅ the seed script creates ${SEEDED_EMAIL}`);

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
