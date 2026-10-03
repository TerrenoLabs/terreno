import {afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout} from "bun:test";
import net from "node:net";
import {TerrenoApp} from "@terreno/api";
import {APICallError, type LanguageModel} from "ai";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import {harnessErrorMatching} from "../tests/harnessErrors";
import {
  gatedStreamingModel,
  listen,
  openSse,
  type SseClient,
  type SseFrame,
} from "../tests/harnessStreaming";
import {ensureTestUsers, UserModel} from "../tests/helpers";
import type {HarnessStreamingOptions} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import type {HarnessModels} from "./commit";
import {appendEvents, HarnessDeltaWriter, resolveStreamingOptions} from "./events";
import {
  type AnyHarnessTaskDefinition,
  defineAgent,
  defineTask,
  Harness,
  HarnessApp,
  type HarnessRegistryEntry,
  InProcessRunner,
} from "./harness";
import {registerHarnessApproval} from "./models/harnessApproval";
import {registerHarnessConversation} from "./models/harnessConversation";
import {registerHarnessEvent, registerHarnessEventStream} from "./models/harnessEvent";
import {registerHarnessInboxEvent} from "./models/harnessInboxEvent";
import {registerHarnessMessage} from "./models/harnessMessage";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";

// Whole turns over real HTTP on a replica set; the first test also pays for index creation.
setDefaultTimeout(30_000);

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
const ConversationModel = registerHarnessConversation();
const MessageModel = registerHarnessMessage();
const ApprovalModel = registerHarnessApproval();
const InboxModel = registerHarnessInboxEvent();
const EventModel = registerHarnessEvent();
const EventStreamModel = registerHarnessEventStream();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

const OWNER = {admin: false, email: "owner@example.com", name: "Owner", password: "pw-owner"};
const OTHER = {admin: false, email: "other@example.com", name: "Other", password: "pw-other"};
const ADMIN = {admin: true, email: "admin@example.com", name: "Admin", password: "pw-admin"};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async (predicate: () => Promise<boolean>, label: string): Promise<void> => {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) {
      return;
    }
    await pause(10);
  }
  throw new Error(`waitUntil timed out: ${label}`);
};

const cleanups: Array<() => Promise<void> | void> = [];

const openHarness = async ({
  model,
  registry,
  start,
  streaming = {deltaFlushChars: 1000, deltaFlushInterval: {milliseconds: 20}},
}: {
  model?: unknown;
  registry: ReadonlyArray<HarnessRegistryEntry>;
  start: boolean;
  streaming?: HarnessStreamingOptions;
}): Promise<Harness> => {
  const harness = await Harness.open({
    models: () => model as LanguageModel,
    registry,
    runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
    streaming,
    testHooks: {random: () => 0},
  });
  cleanups.push(() => harness.stop());
  if (start) {
    await harness.start();
  }
  return harness;
};

/** An express app serving `harness`'s HTTP API, listening on a free port. */
const serve = async (
  harness: Harness
): Promise<{app: express.Application; plugin: HarnessApp; url: string}> => {
  const plugin = new HarnessApp({harness, heartbeatInterval: {milliseconds: 50}});
  const app = new TerrenoApp({skipListen: true, userModel: UserModel}).register(plugin).build();
  const {stop, url} = await listen(app);
  cleanups.push(stop);
  return {app, plugin, url};
};

/** Open change-stream cursors on the server, idle ones included. */
const openChangeStreams = async (): Promise<number> => {
  const ops = await mongoose.connection.client
    .db("admin")
    .aggregate([
      {$currentOp: {allUsers: true, idleCursors: true}},
      {$match: {"cursor.originatingCommand.pipeline.0.$changeStream": {$exists: true}}},
    ])
    .toArray();
  return ops.length;
};

const tokenFor = async (app: express.Application, email: string, password: string) => {
  const res = await supertest(app).post("/auth/login").send({email, password}).expect(200);
  return `Bearer ${res.body.data.token as string}`;
};

const userIdOf = async (email: string): Promise<string> =>
  String((await UserModel.find({email}).lean())[0]?._id);

const sse = async (
  url: string,
  token: string,
  headers: Record<string, string> = {}
): Promise<SseClient> => {
  const client = await openSse(url, {headers: {authorization: token, ...headers}});
  cleanups.push(() => client.close());
  return client;
};

/** Status and body of a request that must fail before streaming starts. */
const refused = async (url: string, headers: Record<string, string> = {}) => {
  const response = await fetch(url, {headers});
  return {body: await response.json(), status: response.status};
};

