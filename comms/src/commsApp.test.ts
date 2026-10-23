import {beforeEach, describe, it} from "bun:test";
import {
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  setupAuth,
  TerrenoApp,
  type UserModel as UserModelType,
} from "@terreno/api";
import {authAsUser, getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import {assert} from "chai";
import type express from "express";
import {DateTime} from "luxon";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {CommsApp, getCommsService} from "./commsApp";
import {CommsMessage} from "./models/commsMessage";
import {PushToken} from "./models/pushToken";
import type {PushProvider, SendResult} from "./types";

const buildApp = (): express.Application => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);
  new CommsApp().register(app);
  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

const signUpAgent = async (
  app: express.Application,
  email: string
): Promise<{agent: TestAgent; userId: string}> => {
  const agent = supertest.agent(app);
  const signup = await agent.post("/auth/signup").send({email, password: "racer-password"});
  await agent.set("authorization", `Bearer ${signup.body.data.token}`);
  return {agent, userId: signup.body.data.userId};
};

describe("CommsApp", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    // The atomic token claim relies on the unique index, so make sure it is built.
    await PushToken.init();
    await Promise.all([CommsMessage.deleteMany({}), PushToken.deleteMany({})]);
  });

  it("registers the configured service accessor", (): void => {
    const app = getBaseServer();
    const plugin = new CommsApp({logMessages: false});

    plugin.register(app);

    assert.strictEqual(getCommsService(), plugin.service);
  });

  it("labels the admin sidebar screen as Comms Dashboard", (): void => {
    const contribution = new CommsApp().adminContribution();

    assert.equal(contribution.customScreens?.[0]?.displayName, "Comms Dashboard");
    assert.equal(contribution.customScreens?.[0]?.name, "comms");
  });

  it("upserts push tokens and isolates list and delete operations by owner", async (): Promise<void> => {
    const app = buildApp();
    const owner = await authAsUser(app, "notAdmin");
    const admin = await authAsUser(app, "admin");
    const other = supertest.agent(app);
    const signup = await other
      .post("/auth/signup")
      .send({email: "other@example.com", password: "other-password"})
      .expect(200);
    await other.set("authorization", `Bearer ${signup.body.data.token}`);

    const created = await owner
      .post("/comms/pushTokens")
      .send({deviceId: "device-1", platform: "ios", token: "ExponentPushToken[test]"})
      .expect(201);
    const updated = await owner
      .post("/comms/pushTokens")
      .send({deviceId: "device-1", platform: "android", token: "ExponentPushToken[test]"})
      .expect(200);

    assert.equal(created.body.data._id, updated.body.data._id);
    assert.equal(updated.body.data.platform, "android");
    assert.equal(updated.body.data.deviceId, "device-1");
    assert.equal(await PushToken.countDocuments(), 1);

    // The atomic claim bypasses save() middleware, so it maintains timestamps itself.
    const stored = await PushToken.findExactlyOne({token: "ExponentPushToken[test]"});
    assert.instanceOf(stored.created, Date);
    assert.instanceOf(stored.updated, Date);
    assert.isFalse(stored.deleted);
    assert.equal(
      stored.created.toISOString(),
      new Date(created.body.data.created).toISOString(),
      "created must not change on refresh"
    );
    assert.isAtLeast(stored.updated.getTime(), stored.created.getTime());

    const refreshed = await owner
      .post("/comms/pushTokens")
      .send({platform: "android", token: "ExponentPushToken[test]"})
      .expect(200);
    assert.equal(refreshed.body.data.deviceId, "device-1");

    const ownerList = await owner.get("/comms/pushTokens").expect(200);
    const otherList = await other.get("/comms/pushTokens").expect(200);
    assert.lengthOf(ownerList.body.data, 1);
    assert.lengthOf(otherList.body.data, 0);

    await other.delete(`/comms/pushTokens/${created.body.data._id}`).expect(403);
    await admin.delete(`/comms/pushTokens/${created.body.data._id}`).expect(403);
    await owner.delete(`/comms/pushTokens/${created.body.data._id}`).expect(204);

    const token = await PushToken.findExactlyOne({_id: created.body.data._id});
    assert.isFalse(token.active);
  });

  it("requires authentication for push-token registration", async (): Promise<void> => {
    const app = buildApp();

    await supertest(app)
      .post("/comms/pushTokens")
      .send({platform: "ios", token: "ExponentPushToken[test]"})
      .expect(401);
  });

  it("transfers an inactive device token without allowing active-token takeover", async (): Promise<void> => {
    const app = buildApp();
    const first = await authAsUser(app, "notAdmin");
    const second = supertest.agent(app);
    const signup = await second
      .post("/auth/signup")
      .send({email: "second@example.com", password: "second-password"})
      .expect(200);
    await second.set("authorization", `Bearer ${signup.body.data.token}`);

    const created = await first
      .post("/comms/pushTokens")
      .send({platform: "ios", token: "ExponentPushToken[transfer]"})
      .expect(201);
    await second
      .post("/comms/pushTokens")
      .send({platform: "android", token: "ExponentPushToken[transfer]"})
      .expect(409);
    assert.lengthOf((await first.get("/comms/pushTokens").expect(200)).body.data, 1);
    assert.lengthOf((await second.get("/comms/pushTokens").expect(200)).body.data, 0);

    await first.delete(`/comms/pushTokens/${created.body.data._id}`).expect(204);
    const transferred = await second
      .post("/comms/pushTokens")
      .send({platform: "android", token: "ExponentPushToken[transfer]"})
      .expect(200);

    assert.equal(await PushToken.countDocuments(), 1);
    assert.equal(transferred.body.data.userId, signup.body.data.userId);
    assert.lengthOf((await first.get("/comms/pushTokens").expect(200)).body.data, 0);
    assert.lengthOf((await second.get("/comms/pushTokens").expect(200)).body.data, 1);
  });

  it("claims a new token for exactly one user under concurrent registration", async (): Promise<void> => {
    const app = buildApp();
    const [first, second] = await Promise.all([
      signUpAgent(app, "racer-one@example.com"),
      signUpAgent(app, "racer-two@example.com"),
    ]);

    const responses = await Promise.all([
      first.agent
        .post("/comms/pushTokens")
        .send({platform: "ios", token: "ExponentPushToken[race]"}),
      second.agent
        .post("/comms/pushTokens")
        .send({platform: "android", token: "ExponentPushToken[race]"}),
    ]);

    const accepted = responses.filter((response) => response.status < 300);
    const conflicted = responses.filter((response) => response.status === 409);
    assert.lengthOf(accepted, 1);
    assert.lengthOf(conflicted, 1);
    assert.equal(await PushToken.countDocuments({token: "ExponentPushToken[race]"}), 1);

    const stored = await PushToken.findExactlyOne({token: "ExponentPushToken[race]"});
    assert.equal(stored.userId.toString(), accepted[0]?.body.data.userId);
  });

  it("claims a released token for exactly one user under concurrent registration", async (): Promise<void> => {
    const app = buildApp();
    const owner = await authAsUser(app, "notAdmin");
    const [first, second] = await Promise.all([
      signUpAgent(app, "claimer-one@example.com"),
      signUpAgent(app, "claimer-two@example.com"),
    ]);

    const created = await owner
      .post("/comms/pushTokens")
      .send({platform: "ios", token: "ExponentPushToken[released]"})
      .expect(201);
    await owner.delete(`/comms/pushTokens/${created.body.data._id}`).expect(204);

    const responses = await Promise.all([
      first.agent
        .post("/comms/pushTokens")
        .send({platform: "ios", token: "ExponentPushToken[released]"}),
      second.agent
        .post("/comms/pushTokens")
        .send({platform: "android", token: "ExponentPushToken[released]"}),
    ]);

    const accepted = responses.filter((response) => response.status < 300);
    assert.lengthOf(accepted, 1);
    assert.lengthOf(
      responses.filter((response) => response.status === 409),
      1
    );
    assert.equal(await PushToken.countDocuments({token: "ExponentPushToken[released]"}), 1);

    const stored = await PushToken.findExactlyOne({token: "ExponentPushToken[released]"});
    assert.isTrue(stored.active);
    assert.equal(stored.userId.toString(), accepted[0]?.body.data.userId);
  });

  it("keeps an active token with its owner while a foreign claim races a refresh", async (): Promise<void> => {
    const app = buildApp();
    const {agent: owner, userId: ownerId} = await signUpAgent(app, "holder@example.com");
    const {agent: intruder} = await signUpAgent(app, "intruder@example.com");
    await owner
      .post("/comms/pushTokens")
      .send({platform: "ios", token: "ExponentPushToken[held]"})
      .expect(201);

    const [refresh, takeover] = await Promise.all([
      owner.post("/comms/pushTokens").send({platform: "ios", token: "ExponentPushToken[held]"}),
      intruder
        .post("/comms/pushTokens")
        .send({platform: "android", token: "ExponentPushToken[held]"}),
    ]);

    assert.isBelow(refresh.status, 300);
    assert.equal(takeover.status, 409);
    assert.equal(await PushToken.countDocuments({token: "ExponentPushToken[held]"}), 1);
    const stored = await PushToken.findExactlyOne({token: "ExponentPushToken[held]"});
    assert.equal(stored.userId.toString(), ownerId);
    assert.equal(stored.platform, "ios");
  });

  it("revives a soft-deleted token row on re-registration", async (): Promise<void> => {
    const app = buildApp();
    const {agent, userId} = await signUpAgent(app, "revive@example.com");
    const created = await agent
      .post("/comms/pushTokens")
      .send({platform: "ios", token: "ExponentPushToken[revive]"})
      .expect(201);
    await PushToken.updateOne({_id: created.body.data._id}, {$set: {active: false, deleted: true}});

    const revived = await agent
      .post("/comms/pushTokens")
      .send({platform: "android", token: "ExponentPushToken[revive]"})
      .expect(200);

    assert.equal(revived.body.data._id, created.body.data._id);
    assert.equal(await PushToken.countDocuments({token: "ExponentPushToken[revive]"}), 1);
    const stored = await PushToken.findExactlyOne({token: "ExponentPushToken[revive]"});
    assert.isTrue(stored.active);
    assert.isFalse(stored.deleted);
    assert.equal(stored.userId.toString(), userId);
  });

  it("keeps refreshes idempotent for the owner under concurrent registration", async (): Promise<void> => {
    const app = buildApp();
    const {agent, userId} = await signUpAgent(app, "self-racer@example.com");

    const responses = await Promise.all([
      agent.post("/comms/pushTokens").send({platform: "ios", token: "ExponentPushToken[self]"}),
      agent.post("/comms/pushTokens").send({platform: "ios", token: "ExponentPushToken[self]"}),
    ]);

    for (const response of responses) {
      assert.isBelow(response.status, 300);
    }
    assert.equal(await PushToken.countDocuments({token: "ExponentPushToken[self]"}), 1);
    const stored = await PushToken.findExactlyOne({token: "ExponentPushToken[self]"});
    assert.equal(stored.userId.toString(), userId);
  });

  it("rejects unauthenticated reads, deletes, and explorer requests", async (): Promise<void> => {
    const app = buildApp();
    const anonymous = supertest(app);

    await anonymous.get("/comms/pushTokens").expect(401);
    await anonymous.delete("/comms/pushTokens/507f1f77bcf86cd799439011").expect(401);
    await anonymous.get("/comms/messages").expect(401);
  });

  it("validates push-token registration fields", async (): Promise<void> => {
    const app = buildApp();
    const owner = await authAsUser(app, "notAdmin");

    await owner.post("/comms/pushTokens").send({platform: "ios", token: " "}).expect(400);
    await owner.post("/comms/pushTokens").send({platform: "ios"}).expect(400);
    await owner
      .post("/comms/pushTokens")
      .send({token: "ExponentPushToken[missing-platform]"})
      .expect(400);
    await owner
      .post("/comms/pushTokens")
      .send({platform: "desktop", token: "ExponentPushToken[test]"})
      .expect(400);
  });

  it("exposes a paginated, filterable delivery explorer to admins only", async (): Promise<void> => {
    const app = buildApp();
    const admin = await authAsUser(app, "admin");
    const user = await authAsUser(app, "notAdmin");
    await Promise.all([
      CommsMessage.logSend({
        channel: "mail",
        provider: "console",
        status: "sent",
        to: "[redacted]",
      }),
      CommsMessage.logSend({
        channel: "sms",
        provider: "console",
        status: "failed",
        to: "[redacted]",
      }),
    ]);

    await user.get("/comms/messages").expect(403);
    const response = await admin
      .get("/comms/messages")
      .query({channel: "sms", limit: 1, page: 1, status: "failed"})
      .expect(200);

    assert.lengthOf(response.body.data, 1);
    assert.equal(response.body.data[0].channel, "sms");
    assert.equal(response.body.data[0].status, "failed");
    assert.equal(response.body.limit, 1);
    assert.equal(response.body.page, 1);
    assert.equal(response.body.total, 1);
    assert.isFalse(response.body.more);
  });

  it("filters the delivery explorer by user and date and validates date input", async (): Promise<void> => {
    const app = buildApp();
    const admin = await authAsUser(app, "admin");
    const userId = "507f1f77bcf86cd799439011";
    await CommsMessage.logSend({
      channel: "mail",
      provider: "console",
      status: "sent",
      to: "[redacted]",
      userId,
    });
    const startDate = DateTime.utc().minus({minutes: 1}).toISO();
    const endDate = DateTime.utc().plus({minutes: 1}).toISO();

    const response = await admin
      .get("/comms/messages")
      .query({endDate, startDate, userId})
      .expect(200);

    assert.lengthOf(response.body.data, 1);
    assert.equal(response.body.data[0].userId, userId);
    assert.equal(
      (await admin.get("/comms/messages").query({userId: "507f191e810c19729de860ea"})).body.total,
      0
    );
    assert.equal(
      (await admin.get("/comms/messages").query({startDate: "not-a-date"}).expect(400)).body.title,
      "Invalid startDate format"
    );
    assert.equal(
      (await admin.get("/comms/messages").query({endDate: "not-a-date"}).expect(400)).body.title,
      "Invalid endDate format"
    );
    assert.equal(
      (
        await admin
          .get("/comms/messages")
          .query({
            endDate: DateTime.utc().minus({minutes: 1}).toISO(),
            startDate: DateTime.utc().plus({minutes: 1}).toISO(),
          })
          .expect(400)
      ).body.title,
      "startDate must not be after endDate"
    );
  });

  it("clamps explorer pagination and reports additional pages", async (): Promise<void> => {
    const app = buildApp();
    const admin = await authAsUser(app, "admin");
    await Promise.all(
      ["mail", "sms"].map(
        async (channel): Promise<unknown> =>
          CommsMessage.logSend({
            channel: channel as "mail" | "sms",
            provider: "console",
            status: "sent",
            to: "[redacted]",
          })
      )
    );

    const first = await admin.get("/comms/messages").query({limit: 1, page: 0}).expect(200);
    const second = await admin.get("/comms/messages").query({limit: 1, page: 2}).expect(200);
    const clamped = await admin.get("/comms/messages").query({limit: 999}).expect(200);
    const negative = await admin.get("/comms/messages").query({limit: -10, page: -2}).expect(200);
    const nonNumeric = await admin
      .get("/comms/messages")
      .query({limit: "invalid", page: "invalid"})
      .expect(200);

    assert.equal(first.body.page, 1);
    assert.isTrue(first.body.more);
    assert.equal(second.body.page, 2);
    assert.isFalse(second.body.more);
    assert.equal(clamped.body.limit, 100);
    assert.equal(negative.body.limit, 1);
    assert.equal(negative.body.page, 1);
    assert.equal(nonNumeric.body.limit, 20);
    assert.equal(nonNumeric.body.page, 1);
  });

  it("publishes push-token and delivery-explorer routes in OpenAPI", async (): Promise<void> => {
    const app = new TerrenoApp({
      skipListen: true,
      userModel: UserModel as unknown as UserModelType,
    })
      .register(new CommsApp())
      .build();

    const response = await supertest(app).get("/openapi.json").expect(200);

    assert.property(response.body.paths, "/comms/pushTokens");
    assert.property(response.body.paths["/comms/pushTokens"], "post");
    assert.property(response.body.paths, "/comms/messages");
    assert.property(response.body.paths["/comms/messages"], "get");
    assert.property(response.body.paths, "/comms/messages/{id}");
    assert.property(response.body.paths["/comms/messages/{id}"], "get");
    assert.property(response.body.paths, "/comms/messages/{id}/retry");
    assert.property(response.body.paths["/comms/messages/{id}/retry"], "post");
    assert.property(response.body.paths, "/comms/messages/retryMany");
    assert.property(response.body.paths, "/comms/stats");
    assert.notProperty(response.body.paths, "/comms/pushTokens/");

    // A shared tag keeps generated SDK mutations invalidating the by-id read.
    for (const operation of [
      response.body.paths["/comms/pushTokens"].post,
      response.body.paths["/comms/pushTokens"].get,
      response.body.paths["/comms/pushTokens/{id}"].get,
      response.body.paths["/comms/pushTokens/{id}"].delete,
    ]) {
      assert.includeMembers(operation.tags, ["comms"]);
    }
  });

  describe("push delivery and the account lifecycle", () => {
    let sentTokens: string[][];
    const push: PushProvider = {
      id: "lifecycle-push",
      sendPush: async (message): Promise<SendResult[]> => {
        sentTokens.push(message.tokens);
        return message.tokens.map((): SendResult => ({accepted: true}));
      },
    };

    const buildLifecycleApp = (): {app: express.Application; plugin: CommsApp} => {
      const plugin = new CommsApp({logMessages: false, push});
      const app = new TerrenoApp({
        skipListen: true,
        userModel: UserModel as unknown as UserModelType,
      })
        .register(plugin)
        .build();
      return {app, plugin};
    };

    const registerDevice = async (agent: TestAgent, token: string): Promise<void> => {
      await agent.post("/comms/pushTokens").send({platform: "ios", token}).expect(201);
    };

    beforeEach((): void => {
      sentTokens = [];
    });

    it("stops pushing to a device registered before the user's credentials changed", async (): Promise<void> => {
      const {app, plugin} = buildLifecycleApp();
      const {agent, userId} = await signUpAgent(app, "epoch@example.com");
      await registerDevice(agent, "ExponentPushToken[epoch]");
      assert.lengthOf(await plugin.service.sendPushToUser({body: "B", title: "T", userId}), 1);

      await UserModel.updateOne({_id: userId}, {$inc: {tokenEpoch: 1}});
      const afterReset = await plugin.service.sendPushToUser({body: "B", title: "T", userId});

      assert.lengthOf(afterReset, 0);
      assert.deepEqual(sentTokens, [["ExponentPushToken[epoch]"]]);
      const stored = await PushToken.findExactlyOne({token: "ExponentPushToken[epoch]"});
      assert.isFalse(stored.active);
    });

    it("pushes again after the device registers under the new credentials", async (): Promise<void> => {
      const {app, plugin} = buildLifecycleApp();
      const {agent, userId} = await signUpAgent(app, "reregister@example.com");
      await registerDevice(agent, "ExponentPushToken[again]");
      await UserModel.updateOne({_id: userId}, {$inc: {tokenEpoch: 1}});
      await plugin.service.sendPushToUser({body: "B", title: "T", userId});

      await agent
        .post("/comms/pushTokens")
        .send({platform: "ios", token: "ExponentPushToken[again]"})
        .expect(200);
      const results = await plugin.service.sendPushToUser({body: "B", title: "T", userId});

      assert.lengthOf(results, 1);
      assert.deepEqual(sentTokens, [["ExponentPushToken[again]"]]);
    });

    it("does not push to a disabled user and releases their devices", async (): Promise<void> => {
      const {app, plugin} = buildLifecycleApp();
      const {agent, userId} = await signUpAgent(app, "disabled@example.com");
      await registerDevice(agent, "ExponentPushToken[disabled]");

      await UserModel.updateOne({_id: userId}, {$set: {disabled: true}});
      const results = await plugin.service.sendPushToUser({body: "B", title: "T", userId});

      assert.lengthOf(results, 0);
      assert.lengthOf(sentTokens, 0);
      assert.equal(await PushToken.countDocuments({active: true}), 0);
    });

    it("does not push to a user that no longer exists", async (): Promise<void> => {
      const {app, plugin} = buildLifecycleApp();
      const {agent, userId} = await signUpAgent(app, "deleted@example.com");
      await registerDevice(agent, "ExponentPushToken[deleted]");

      await UserModel.deleteOne({_id: userId});
      const results = await plugin.service.sendPushToUser({body: "B", title: "T", userId});

      assert.lengthOf(results, 0);
      assert.lengthOf(sentTokens, 0);
      assert.equal(await PushToken.countDocuments({active: true}), 0);
    });
  });

  describe("auth recovery mail", () => {
    const buildRecoveryApp = (): express.Application => {
      const plugin = new CommsApp();
      return new TerrenoApp({
        authOptions: {
          publicAppUrl: "https://app.example.com",
          sendMail: async (message): Promise<void> => {
            await getCommsService().sendMail(message);
          },
        },
        skipListen: true,
        userModel: UserModel as unknown as UserModelType,
      })
        .register(plugin)
        .build();
    };

    it("keeps the reset link out of the message log and the dashboard", async (): Promise<void> => {
      const app = buildRecoveryApp();
      const admin = await authAsUser(app, "admin");

      await supertest(app)
        .post("/auth/forgotPassword")
        .send({email: "notAdmin@example.com"})
        .expect(202);

      const rows = await CommsMessage.find({channel: "mail"});
      assert.lengthOf(rows, 1);
      assert.isUndefined(rows[0]?.payload);
      assert.equal(rows[0]?.subject, "Reset your password");
      const list = await admin.get("/comms/messages").expect(200);
      assert.notInclude(JSON.stringify(list.body), "token=");
      assert.notInclude(JSON.stringify(list.body), "notAdmin@example.com");
    });
  });
});
