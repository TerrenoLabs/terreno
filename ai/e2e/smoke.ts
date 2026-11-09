/**
 * Real-process smoke for @terreno/ai. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * The smoke re-runs this file with `serve` as a child process: a minimal TerrenoApp from the
 * compiled `@terreno/api` with the compiled `AiApp` registered, on a free port, against
 * `smokeMongoUri()`. The child's `AIService` wraps a deterministic fake provider
 * (`MockLanguageModelV3` from `ai/test`) and runs with every provider key unset. The parent then
 * checks over real HTTP that a signed-in user's chat request streams back the fake provider's
 * text. Exits non-zero on the first failed check.
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
const FAKE_REPLY = "Hello from the ai smoke's fake provider.";
const FAKE_TITLE = "Smoke chat";

/** Provider credentials the smoke unsets in the child, so no real provider can answer. */
const PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_VERTEX_PROJECT",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "OPENAI_API_KEY",
];

interface ChatEvent {
  done?: boolean;
  error?: string;
  historyId?: string;
  text?: string;
  title?: string;
}

const ZERO_USAGE = {
  inputTokens: {cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0},
  outputTokens: {reasoning: 0, text: 0, total: 0},
};

/**
 * Child: the compiled API with auth, the compiled AiApp on a fake model, and a health plugin.
 * The packages are imported here, not at the top, so the parent process never loads them.
 */
const serve = async (): Promise<void> => {
  const {createdUpdatedPlugin, logger, TerrenoApp} = await import("@terreno/api");
  const {AIService, AiApp} = await import("@terreno/ai");
  const {MockLanguageModelV3} = await import("ai/test");
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

  // Streams the chat reply and answers the title request, the two calls one chat turn makes.
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{text: FAKE_TITLE, type: "text"}],
      finishReason: {raw: "stop", unified: "stop"},
      usage: ZERO_USAGE,
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller): void {
          controller.enqueue({type: "stream-start", warnings: []});
          controller.enqueue({id: "text-1", type: "text-start"});
          controller.enqueue({delta: FAKE_REPLY, id: "text-1", type: "text-delta"});
          controller.enqueue({id: "text-1", type: "text-end"});
          controller.enqueue({
            finishReason: {raw: "stop", unified: "stop"},
            type: "finish",
            usage: ZERO_USAGE,
          });
          controller.close();
        },
      }),
    }),
    modelId: "ai-smoke-fake-model",
    provider: "ai-smoke-fake-provider",
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
    .register(new AiApp({aiService: new AIService({model})}))
    .register(healthPlugin);
  app.start();
  await app.whenReady();
  logger.info(`[aiSmoke] serving on port ${process.env.PORT}`);
};

const expectStatus = async (res: Response, status: number, step: string): Promise<string> => {
  const body = await res.text();
  if (res.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${res.status}: ${body}`);
  }
  return body;
};

/** Splits a finished `text/event-stream` body into its JSON `data:` events. */
const parseEvents = (body: string): ChatEvent[] =>
  body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as ChatEvent);

/** Parent: boots the child and sends one chat request over HTTP. */
const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: SpawnedProcess | undefined;

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {
        ...Object.fromEntries(PROVIDER_ENV_KEYS.map((key) => [key, undefined])),
        MONGO_URI: await smokeMongoUri({databaseName: "aiSmoke"}),
        PORT: String(port),
        REFRESH_TOKEN_SECRET: "ai-smoke-refresh-secret",
        SESSION_SECRET: "ai-smoke-session-secret",
        TOKEN_ISSUER: "ai-smoke",
        TOKEN_SECRET: "ai-smoke-token-secret",
      },
      timeoutMs: 30000,
      url: `${baseUrl}/health`,
    });

    const signup = JSON.parse(
      await expectStatus(
        await fetch(`${baseUrl}/auth/signup`, {
          body: JSON.stringify({
            email: `ai-smoke-${startedAt.toMillis()}@example.com`,
            password: "ai-smoke-password-1",
          }),
          headers: {"Content-Type": "application/json"},
          method: "POST",
        }),
        200,
        "POST /auth/signup"
      )
    ) as {data: {token: string}};
    console.info("✅ POST /auth/signup signs in a user");

    const chat = await fetch(`${baseUrl}/gpt/prompt`, {
      body: JSON.stringify({prompt: "Say hello."}),
      headers: {
        Authorization: `Bearer ${signup.data.token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const events = parseEvents(await expectStatus(chat, 200, "POST /gpt/prompt"));
    const failed = events.find((event) => event.error);
    if (failed) {
      throw new Error(`POST /gpt/prompt: the stream reported an error: ${failed.error}`);
    }
    const reply = events.map((event) => event.text ?? "").join("");
    if (reply !== FAKE_REPLY) {
      throw new Error(
        `POST /gpt/prompt: expected the fake provider's text, got ${JSON.stringify(events)}`
      );
    }
    const done = events.find((event) => event.done);
    if (!done?.historyId || done.title !== FAKE_TITLE) {
      throw new Error(
        `POST /gpt/prompt: expected a done event with a history and the fake title, got ${JSON.stringify(done)}`
      );
    }
    console.info("✅ POST /gpt/prompt streams the fake provider's reply");
  } catch (error: unknown) {
    if (server) {
      console.error(`--- server output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
    await stopSmokeMongo();
  }

  console.info(`ai smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
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
