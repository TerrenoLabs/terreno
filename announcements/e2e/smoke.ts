/**
 * Real-process smoke for @terreno/announcements. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * The smoke re-runs this file with `serve` as a child process: a minimal TerrenoApp from the
 * compiled `@terreno/api` with the compiled `AnnouncementsApp` registered, on a free port, against
 * `smokeMongoUri()`. The parent then checks over real HTTP that a release pipeline holding the
 * upload token can import and publish an announcement, and that a newly signed-up user sees it
 * in their feed. Exits non-zero on the first failed check.
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
const UPLOAD_TOKEN = "announcements-smoke-upload-token";
const ANNOUNCEMENT_TITLE = "Smoke announcement";

interface ImportResult {
  announcements: Array<{id: string; status: string}>;
  published: number;
}

interface FeedItem {
  id: string;
  title: string;
}

/**
 * Child: the compiled API with auth, the compiled announcements plugin, and a health plugin.
 * Both packages are imported here, not at the top, so the parent process never loads them.
 */
const serve = async (): Promise<void> => {
  const {createdUpdatedPlugin, logger, TerrenoApp} = await import("@terreno/api");
  const {AnnouncementsApp} = await import("@terreno/announcements");
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
    .register(new AnnouncementsApp({uploadToken: process.env.ANNOUNCEMENTS_UPLOAD_TOKEN}))
    .register(healthPlugin);
  app.start();
  await app.whenReady();
  logger.info(`[announcementsSmoke] serving on port ${process.env.PORT}`);
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

/** Parent: boots the child and walks the publish-to-feed path over HTTP. */
const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: SpawnedProcess | undefined;

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {
        ANNOUNCEMENTS_UPLOAD_TOKEN: UPLOAD_TOKEN,
        MONGO_URI: await smokeMongoUri({databaseName: "announcementsSmoke"}),
        PORT: String(port),
        REFRESH_TOKEN_SECRET: "announcements-smoke-refresh-secret",
        SESSION_SECRET: "announcements-smoke-session-secret",
        TOKEN_ISSUER: "announcements-smoke",
        TOKEN_SECRET: "announcements-smoke-token-secret",
      },
      timeoutMs: 30000,
      url: `${baseUrl}/health`,
    });

    const imported = (await expectStatus(
      await fetch(`${baseUrl}/announcements/import-release`, {
        body: JSON.stringify({
          announcements: [
            {body: "Smoke test body.", slug: "smoke-announcement", title: ANNOUNCEMENT_TITLE},
          ],
          publish: true,
          release: {product: "announcements-smoke", version: String(startedAt.toMillis())},
        }),
        headers: bearer(UPLOAD_TOKEN),
        method: "POST",
      }),
      200,
      "POST /announcements/import-release"
    )) as {data: ImportResult};
    const announcement = imported.data.announcements[0];
    if (imported.data.published !== 1 || announcement?.status !== "published") {
      throw new Error(
        `POST /announcements/import-release: expected one published announcement, got ${JSON.stringify(imported.data)}`
      );
    }
    console.info("✅ POST /announcements/import-release publishes an announcement");

    const signup = (await expectStatus(
      await fetch(`${baseUrl}/auth/signup`, {
        body: JSON.stringify({
          email: `announcements-smoke-${startedAt.toMillis()}@example.com`,
          password: "announcements-smoke-password-1",
        }),
        headers: {"Content-Type": "application/json"},
        method: "POST",
      }),
      200,
      "POST /auth/signup"
    )) as {data: {token: string}};
    console.info("✅ POST /auth/signup signs in a user");

    const feed = (await expectStatus(
      await fetch(`${baseUrl}/announcements/feed?platform=web`, {
        headers: bearer(signup.data.token),
      }),
      200,
      "GET /announcements/feed"
    )) as {data: FeedItem[]};
    const item = feed.data.find((entry) => entry.id === announcement.id);
    if (item?.title !== ANNOUNCEMENT_TITLE) {
      throw new Error(
        `GET /announcements/feed: the published announcement is missing: ${JSON.stringify(feed.data)}`
      );
    }
    console.info("✅ GET /announcements/feed lists it for the user");
  } catch (error: unknown) {
    if (server) {
      console.error(`--- server output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
    await stopSmokeMongo();
  }

  console.info(`announcements smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
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