const storedEvents = (streamId: unknown) => EventModel.find({streamId}).sort({seq: 1}).lean();

const deltaText = (frames: ReadonlyArray<SseFrame>): string =>
  frames
    .filter((frame) => frame.event === "delta")
    .map((frame) => (frame.data.payload as {text: string}).text)
    .join("");

const agent = defineAgent({
  instructions: "Answer briefly.",
  model: {modelId: "gated-model", provider: "mock"},
  modelRetry: {backoffMs: 1, maxBackoffMs: 2},
  name: "test.streamer",
});

describe("Harness event stream", () => {
  let ownerId: string;

  beforeAll(async () => {
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
    await ensureTestUsers([OWNER, OTHER, ADMIN]);
    ownerId = await userIdOf(OWNER.email);
  });

  beforeEach(async () => {
    await Promise.all(
      [
        TaskModel,
        OwnerModel,
        ConversationModel,
        MessageModel,
        ApprovalModel,
        InboxModel,
        EventModel,
        EventStreamModel,
        SpanModel,
        TraceModel,
      ].map((model) => (model as {deleteMany: (filter: object) => Promise<unknown>}).deleteMany({}))
    );
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  describe("reconnect across instances (AC9)", () => {
    it("replays every missed event exactly once from another instance, then streams live", async () => {
      const gated = gatedStreamingModel();
      const harnessA = await openHarness({model: gated.model, registry: [agent], start: true});
      // Instance B serves HTTP only; instance A's runner executes the turn.
      const harnessB = await openHarness({model: gated.model, registry: [agent], start: false});
      const a = await serve(harnessA);
      const b = await serve(harnessB);
      const token = await tokenFor(a.app, OWNER.email, OWNER.password);
      const conversation = await harnessA.createConversation({agent, userId: ownerId});
      const path = `/harness/conversations/${conversation.id}/events`;

      const submitted = await supertest(a.app)
        .post(`/harness/conversations/${conversation.id}/submit`)
        .set("authorization", token)
        .send({content: "Say hello", requestId: "r1"})
        .expect(200);
      expect(submitted.body.data.disposition).toBe("started");

      const first = await sse(`${a.url}${path}`, token);
      const request = await gated.nextRequest();
      request.text("Hel");
      await first.waitFor((frame) => frame.event === "delta");
      expect(first.frames.map((frame) => frame.event)).toEqual([
        "message.created",
        "turn.started",
        "delta",
      ]);
      const lastSeen = first.frames.at(-1)?.id as number;
      first.close();

      // Missed while disconnected: two deltas.
      request.text("lo ");
      await waitUntil(async () => (await storedEvents(conversation.id)).length === 4, "2nd delta");
      request.text("wor");
      await waitUntil(async () => (await storedEvents(conversation.id)).length === 5, "3rd delta");

      const second = await sse(`${b.url}${path}`, token, {"Last-Event-ID": String(lastSeen)});
      await second.waitFor((frame) => frame.id === 5);
      request.text("ld");
      request.finish();
      await second.waitFor((frame) => frame.event === "turn.finished");

      const stored = await storedEvents(conversation.id);
      const replayedAndLive = second.frames.map((frame) => frame.id);
      // Exactly the events after Last-Event-ID, once each, in order.
      expect(replayedAndLive).toEqual(
        stored.filter((event) => event.seq > lastSeen).map((event) => event.seq)
      );
      expect([...first.frames, ...second.frames].map((frame) => frame.id)).toEqual(
        stored.map((_event, index) => index + 1)
      );
      expect(second.frames.map((frame) => frame.event)).toEqual([
        "delta",
        "delta",
        "delta",
        "message.created",
        "turn.finished",
      ]);
      expect(deltaText([...first.frames, ...second.frames])).toBe("Hello world");
      const answer = second.frames.find((frame) => frame.event === "message.created");
      expect(answer?.data.payload).toMatchObject({
        message: {parts: [{text: "Hello world", type: "text"}], role: "assistant", seq: 2},
      });
      const finished = second.frames.at(-1);
      expect(finished?.data.payload).toMatchObject({
        outcome: {
          result: {finishReason: "stop", steps: 1, text: "Hello world"},
          status: "completed",
        },
        status: "completed",
        turnTaskId: submitted.body.data.turnTaskId,
      });
    });

    it("resumes from ?after= when no Last-Event-ID header is sent", async () => {
      const gated = gatedStreamingModel();
      const harness = await openHarness({model: gated.model, registry: [agent], start: true});
      const {app, url} = await serve(harness);
      const token = await tokenFor(app, OWNER.email, OWNER.password);
      const conversation = await harness.createConversation({agent, userId: ownerId});
      await conversation.submit({content: "Hi", requestId: "r1"});
      const request = await gated.nextRequest();
      request.text("Hey");
      request.finish();
      await waitUntil(
        async () =>
          (await ConversationModel.findExactlyOne({_id: conversation.id})).status === "idle",
        "turn finished"
      );

      const client = await sse(
        `${url}/harness/conversations/${conversation.id}/events?after=2`,
        token
      );
      await client.waitFor((frame) => frame.event === "turn.finished");
      expect(client.frames.map((frame) => [frame.id, frame.event])).toEqual([
        [3, "delta"],
        [4, "message.created"],
        [5, "turn.finished"],
      ]);
      // Last-Event-ID wins over ?after= (a browser resends it on reconnect).
      const resumed = await sse(
        `${url}/harness/conversations/${conversation.id}/events?after=0`,
        token,
        {"Last-Event-ID": "4"}
      );
      await resumed.waitFor((frame) => frame.event === "turn.finished");
      expect(resumed.frames.map((frame) => frame.id)).toEqual([5]);
    });

    it("pages a long replay and delivers writes racing it exactly once", async () => {
      const harness = await openHarness({registry: [agent], start: false});
      const {app, url} = await serve(harness);
      const token = await tokenFor(app, OWNER.email, OWNER.password);
      const conversation = await harness.createConversation({agent, userId: ownerId});
      const models = {event: EventModel, eventStream: EventStreamModel} as unknown as HarnessModels;
      const write = (count: number, label: string) =>
        appendEvents({
          events: Array.from({length: count}, (_value, index) => ({
            payload: {text: `${label}${index}`},
            type: "output" as const,
          })),
          models,
          streamId: conversation.id,
        });
      await write(1200, "old");

      // A writer keeps appending while the client connects and pages through the replay,
      // so events land in both the replay and the change-stream buffer.
      let isWriting = true;
      let written = 1200;
      const writer = (async () => {
        while (isWriting) {
          await write(1, "race");
          written += 1;
          await pause(2);
        }
      })();
      const client = await sse(`${url}/harness/conversations/${conversation.id}/events`, token);
      await client.waitFor((frame) => frame.id > 1210);
      isWriting = false;
      await writer;
      await client.waitFor((frame) => frame.id === written);
      await pause(50);
      expect(written).toBeGreaterThan(1210);
      expect(client.frames.map((frame) => frame.id)).toEqual(
        Array.from({length: written}, (_value, index) => index + 1)
      );
    });

    it("rejects a heartbeat interval that is not positive", () => {
      const app = new TerrenoApp({skipListen: true, userModel: UserModel});
      expect(() =>
        app
          .register(new HarnessApp({harness: {} as Harness, heartbeatInterval: {seconds: 0}}))
          .build()
      ).toThrow(
        harnessErrorMatching("configInvalid", "HarnessApp heartbeatInterval must be positive")
      );
    });

    it("sends heartbeat comments while the stream is idle", async () => {
      const harness = await openHarness({registry: [agent], start: false});
      const {app, url} = await serve(harness);
      const token = await tokenFor(app, OWNER.email, OWNER.password);
      const conversation = await harness.createConversation({agent, userId: ownerId});
      const client = await sse(`${url}/harness/conversations/${conversation.id}/events`, token);
      await waitUntil(async () => client.comments.includes("heartbeat"), "heartbeat");
      expect(client.frames).toEqual([]);
    });
  });

  describe("connections", () => {
    it("share one change stream per app and release it when the last client leaves", async () => {
      const harness = await openHarness({registry: [agent], start: false});
      const {app, plugin, url} = await serve(harness);
      const token = await tokenFor(app, OWNER.email, OWNER.password);
      const conversation = await harness.createConversation({agent, userId: ownerId});
      // Earlier tests' streams close asynchronously; start from none.
      await waitUntil(async () => (await openChangeStreams()) === 0, "no cursors yet");
      const base = 0;
      const clients = await Promise.all(
        Array.from({length: 5}, () =>
          sse(`${url}/harness/conversations/${conversation.id}/events`, token)
        )
      );
      expect(plugin.eventHub.openStreams).toBe(1);
      await waitUntil(async () => (await openChangeStreams()) === base + 1, "one shared cursor");
      for (const client of clients) {
        client.close();
      }
      await waitUntil(async () => plugin.eventHub.openStreams === 0, "hub closed");
      await waitUntil(async () => (await openChangeStreams()) === base, "cursor released");
    });

    it("leaves nothing open when clients disconnect before the stream starts", async () => {
      const harness = await openHarness({registry: [agent], start: false});
      const {app, plugin, url} = await serve(harness);
      const token = await tokenFor(app, OWNER.email, OWNER.password);
      const conversation = await harness.createConversation({agent, userId: ownerId});
      // Earlier tests' streams close asynchronously; start from none.
      await waitUntil(async () => (await openChangeStreams()) === 0, "no cursors yet");
      const base = 0;
      const port = Number(new URL(url).port);
      for (let i = 0; i < 20; i++) {
        await new Promise<void>((resolve) => {
          const socket = net.connect(port, "127.0.0.1", () => {
            socket.write(
              `GET /harness/conversations/${conversation.id}/events HTTP/1.1\r\nHost: x\r\nAuthorization: ${token}\r\n\r\n`
            );
            // Gone during auth, the lookups, or the replay.
            setTimeout(() => {
              socket.destroy();
              resolve();
            }, i % 4);
          });
          socket.on("error", () => resolve());
        });
      }
      await pause(500);
      await waitUntil(async () => plugin.eventHub.openStreams === 0, "hub closed");
      await waitUntil(async () => (await openChangeStreams()) === base, "no cursors left");
      // The app still serves streams afterwards.
      const client = await sse(`${url}/harness/conversations/${conversation.id}/events`, token);
      await waitUntil(async () => client.comments.includes("heartbeat"), "heartbeat");
    });
    // After the cursor-counting tests: closing the cursor mid-read leaves a server cursor
    // that only times out.
    it("ends every stream when the shared tail fails, and serves again on reconnect", async () => {
      const harness = await openHarness({registry: [agent], start: false});
      const {app, plugin, url} = await serve(harness);
      const token = await tokenFor(app, OWNER.email, OWNER.password);
      const conversation = await harness.createConversation({agent, userId: ownerId});
      const response = await fetch(`${url}/harness/conversations/${conversation.id}/events`, {
        headers: {authorization: token},
      });
      await waitUntil(async () => plugin.eventHub.openStreams === 1, "tail open");
      // The tail's cursor goes away underneath it, as on a failover or an invalidate.
      const tail = (plugin.eventHub as unknown as {changes: {close: () => Promise<void>}}).changes;
      await tail.close();
      expect(await response.text()).not.toContain("event:");
      expect(plugin.eventHub.openStreams).toBe(0);

      const client = await sse(`${url}/harness/conversations/${conversation.id}/events`, token);
      await appendEvents({
        events: [{payload: {text: "back"}, type: "output"}],
        models: {event: EventModel, eventStream: EventStreamModel} as unknown as HarnessModels,
        streamId: conversation.id,
      });
      await client.waitFor((frame) => frame.event === "output");
    });
  });

  describe("access", () => {
    it("requires a login, and the owner or an admin", async () => {
      const harness = await openHarness({registry: [agent], start: false});
      const {app, url} = await serve(harness);
      const conversation = await harness.createConversation({agent, userId: ownerId});
      const path = `${url}/harness/conversations/${conversation.id}/events`;

      expect((await refused(path)).status).toBe(401);
      const other = await tokenFor(app, OTHER.email, OTHER.password);
      const forbidden = await refused(path, {authorization: other});
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.title).toBe("Only the owner or an admin may read this event stream");
      expect(
        (
          await refused(`${url}/harness/conversations/507f1f77bcf86cd799439011/events`, {
            authorization: other,
          })
        ).status
      ).toBe(404);
      expect(
        (await refused(`${url}/harness/conversations/not-an-id/events`, {authorization: other}))
          .status
      ).toBe(404);
      const owner = await tokenFor(app, OWNER.email, OWNER.password);
      const badId = await refused(path, {authorization: owner, "Last-Event-ID": "abc"});
      expect(badId.status).toBe(400);
      expect((await refused(`${path}?after=-1`, {authorization: owner})).status).toBe(400);

      // Owner and admin both get a stream.
      await sse(path, owner);
      await sse(path, await tokenFor(app, ADMIN.email, ADMIN.password));
    });
  });

  describe("task streams", () => {
    it("carry status, output, and approval events of the task and its descendants", async () => {
      const child = defineTask<{n: number}, unknown, string>({
        initial: () => ({phase: "work"}),
        name: "test.child",
        phases: {
          work: {
            replay: "safe",
            run: async (task, rt) => {
              await rt.output(`child ${task.input.n} working`);
              const decision = await rt.approval("go", {title: "Go ahead?"});
              await rt.commit({terminal: {result: String(decision.approved), status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const parent = defineTask<Record<string, never>, unknown, string>({
        initial: () => ({phase: "spawn"}),
        name: "test.parent",
        phases: {
          spawn: {
            replay: "safe",
            run: async (_task, rt) => {
              await rt.output("parent starting");
              const id = await rt.createTask(child, {n: 1});
              const [outcome] = await rt.waitForTasks([id]);
              await rt.commit({terminal: {result: String(outcome?.result), status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness({
        registry: [parent, child] as unknown as AnyHarnessTaskDefinition[],
        start: true,
      });
      const {app, url} = await serve(harness);
      const owner = await tokenFor(app, OWNER.email, OWNER.password);
      const created = await harness.createTask(parent, {}, {userId: ownerId});
      const parentStream = await sse(`${url}/harness/tasks/${created._id}/events`, owner);
      await waitUntil(async () => (await ApprovalModel.countDocuments({})) === 1, "approval");
      const approval = (await ApprovalModel.find({}).lean())[0];
      const childId = String(approval?.taskId);
      const childStream = await sse(`${url}/harness/tasks/${childId}/events`, owner);
      await childStream.waitFor((frame) => frame.event === "approval.requested");

      await harness.decideApproval(approval?._id as never, {approved: true});
      await parentStream.waitFor(
        (frame) =>
          frame.event === "task.status" &&
          frame.data.taskId === String(created._id) &&
          (frame.data.payload as {status: string}).status === "completed"
      );
      await childStream.waitFor(
        (frame) =>
          frame.event === "task.status" &&
          (frame.data.payload as {status: string}).status === "completed"
      );

      const describe = (frame: SseFrame): string => {
        const payload = frame.data.payload as {status?: string; text?: string};
        const who = frame.data.taskId === String(created._id) ? "parent" : "child";
        return `${who} ${frame.event} ${payload.status ?? payload.text ?? ""}`.trim();
      };
      expect(parentStream.frames.map(describe)).toEqual([
        "parent task.status pending",
        "parent output parent starting",
        "child task.status pending",
        "parent task.status waiting",
        "child output child 1 working",
        "child approval.requested pending",
        "child task.status waiting",
        "child approval.decided approved",
        // Each phase re-runs after its wait, so its output is sent again.
        "child output child 1 working",
        "child task.status completed",
        "parent output parent starting",
        "parent task.status completed",
      ]);
      // The child's stream is the same log narrowed to the child: no parent events.
      expect(childStream.frames.map(describe)).toEqual(
        parentStream.frames.map(describe).filter((line) => line.startsWith("child"))
      );
      expect(childStream.frames.map((frame) => frame.id)).toEqual(
        parentStream.frames
          .filter((frame) => frame.data.taskId === childId)
          .map((frame) => frame.id)
      );

      const other = await tokenFor(app, OTHER.email, OTHER.password);
      expect(
        (await refused(`${url}/harness/tasks/${childId}/events`, {authorization: other})).status
      ).toBe(403);
      expect((await refused(`${url}/harness/tasks/${childId}/events`)).status).toBe(401);
      await sse(
        `${url}/harness/tasks/${childId}/events`,
        await tokenFor(app, ADMIN.email, ADMIN.password)
      );
    });
  });

  describe("deltas", () => {
    const models = (): HarnessModels =>
      ({event: EventModel, eventStream: EventStreamModel}) as unknown as HarnessModels;
    const source = {
      conversationId: "507f1f77bcf86cd799439011",
      requestKey: "k1",
      step: 1,
      turnTaskId: "507f1f77bcf86cd799439012",
    };

    it("coalesce by size and by time, and expire", async () => {
      const writer = new HarnessDeltaWriter({
        models: models(),
        options: resolveStreamingOptions({
          deltaFlushChars: 6,
          deltaFlushInterval: {milliseconds: 500},
          deltaTtl: {minutes: 5},
        }),
        source,
      });
      writer.push("ab");
      writer.push("cd");
      await pause(10);
      expect(await EventModel.countDocuments({})).toBe(0);
      // Reaching deltaFlushChars writes at once.
      writer.push("ef");
      await waitUntil(async () => (await EventModel.countDocuments({})) === 1, "size flush");
      // Below the size, the interval writes it.
      writer.push("g");
      await waitUntil(async () => (await EventModel.countDocuments({})) === 2, "time flush");
      writer.push("h");
      await writer.close();

      const rows = await storedEvents(source.conversationId);
      expect(rows.map((row) => [row.seq, row.type, (row.payload as {text: string}).text])).toEqual([
        [1, "delta", "abcdef"],
        [2, "delta", "g"],
        [3, "delta", "h"],
      ]);
      for (const row of rows) {
        expect(row.payload).toMatchObject({
          requestKey: "k1",
          step: 1,
          turnTaskId: source.turnTaskId,
        });
        const ttl = DateTime.fromJSDate(row.expiresAt as Date).diff(
          DateTime.fromJSDate(row.created)
        );
        expect(Math.round(ttl.as("minutes"))).toBe(5);
      }
      const indexes = await EventModel.collection.indexes();
      expect(indexes.find((index) => index.key.expiresAt === 1)?.expireAfterSeconds).toBe(0);
    });

    it("keeps a failed attempt's deltas under their own requestKey; the message holds only the retry", async () => {
      const gated = gatedStreamingModel();
      const harness = await openHarness({model: gated.model, registry: [agent], start: true});
      const conversation = await harness.createConversation({agent, userId: ownerId});
      const turn = await conversation.submit({content: "Go", requestId: "r1"});
      const first = await gated.nextRequest();
      first.text("Stale");
      await waitUntil(
        async () => (await EventModel.countDocuments({type: "delta"})) === 1,
        "first delta"
      );
      first.fail(
        new APICallError({
          isRetryable: true,
          message: "HTTP 503",
          requestBodyValues: {},
          statusCode: 503,
          url: "https://mock.invalid/v1/chat",
        })
      );
      const retry = await gated.nextRequest();
      retry.text("Fresh");
      retry.finish();
      await harness.waitForTask(turn._id, {timeout: {seconds: 10}});

      const rows = await storedEvents(conversation.id);
      const deltas = rows
        .filter((row) => row.type === "delta")
        .map((row) => row.payload as {requestKey: string; step: number; text: string});
      expect(deltas.map(({step, text}) => [step, text])).toEqual([
        [1, "Stale"],
        [1, "Fresh"],
      ]);
      expect(deltas[0]?.requestKey).not.toBe(deltas[1]?.requestKey);
      const answer = rows.filter((row) => row.type === "message.created").at(-1);
      expect(answer?.payload).toMatchObject({
        message: {parts: [{text: "Fresh", type: "text"}], role: "assistant"},
      });
    });

    it("persists a streamed turn as coalesced deltas; committed events never expire", async () => {
      const gated = gatedStreamingModel();
      const harness = await openHarness({
        model: gated.model,
        registry: [agent],
        start: true,
        streaming: {deltaFlushChars: 1000, deltaFlushInterval: {seconds: 10}},
      });
      const conversation = await harness.createConversation({agent, userId: ownerId});
      const turn = await conversation.submit({content: "Count", requestId: "r1"});
      const request = await gated.nextRequest();
      for (const chunk of ["one ", "two ", "three"]) {
        request.text(chunk);
      }
      request.finish();
      await harness.waitForTask(turn._id, {timeout: {seconds: 10}});

      const rows = await storedEvents(conversation.id);
      expect(rows.map((row) => row.type)).toEqual([
        "message.created",
        "turn.started",
        "delta",
        "message.created",
        "turn.finished",
      ]);
      // One delta: the stream ended before the interval, and close() flushed it.
      expect(rows[2]?.payload).toMatchObject({
        step: 1,
        text: "one two three",
        turnTaskId: String(turn._id),
      });
      expect(rows[2]?.expiresAt).toBeInstanceOf(Date);
      expect(
        rows.filter((row) => row.type !== "delta").every((row) => row.expiresAt === undefined)
      ).toBe(true);
    });

    it("rejects invalid streaming options", () => {
      expect(() => resolveStreamingOptions({deltaFlushChars: 0})).toThrow(
        harnessErrorMatching("configInvalid", "deltaFlushChars must be a positive integer")
      );
      expect(() => resolveStreamingOptions({deltaTtl: {seconds: 0}})).toThrow(
        harnessErrorMatching("configInvalid", "must be positive")
      );
    });
  });
});
