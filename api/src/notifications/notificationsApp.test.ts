import {afterEach, beforeEach, describe, it} from "bun:test";
import {authAsUser as authWithCredentials} from "@terreno/test";
import {assert} from "chai";
import type express from "express";
import {DateTime} from "luxon";
import type {Model} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";
import {signupUser, type UserModel as UserMongooseModel} from "../auth";
import {Notification} from "../models/notification";
import {NotificationPreference} from "../models/notificationPreference";
import {clearSyncRegistry} from "../sync/registry";
import {SyncApp} from "../sync/syncApp";
import {TerrenoApp} from "../terrenoApp";
import {authAsUser, setupDb, UserModel} from "../tests";
import {configureNotificationService, getNotificationService} from "./notificationService";
import {NotificationsApp} from "./notificationsApp";
import {
  type NotificationsBeforeSendChannel,
  notificationsBeforeSend,
} from "./notificationsBeforeSend";

interface FakeComms {
  mailCalls: Array<{html?: string; subject: string; to: string}>;
  mailUserIds: Array<string | undefined>;
  pushCalls: Array<{title: string; userId: string}>;
  smsCalls: Array<{body: string; to: string}>;
  smsUserIds: Array<string | undefined>;
}

const buildFakeComms = (
  fakeOptions: {mailError?: Error} = {}
): {
  comms: FakeComms;
  getComms: () => FakeComms & {
    sendMail: (
      message: {html?: string; subject: string; to: string},
      options?: {userId?: string}
    ) => Promise<{accepted: boolean}>;
    sendPushToUser: (message: {title: string; userId: string}) => Promise<unknown[]>;
    sendSms: (
      message: {body: string; to: string},
      options?: {userId?: string}
    ) => Promise<{accepted: boolean}>;
  };
} => {
  const comms: FakeComms = {
    mailCalls: [],
    mailUserIds: [],
    pushCalls: [],
    smsCalls: [],
    smsUserIds: [],
  };
  return {
    comms,
    getComms: () => ({
      ...comms,
      sendMail: async (message, options) => {
        if (fakeOptions.mailError) {
          throw fakeOptions.mailError;
        }
        comms.mailCalls.push(message);
        comms.mailUserIds.push(options?.userId);
        return {accepted: true};
      },
      sendPushToUser: async (message) => {
        comms.pushCalls.push(message);
        return [{accepted: true}];
      },
      sendSms: async (message, options) => {
        comms.smsCalls.push(message);
        comms.smsUserIds.push(options?.userId);
        return {accepted: true};
      },
    }),
  };
};

const buildApp = (
  options: {
    getComms?: () => ReturnType<typeof buildFakeComms>["getComms"];
    retainDays?: number;
  } = {}
): express.Application => {
  clearSyncRegistry();
  return new TerrenoApp({
    skipListen: true,
    userModel: UserModel as unknown as UserMongooseModel,
  })
    .register(new SyncApp({}))
    .register(
      new NotificationsApp({
        getComms: options.getComms,
        retainDays: options.retainDays,
        userModel: UserModel,
      })
    )
    .build();
};

