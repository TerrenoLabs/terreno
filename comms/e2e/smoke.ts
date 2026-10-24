/**
 * Real-process smoke for @terreno/comms. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * The smoke re-runs this file with `serve` as a child process: a TerrenoApp built from the compiled
 * packages with `CommsApp` and `WebhooksApp`, on a free port, against `smokeMongoUri()`. Mail goes
 * through `SendGridMailProvider` with an in-memory client, so nothing leaves the machine. The
 * parent then checks over real HTTP that an admin can send a message, that the comms dashboard
 * records it as sent, and that a signed SendGrid `delivered` event marks it delivered. Exits
 * non-zero on the first failed check.
 */
import crypto from "node:crypto";
import {
  freePort,
  type SpawnedProcess,
  smokeMongoUri,
  spawnUntilReady,
  stopSmokeMongo,
} from "@terreno/test";
import type express from "express";
import {DateTime} from "luxon";

const SERVE_ARG = "serve";
const ADMIN_PASSWORD = "comms-smoke-password-1";
const FROM_EMAIL = "comms-smoke@example.com";
const SUBJECT = "Comms smoke";

/**
 * Unique per run, so the smoke can rerun against a persistent `TERRENO_TEST_MONGODB_URI` without
 * colliding with an earlier run's admin user or SendGrid message id.
 */
const runId = (): string => process.env.COMMS_SMOKE_RUN_ID as string;
const adminEmail = (): string => `comms-smoke-admin-${runId()}@example.com`;
const providerMessageIdFor = (count: number): string => `comms-smoke-${runId()}-${count}`;

interface SmokeSendResult {
  accepted: boolean;
  loggedMessageId?: string;
  providerMessageId?: string;
}

interface SmokeCommsMessage {
  channel: string;
  provider: string;
  status: string;
}

/**
 * Child: the compiled API with an admin user, CommsApp on an in-memory SendGrid client, and one
 * smoke action that sends mail the way app code does. The packages are imported here, not at the
 * top, so the parent process never loads them.
 */
const serve = async (): Promise<void> => {
  const {logger, modelRouter, Permissions, TerrenoApp, WebhooksApp, z} = await import(
    "@terreno/api"
  );
  const {UserModel} = await import("@terreno/api/testing");
  const {CommsApp, CommsMessage, getCommsService} = await import("@terreno/comms");
  const {SendGridMailProvider} = await import("@terreno/comms/adapters/sendgrid");
  const {default: mongoose} = await import("mongoose");

  let sentCount = 0;
  const mail = new SendGridMailProvider({
    apiKey: "comms-smoke-key",
    // Stands in for `@sendgrid/mail`; SendGrid's 202 carries the message id in `x-message-id`.
    client: {
      send: async (): Promise<
        [{headers: Record<string, string>; statusCode: number}, Record<string, unknown>]
      > => {
        sentCount += 1;
        return [{headers: {"x-message-id": providerMessageIdFor(sentCount)}, statusCode: 202}, {}];
      },
    },
    fromEmail: FROM_EMAIL,
    webhookVerificationKey: process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY,
  });
  const webhooks = new WebhooksApp({idempotency: {store: "memory"}});
  const comms = new CommsApp({mail, webhooks});

  const smokeRouter = modelRouter("/commsSmoke", CommsMessage, {
    collectionActions: {
      sendMail: {
        body: z.object({text: z.string()}).strict(),
        handler: async ({body, user}) => {
          const sender = user as unknown as {_id: unknown; email: string};
          return getCommsService().sendMail(
            {subject: SUBJECT, text: (body as {text: string}).text, to: sender.email},
            {userId: String(sender._id)}
          );
        },
        method: "POST",
        permissions: [Permissions.IsAdmin],
      },
    },
    permissions: {create: [], delete: [], list: [], read: [], update: []},
  });

  const healthPlugin = {
    register: (app: express.Application): void => {
      app.get("/health", (_req, res) => {
        res.json({healthy: mongoose.connection.readyState === 1});
      });
    },
  };

  // The admin is seeded, not signed up: signup never grants `admin`, and the dashboard needs it.
  // `register` comes from the model's passport-local-mongoose plugin, which its type omits.
  const registrableUsers = UserModel as unknown as {
    register: (user: unknown, password: string) => Promise<unknown>;
  };
  await mongoose.connect(process.env.MONGO_URI as string);
  await registrableUsers.register(
    new UserModel({admin: true, email: adminEmail()}),
    ADMIN_PASSWORD
  );
  const app = new TerrenoApp({
    loggingOptions: {logRequests: false},
    userModel: UserModel as unknown as ConstructorParameters<typeof TerrenoApp>[0]["userModel"],
  })
    .register(comms)
    .register(webhooks)
    .register(smokeRouter)
    .register(healthPlugin);
  app.start();
  await app.whenReady();
  logger.info(`[commsSmoke] serving on port ${process.env.PORT}`);
};

