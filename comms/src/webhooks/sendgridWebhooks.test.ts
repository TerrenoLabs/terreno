import {beforeEach, describe, it, spyOn} from "bun:test";
import crypto from "node:crypto";
import {logger, TerrenoApp, type UserModel as UserModelType, WebhooksApp} from "@terreno/api";
import {setupDb, UserModel} from "@terreno/api/testing";
import {assert} from "chai";
import type {Application} from "express";
import {DateTime} from "luxon";
import supertest from "supertest";

import {SendGridMailProvider} from "../adapters/sendgrid";
import {CommsApp} from "../commsApp";
import {CommsMessage} from "../models/commsMessage";
import type {DeliveryEvent, OptOutEvent} from "../types";

const PATH = "/comms/webhooks/sendgrid";
const MESSAGE_ID = "filterdrecv-abc123";
const SG_MESSAGE_ID = `${MESSAGE_ID}.filter0001.12345.1`;
const FROM_EMAIL = "notifications@example.com";

const createMailClient = (
  messageId: string
): {
  send: (
    message: Record<string, unknown>
  ) => Promise<[{headers: Record<string, string>; statusCode: number}, Record<string, unknown>]>;
} => {
  return {
    send: async (): Promise<
      [{headers: Record<string, string>; statusCode: number}, Record<string, unknown>]
    > => {
      return [{headers: {"x-message-id": messageId}, statusCode: 202}, {}];
    },
  };
};

const signPayload = ({
  payload,
  privateKey,
}: {
  payload: string;
  privateKey: crypto.KeyObject;
}): {signature: string; timestamp: string} => {
  const timestamp = String(DateTime.utc().toUnixInteger());
  const signer = crypto.createSign("SHA256");
  signer.update(timestamp);
  signer.update(payload);
  signer.end();
  return {signature: signer.sign(privateKey, "base64"), timestamp};
};

const buildSendGridCommsApp = ({
  deliveries,
  mailClient = createMailClient(MESSAGE_ID),
  onOptOut,
  verificationKey,
  webhooks = new WebhooksApp({idempotency: {store: "memory"}}),
}: {
  deliveries?: DeliveryEvent[];
  mailClient?: {
    send: (
      message: Record<string, unknown>
    ) => Promise<[{headers: Record<string, string>; statusCode: number}, Record<string, unknown>]>;
  };
  onOptOut?: (event: OptOutEvent) => Promise<void>;
  verificationKey?: string;
  webhooks?: WebhooksApp;
} = {}): {
  app: Application;
  comms: CommsApp;
  keyPair: {privateKey: crypto.KeyObject; publicKey: crypto.KeyObject};
} => {
  const keyPair = crypto.generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const publicKey = keyPair.publicKey.export({format: "pem", type: "spki"}).toString();
  const mail = new SendGridMailProvider({
    apiKey: "sg-test",
    client: mailClient,
    fromEmail: FROM_EMAIL,
    webhookVerificationKey: verificationKey === undefined ? publicKey : verificationKey,
  });
  const comms = new CommsApp({
    mail,
    onDeliveryEvent: deliveries
      ? async (event): Promise<void> => {
          deliveries.push(event);
        }
      : undefined,
    onOptOut,
    webhooks,
  });
  const app = new TerrenoApp({
    logRequests: false,
    skipListen: true,
    userModel: UserModel as unknown as UserModelType,
  })
    .register(comms)
    .register(webhooks)
    .build();
  return {app, comms, keyPair};
};

const postSignedEvents = async ({
  app,
  events,
  privateKey,
}: {
  app: Application;
  events: Record<string, unknown>[];
  privateKey: crypto.KeyObject;
}): Promise<supertest.Response> => {
  const payload = JSON.stringify(events);
  const {signature, timestamp} = signPayload({payload, privateKey});
  return supertest(app)
    .post(PATH)
    .set("Content-Type", "application/json")
    .set("X-Twilio-Email-Event-Webhook-Timestamp", timestamp)
    .set("X-Twilio-Email-Event-Webhook-Signature", signature)
    .send(payload);
};