describe("NotificationsApp", () => {
  let userAgent: TestAgent;
  let otherUserAgent: TestAgent;
  let userId = "";

  const clearNotificationData = async (): Promise<void> => {
    await Notification.collection.deleteMany({});
    await NotificationPreference.collection.deleteMany({});
  };

  beforeEach(async () => {
    const [, notAdmin] = await setupDb();
    userId = String(notAdmin._id);
    const app = buildApp();
    userAgent = await authAsUser(app, "notAdmin");
    await UserModel.deleteOne({email: "other-user@example.com"});
    await signupUser(UserModel, "other-user@example.com", "password");
    otherUserAgent = await authWithCredentials(app, {
      email: "other-user@example.com",
      password: "password",
    });
    await clearNotificationData();
  });

  afterEach(async () => {
    configureNotificationService({});
    await clearNotificationData();
    clearSyncRegistry();
  });

  it("notify creates one owner row when inapp is on", async () => {
    const id = await getNotificationService().notify({
      body: "Hello",
      title: "Welcome",
      userId,
    });
    assert.isString(id);
    assert.isNotEmpty(id);
    const row = await Notification.findExactlyOne({_id: id});
    assert.equal(String(row.ownerId), userId);
    assert.equal(row.title, "Welcome");
  });

  it("notify does not insert when inapp preference is off", async () => {
    await NotificationPreference.create({inapp: false, ownerId: userId});
    const id = await getNotificationService().notify({
      body: "Hidden",
      title: "Off",
      userId,
    });
    assert.equal(id, "");
    assert.equal(await Notification.countDocuments({ownerId: userId}), 0);
  });

  it("rejects unauthenticated list", async () => {
    const app = buildApp();
    await supertest(app).get("/notifications").expect(401);
  });

  it("can register the same plugin instance on repeated app builds", async () => {
    clearSyncRegistry();
    const notificationsApp = new NotificationsApp({userModel: UserModel});
    const createApp = (): express.Application =>
      new TerrenoApp({
        skipListen: true,
        userModel: UserModel as unknown as UserMongooseModel,
      })
        .register(new SyncApp({}))
        .register(notificationsApp)
        .build();

    createApp();
    const rebuilt = createApp();

    await supertest(rebuilt).get("/notifications").expect(401);
  });

  it("blocks other users from reading a notification", async () => {
    const id = await getNotificationService().notify({
      body: "Private",
      title: "Mine",
      userId,
    });
    await otherUserAgent.get(`/notifications/${id}`).expect(403);
  });

  it("rejects HTTP create on notifications", async () => {
    await userAgent
      .post("/notifications")
      .send({body: "x", ownerId: userId, title: "y"})
      .expect(405);
  });

  it("creates notification preferences for the authenticated owner", async () => {
    const response = await userAgent.post("/notification-preferences").send({mail: false});
    assert.include([200, 201], response.status);
    const preference = await NotificationPreference.findExactlyOne({ownerId: userId});
    assert.isFalse(preference.mail);
    assert.equal(String(preference.ownerId), userId);
  });

  it("allows creating preferences after the owner deletes the previous row", async () => {
    const created = await userAgent.post("/notification-preferences").send({mail: false});
    assert.include([200, 201], created.status);
    const preferenceId = created.body.data._id as string;
    await userAgent.delete(`/notification-preferences/${preferenceId}`).expect(204);

    const recreated = await userAgent.post("/notification-preferences").send({sms: false});
    assert.include([200, 201], recreated.status);
    const preference = await NotificationPreference.findExactlyOne({ownerId: userId});
    assert.isFalse(preference.sms);
    assert.notEqual(preference._id, preferenceId);
  });

  it("does not allow preference PATCH to change the owner", async () => {
    const preference = await NotificationPreference.create({ownerId: userId});
    const otherUser = await UserModel.findOne({email: "other-user@example.com"});
    assert.isOk(otherUser);

    await userAgent
      .patch(`/notification-preferences/${preference._id}`)
      .send({mail: false, ownerId: String(otherUser?._id)})
      .expect(200);

    const updated = await NotificationPreference.findExactlyOne({_id: preference._id});
    assert.equal(String(updated.ownerId), userId);
    assert.isFalse(updated.mail);
  });

  it("rejects sync create on notifications", async () => {
    const response = await userAgent.post("/sync/mutate").send({
      collection: "notifications",
      data: {body: "x", ownerId: userId, title: "y"},
      mutationId: "notification-create-rejected",
      operation: "create",
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.nack?.code, "unauthorized");
    assert.equal(await Notification.countDocuments({ownerId: userId}), 0);
  });

  it("PATCH readAt persists and strips other fields", async () => {
    const id = await getNotificationService().notify({
      body: "Body",
      title: "Original",
      userId,
    });
    const readAt = DateTime.now().toISO();
    await userAgent.patch(`/notifications/${id}`).send({readAt, title: "Hacked"}).expect(200);
    const row = await Notification.findExactlyOne({_id: id});
    assert.equal(row.title, "Original");
    assert.isOk(row.readAt);
  });

  it("PATCH readAt null marks a notification unread", async () => {
    const id = await getNotificationService().notify({
      body: "Body",
      title: "Read then unread",
      userId,
    });
    await Notification.updateOne({_id: id}, {readAt: DateTime.now().toJSDate()});
    await userAgent.patch(`/notifications/${id}`).send({readAt: null}).expect(200);
    const row = await Notification.findExactlyOne({_id: id});
    assert.isNull(row.readAt);
  });

  it("rejects invalid readAt values", async () => {
    const id = await getNotificationService().notify({
      body: "Body",
      title: "Invalid readAt",
      userId,
    });
    await userAgent.patch(`/notifications/${id}`).send({readAt: "not-a-date"}).expect(400);
    await userAgent
      .patch(`/notifications/${id}`)
      .send({readAt: {invalid: true}})
      .expect(400);
  });

  it("DELETE soft-deletes from list", async () => {
    const id = await getNotificationService().notify({
      body: "Body",
      title: "Dismiss me",
      userId,
    });
    await userAgent.delete(`/notifications/${id}`).expect(204);
    const list = await userAgent.get("/notifications").expect(200);
    assert.equal(list.body.data.length, 0);
  });

  it("PATCH archivedAt archives a notification without tombstoning it", async () => {
    const id = await getNotificationService().notify({
      body: "Archive me",
      title: "Archive me",
      userId,
    });
    const archivedAt = DateTime.now().toISO();
    await userAgent.patch(`/notifications/${id}`).send({archivedAt}).expect(200);
    const row = await Notification.findExactlyOne({_id: id});
    assert.isOk(row.archivedAt);
    assert.isFalse(row.deleted);
    const list = await userAgent.get("/notifications").expect(200);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0]?._id, id);
  });

  it("rejects invalid archivedAt values", async () => {
    const id = await getNotificationService().notify({
      body: "Body",
      title: "Invalid archivedAt",
      userId,
    });
    await userAgent.patch(`/notifications/${id}`).send({archivedAt: "not-a-date"}).expect(400);
  });

  it("notificationsBeforeSend cancels mail when mail pref is false", async () => {
    await NotificationPreference.create({mail: false, ownerId: userId});
    const result = await notificationsBeforeSend({channel: "mail", userId});
    assert.deepEqual(result, {cancel: true});
  });

  it("notificationsBeforeSend cancels push and SMS when their preferences are false", async () => {
    await NotificationPreference.create({ownerId: userId, push: false, sms: false});
    assert.deepEqual(await notificationsBeforeSend({channel: "push", userId}), {cancel: true});
    assert.deepEqual(await notificationsBeforeSend({channel: "sms", userId}), {cancel: true});
  });

  it("notificationsBeforeSend does not cancel when preference row is missing", async () => {
    const result = await notificationsBeforeSend({channel: "mail", userId});
    assert.isUndefined(result);
  });

  it("notificationsBeforeSend never cancels verification", async () => {
    await NotificationPreference.create({
      inapp: false,
      mail: false,
      ownerId: userId,
      push: false,
      sms: false,
    });
    const result = await notificationsBeforeSend({channel: "verification", userId});
    assert.isUndefined(result);
  });

  it("notificationsBeforeSend does not cancel when userId is missing", async () => {
    const result = await notificationsBeforeSend({channel: "mail"});
    assert.isUndefined(result);
  });

  it("notificationsBeforeSend does not cancel for channels without a preference field", async () => {
    await NotificationPreference.create({
      inapp: false,
      mail: false,
      ownerId: userId,
      push: false,
      sms: false,
    });
    const result = await notificationsBeforeSend({
      channel: "inapp" as unknown as NotificationsBeforeSendChannel,
      userId,
    });
    assert.isUndefined(result);
  });

  it("fan-out calls mail when pref on and email present", async () => {
    const {comms, getComms} = buildFakeComms();
    configureNotificationService({getComms, userModel: UserModel});
    await getNotificationService().notify({
      body: "Body",
      title: "Mail me",
      userId,
    });
    assert.equal(comms.mailCalls.length, 1);
    assert.equal(comms.mailCalls[0]?.to, "notAdmin@example.com");
    assert.deepEqual(comms.mailUserIds, [userId]);
    assert.equal(comms.mailCalls[0]?.html, "<p>Body</p>");
  });

  it("fan-out escapes HTML in mail while preserving plain text", async () => {
    const {comms, getComms} = buildFakeComms();
    configureNotificationService({getComms, userModel: UserModel});
    await getNotificationService().notify({
      body: '<script>alert("x")</script> & more',
      title: "Safe mail",
      userId,
    });
    assert.equal(
      comms.mailCalls[0]?.html,
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more</p>"
    );
  });

  it("fan-out calls SMS and push when preferences and destinations are available", async () => {
    const {comms, getComms} = buildFakeComms();
    const userModel = {
      findById: () => ({
        select: () => ({
          lean: async () => ({
            email: "notAdmin@example.com",
            phone: "+15551234567",
          }),
        }),
      }),
    } as unknown as Model<{email?: string; phone?: string}>;
    configureNotificationService({getComms, userModel});
    await getNotificationService().notify({
      body: "Body",
      title: "Every channel",
      userId,
    });
    assert.deepEqual(comms.smsCalls, [{body: "Every channel: Body", to: "+15551234567"}]);
    assert.deepEqual(comms.smsUserIds, [userId]);
    assert.deepEqual(comms.pushCalls, [{body: "Body", title: "Every channel", userId}]);
  });

  it("fan-out skips mail when pref off", async () => {
    const {comms, getComms} = buildFakeComms();
    configureNotificationService({getComms, userModel: UserModel});
    await NotificationPreference.create({mail: false, ownerId: userId});
    await getNotificationService().notify({
      body: "Body",
      title: "No mail",
      userId,
    });
    assert.equal(comms.mailCalls.length, 0);
  });

  it("fan-out continues SMS and push when sendMail rejects", async () => {
    const {comms, getComms} = buildFakeComms({mailError: new Error("smtp down")});
    const userModel = {
      findById: () => ({
        select: () => ({
          lean: async () => ({
            email: "notAdmin@example.com",
            phone: "+15551234567",
          }),
        }),
      }),
    } as unknown as Model<{email?: string; phone?: string}>;
    configureNotificationService({getComms, userModel});
    const id = await getNotificationService().notify({
      body: "Body",
      title: "Keep going",
      userId,
    });
    assert.isNotEmpty(id);
    assert.equal(comms.mailCalls.length, 0);
    assert.deepEqual(comms.smsCalls, [{body: "Keep going: Body", to: "+15551234567"}]);
    assert.deepEqual(comms.pushCalls, [{body: "Body", title: "Keep going", userId}]);
  });

  it("notify resolves when getComms throws after inbox write", async () => {
    configureNotificationService({
      getComms: () => {
        throw new Error("comms down");
      },
      userModel: UserModel,
    });
    const id = await getNotificationService().notify({
      body: "Still here",
      title: "Resilient",
      userId,
    });
    assert.isNotEmpty(id);
  });

  it("mark-all-read only affects caller", async () => {
    const otherUserId = String((await UserModel.findOne({email: "admin@example.com"}))?._id);
    await getNotificationService().notify({body: "A", title: "A", userId});
    await getNotificationService().notify({body: "B", title: "B", userId: otherUserId});
    await userAgent.post("/notifications/mark-all-read").expect(200);
    const mine = await Notification.find({ownerId: userId});
    const theirs = await Notification.find({ownerId: otherUserId});
    assert.isOk(mine[0]?.readAt);
    assert.isNull(theirs[0]?.readAt ?? null);
  });

  it("retainDays 0 leaves old rows", async () => {
    const row = await Notification.create({
      body: "Old",
      created: DateTime.now().minus({days: 3}).toJSDate(),
      ownerId: userId,
      title: "Old",
    });
    configureNotificationService({retainDays: 0, userModel: UserModel});
    const swept = await getNotificationService().sweepExpired();
    assert.equal(swept, 0);
    const stillThere = await Notification.findById(row._id);
    assert.isFalse(stillThere?.deleted);
  });

  it("retainDays 1 tombstones rows older than one day", async () => {
    configureNotificationService({retainDays: 1, userModel: UserModel});
    const row = await Notification.create({
      body: "Stale",
      created: DateTime.now().minus({days: 2}).toJSDate(),
      ownerId: userId,
      title: "Stale",
    });
    const swept = await getNotificationService().sweepExpired();
    assert.equal(swept, 1);
    const tombstoned = await Notification.findOne({_id: row._id, deleted: true});
    assert.isTrue(tombstoned?.deleted);
  });

  it("notify sweeps expired rows when retainDays is enabled", async () => {
    configureNotificationService({retainDays: 1, userModel: UserModel});
    const stale = await Notification.create({
      body: "Stale",
      created: DateTime.now().minus({days: 2}).toJSDate(),
      ownerId: userId,
      title: "Stale",
    });
    await getNotificationService().notify({
      body: "Fresh",
      title: "Fresh",
      userId,
    });
    const tombstoned = await Notification.findOne({_id: stale._id, deleted: true});
    assert.isTrue(tombstoned?.deleted);
  });

  it("notification collection has no TTL index", async () => {
    const indexes = await Notification.collection.indexes();
    const ttl = indexes.find((index) => "expireAfterSeconds" in index);
    assert.isUndefined(ttl);
  });
});