const expectStatus = async (res: Response, status: number, step: string): Promise<unknown> => {
  const body = await res.text();
  if (res.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${res.status}: ${body}`);
  }
  return body ? JSON.parse(body) : undefined;
};

const expectMessageStatus = async ({
  baseUrl,
  headers,
  messageId,
  status,
}: {
  baseUrl: string;
  headers: Record<string, string>;
  messageId: string;
  status: string;
}): Promise<void> => {
  const step = `GET /comms/messages/${messageId}`;
  const read = (await expectStatus(
    await fetch(`${baseUrl}/comms/messages/${messageId}`, {headers}),
    200,
    step
  )) as {data: SmokeCommsMessage};
  const {channel, provider} = read.data;
  if (read.data.status !== status || channel !== "mail" || provider !== "sendgrid") {
    throw new Error(`${step}: expected a sendgrid mail row ${status}, got ${JSON.stringify(read)}`);
  }
};

/** Signs a SendGrid Event Webhook body the way SendGrid does: ECDSA P-256 over timestamp + body. */
const signSendGridEvents = ({
  payload,
  privateKey,
}: {
  payload: string;
  privateKey: crypto.KeyObject;
}): Record<string, string> => {
  const timestamp = String(DateTime.utc().toUnixInteger());
  const signer = crypto.createSign("SHA256");
  signer.update(timestamp);
  signer.update(payload);
  signer.end();
  return {
    "Content-Type": "application/json",
    "X-Twilio-Email-Event-Webhook-Signature": signer.sign(privateKey, "base64"),
    "X-Twilio-Email-Event-Webhook-Timestamp": timestamp,
  };
};

/** Parent: boots the child and walks send → sent → delivered over HTTP. */
const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  process.env.COMMS_SMOKE_RUN_ID = String(startedAt.toMillis());
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const keyPair = crypto.generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  let server: SpawnedProcess | undefined;

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {
        COMMS_SMOKE_RUN_ID: runId(),
        MONGO_URI: await smokeMongoUri({databaseName: "commsSmoke"}),
        PORT: String(port),
        REFRESH_TOKEN_SECRET: "comms-smoke-refresh-secret",
        SENDGRID_WEBHOOK_VERIFICATION_KEY: keyPair.publicKey
          .export({format: "pem", type: "spki"})
          .toString(),
        SESSION_SECRET: "comms-smoke-session-secret",
        TOKEN_ISSUER: "comms-smoke",
        TOKEN_SECRET: "comms-smoke-token-secret",
      },
      timeoutMs: 20000,
      url: `${baseUrl}/health`,
    });

    const login = (await expectStatus(
      await fetch(`${baseUrl}/auth/login`, {
        body: JSON.stringify({email: adminEmail(), password: ADMIN_PASSWORD}),
        headers: {"Content-Type": "application/json"},
        method: "POST",
      }),
      200,
      "POST /auth/login"
    )) as {data: {token: string}};
    const headers = {
      Authorization: `Bearer ${login.data.token}`,
      "Content-Type": "application/json",
    };
    console.info("✅ POST /auth/login signs the admin in");

    const sent = (await expectStatus(
      await fetch(`${baseUrl}/commsSmoke/sendMail`, {
        body: JSON.stringify({text: "Sent by the comms smoke"}),
        headers,
        method: "POST",
      }),
      200,
      "POST /commsSmoke/sendMail"
    )) as {data: SmokeSendResult};
    const {accepted, loggedMessageId, providerMessageId} = sent.data;
    if (!accepted || !loggedMessageId || providerMessageId !== providerMessageIdFor(1)) {
      throw new Error(
        `POST /commsSmoke/sendMail: expected an accepted, logged send through the in-memory client, got ${JSON.stringify(sent)}`
      );
    }
    console.info("✅ POST /commsSmoke/sendMail sends through the in-memory SendGrid client");

    await expectMessageStatus({baseUrl, headers, messageId: loggedMessageId, status: "sent"});
    console.info("✅ GET /comms/messages/:id records the message as sent");

    const payload = JSON.stringify([
      {
        email: adminEmail(),
        event: "delivered",
        sg_event_id: `comms-smoke-event-${runId()}`,
        sg_message_id: `${providerMessageId}.filter0001.1.1`,
      },
    ]);
    await expectStatus(
      await fetch(`${baseUrl}/comms/webhooks/sendgrid`, {
        body: payload,
        headers: signSendGridEvents({payload, privateKey: keyPair.privateKey}),
        method: "POST",
      }),
      200,
      "POST /comms/webhooks/sendgrid"
    );
    console.info("✅ POST /comms/webhooks/sendgrid accepts a signed delivered event");

    await expectMessageStatus({baseUrl, headers, messageId: loggedMessageId, status: "delivered"});
    console.info("✅ GET /comms/messages/:id records the message as delivered");
  } catch (error: unknown) {
    if (server) {
      console.error(`--- server output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
    await stopSmokeMongo();
  }

  console.info(`comms smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
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