describe("SendGrid CommsApp webhooks", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    await CommsMessage.deleteMany({});
    Reflect.deleteProperty(process.env, "SENDGRID_WEBHOOK_VERIFICATION_KEY");
  });

  it("updates CommsMessage to delivered from a signed event", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const res = await postSignedEvents({
      app,
      events: [
        {
          event: "delivered",
          sg_event_id: "sg_delivered_1",
          sg_message_id: SG_MESSAGE_ID,
        },
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(res.status, 200);
    const row = await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID});
    assert.equal(row.status, "delivered");
  });

  it("maps a signed bounce event to bounced + permanent", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const res = await postSignedEvents({
      app,
      events: [
        {
          event: "bounce",
          reason: "500 unknown recipient",
          sg_event_id: "sg_bounce_1",
          sg_message_id: SG_MESSAGE_ID,
          type: "bounce",
        },
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(res.status, 200);
    const row = await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID});
    assert.equal(row.status, "bounced");
    assert.equal(row.errorCode, "500 unknown recipient");
    assert.equal(row.errorClass, "permanent");
  });

  it("fires onOptOut for a signed spamreport event", async (): Promise<void> => {
    const optOuts: OptOutEvent[] = [];
    const {app, comms, keyPair} = buildSendGridCommsApp({
      onOptOut: async (event): Promise<void> => {
        optOuts.push(event);
      },
    });
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const res = await postSignedEvents({
      app,
      events: [
        {
          email: "person@example.com",
          event: "spamreport",
          sg_event_id: "sg_spam_1",
          sg_message_id: SG_MESSAGE_ID,
        },
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(res.status, 200);
    assert.equal(optOuts.length, 1);
    assert.equal(optOuts[0]?.reason, "spamreport");
    assert.equal(optOuts[0]?.to, "person@example.com");
    const row = await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID});
    assert.equal(row.status, "sent");
  });

  it("returns 401 webhook-signature-invalid for an unsigned payload", async (): Promise<void> => {
    const {app} = buildSendGridCommsApp();
    const res = await supertest(app)
      .post(PATH)
      .set("Content-Type", "application/json")
      .send(`[{"sg_event_id":"sg_1","event":"delivered"}]`);
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "webhook-signature-invalid");
  });

  it("does not apply a duplicate sg_event_id a second time", async (): Promise<void> => {
    const deliveries: DeliveryEvent[] = [];
    const {app, comms, keyPair} = buildSendGridCommsApp({deliveries});
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const events = [
      {
        event: "delivered",
        sg_event_id: "sg_dup_1",
        sg_message_id: SG_MESSAGE_ID,
      },
    ];
    const first = await postSignedEvents({app, events, privateKey: keyPair.privateKey});
    const second = await postSignedEvents({app, events, privateKey: keyPair.privateKey});
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(deliveries.length, 1);
  });

  it("releases the claim when recordDeliveryEvent save fails", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const saveSpy = spyOn(CommsMessage.prototype, "save").mockImplementation(
      async (): Promise<never> => {
        throw new Error("save failed");
      }
    );
    const events = [
      {
        event: "delivered",
        sg_event_id: "sg_save_fail_1",
        sg_message_id: SG_MESSAGE_ID,
      },
    ];
    const first = await postSignedEvents({app, events, privateKey: keyPair.privateKey});
    saveSpy.mockRestore();
    assert.equal(first.status, 500);
    const second = await postSignedEvents({app, events, privateKey: keyPair.privateKey});
    assert.equal(second.status, 200);
    const row = await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID});
    assert.equal(row.status, "delivered");
  });

  it("applies both events in a signed batch", async (): Promise<void> => {
    const secondId = "filterdrecv-xyz789";
    let call = 0;
    const mailClient = {
      send: async (): Promise<
        [{headers: Record<string, string>; statusCode: number}, Record<string, unknown>]
      > => {
        call += 1;
        const id = call === 1 ? MESSAGE_ID : secondId;
        return [{headers: {"x-message-id": id}, statusCode: 202}, {}];
      },
    };
    const {app, comms, keyPair} = buildSendGridCommsApp({mailClient});
    await comms.service.sendMail({subject: "One", to: "one@example.com"});
    await comms.service.sendMail({subject: "Two", to: "two@example.com"});
    const res = await postSignedEvents({
      app,
      events: [
        {
          event: "delivered",
          sg_event_id: "sg_batch_1",
          sg_message_id: `${MESSAGE_ID}.recvd`,
        },
        {
          event: "bounce",
          reason: "bounce",
          sg_event_id: "sg_batch_2",
          sg_message_id: `${secondId}.recvd`,
          type: "bounce",
        },
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(res.status, 200);
    assert.equal(
      (await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID})).status,
      "delivered"
    );
    assert.equal(
      (await CommsMessage.findExactlyOne({providerMessageId: secondId})).status,
      "bounced"
    );
  });

  it("does not mount SendGrid webhook paths when webhooks is omitted", async (): Promise<void> => {
    const mail = new SendGridMailProvider({
      apiKey: "sg-test",
      client: createMailClient(MESSAGE_ID),
      fromEmail: FROM_EMAIL,
      webhookVerificationKey: "not-used",
    });
    const app = new TerrenoApp({
      logRequests: false,
      skipListen: true,
      userModel: UserModel as unknown as UserModelType,
    })
      .register(new CommsApp({mail}))
      .build();
    const res = await supertest(app)
      .post(PATH)
      .set("Content-Type", "application/json")
      .send(`[{"sg_event_id":"sg_1","event":"delivered"}]`);
    assert.equal(res.status, 404);
  });

  it("skips SendGrid routes and logs when the verification key is missing", async (): Promise<void> => {
    const errorSpy = spyOn(logger, "error");
    const webhooks = new WebhooksApp({idempotency: {store: "memory"}});
    const mail = new SendGridMailProvider({
      apiKey: "sg-test",
      client: createMailClient(MESSAGE_ID),
      fromEmail: FROM_EMAIL,
    });
    const app = new TerrenoApp({
      logRequests: false,
      skipListen: true,
      userModel: UserModel as unknown as UserModelType,
    })
      .register(new CommsApp({mail, webhooks}))
      .register(webhooks)
      .build();
    const res = await supertest(app)
      .post(PATH)
      .set("Content-Type", "application/json")
      .send(`[{"sg_event_id":"sg_1","event":"delivered"}]`);
    assert.equal(res.status, 404);
    assert.isTrue(
      errorSpy.mock.calls.some((call) => String(call[0]).includes("Skipping SendGrid webhook"))
    );
    errorSpy.mockRestore();
  });

  it("maps dropped to failed", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const res = await postSignedEvents({
      app,
      events: [
        {
          event: "dropped",
          reason: "Bounced Address",
          sg_event_id: "sg_dropped_1",
          sg_message_id: `${MESSAGE_ID}.filter`,
        },
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(res.status, 200);
    const stored = await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID});
    assert.equal(stored.status, "failed");
    assert.equal(stored.errorCode, "Bounced Address");
  });

  it("maps processed to sent", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const res = await postSignedEvents({
      app,
      events: [
        {
          event: "processed",
          sg_event_id: "sg_processed_1",
          sg_message_id: `${MESSAGE_ID}.filter`,
        },
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(res.status, 200);
    assert.equal(
      (await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID})).status,
      "sent"
    );
  });

  it("skips unknown events, skipped events, and events without message ids", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const res = await postSignedEvents({
      app,
      events: [
        {event: "skipped", sg_event_id: "sg_skip_1", sg_message_id: `${MESSAGE_ID}.filter`},
        {event: "delivered"},
        {event: "bounce", type: "bounce"},
        {notAnEvent: true},
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(res.status, 200);
    assert.equal(
      (await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID})).status,
      "sent"
    );
  });

  it("uses bounce as errorCode when a bounce has no reason", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const res = await postSignedEvents({
      app,
      events: [
        {
          event: "bounce",
          sg_event_id: "sg_bounce_noreason",
          sg_message_id: `${MESSAGE_ID}.filter`,
          type: "bounce",
        },
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(res.status, 200);
    const stored = await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID});
    assert.equal(stored.status, "bounced");
    assert.equal(stored.errorCode, "bounce");
  });

  it("maps a blocked bounce to bounced with transient errorClass", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const res = await postSignedEvents({
      app,
      events: [
        {
          event: "bounce",
          reason: "blocked",
          sg_event_id: "sg_blocked_1",
          sg_message_id: SG_MESSAGE_ID,
          type: "blocked",
        },
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(res.status, 200);
    const row = await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID});
    assert.equal(row.status, "bounced");
    assert.equal(row.errorClass, "transient");
    assert.equal(row.errorCode, "blocked");
  });

  it("maps dropped and open events and ignores processed", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const processed = await postSignedEvents({
      app,
      events: [{event: "processed", sg_event_id: "sg_proc_1", sg_message_id: SG_MESSAGE_ID}],
      privateKey: keyPair.privateKey,
    });
    assert.equal(processed.status, 200);
    assert.equal(
      (await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID})).status,
      "sent"
    );
    const dropped = await postSignedEvents({
      app,
      events: [
        {
          event: "dropped",
          reason: "Bounced Address",
          sg_event_id: "sg_drop_1",
          sg_message_id: SG_MESSAGE_ID,
        },
      ],
      privateKey: keyPair.privateKey,
    });
    assert.equal(dropped.status, 200);
    const droppedRow = await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID});
    assert.equal(droppedRow.status, "failed");
    assert.equal(droppedRow.errorClass, "permanent");
    const opened = await postSignedEvents({
      app,
      events: [{event: "open", sg_event_id: "sg_open_1", sg_message_id: SG_MESSAGE_ID}],
      privateKey: keyPair.privateKey,
    });
    assert.equal(opened.status, 200);
    assert.equal(
      (await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID})).status,
      "failed"
    );
  });

  it("ignores a non-array body and events without sg_event_id", async (): Promise<void> => {
    const {app, comms, keyPair} = buildSendGridCommsApp();
    await comms.service.sendMail({subject: "Welcome", to: "person@example.com"});
    const objectBody = JSON.stringify({event: "delivered", sg_event_id: "sg_obj"});
    const {signature, timestamp} = signPayload({
      payload: objectBody,
      privateKey: keyPair.privateKey,
    });
    const objectRes = await supertest(app)
      .post(PATH)
      .set("Content-Type", "application/json")
      .set("X-Twilio-Email-Event-Webhook-Timestamp", timestamp)
      .set("X-Twilio-Email-Event-Webhook-Signature", signature)
      .send(objectBody);
    assert.equal(objectRes.status, 200);
    const missingId = await postSignedEvents({
      app,
      events: [{event: "delivered", sg_message_id: SG_MESSAGE_ID}],
      privateKey: keyPair.privateKey,
    });
    assert.equal(missingId.status, 200);
    assert.equal(
      (await CommsMessage.findExactlyOne({providerMessageId: MESSAGE_ID})).status,
      "sent"
    );
  });

  it("omits the SendGrid webhook path from OpenAPI", async (): Promise<void> => {
    const {app} = buildSendGridCommsApp();
    const response = await supertest(app).get("/openapi.json").expect(200);
    assert.notProperty(response.body.paths, PATH);
  });
});
