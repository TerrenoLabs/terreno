import {afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout} from "bun:test";
import {TerrenoApp, z} from "@terreno/api";
import type {LanguageModel} from "ai";
import type express from "express";
import {DateTime} from "luxon";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {createLocalObservabilityPlugin} from "../../observability/local/localPlugin";
import {registerObsSpan} from "../../observability/local/models/obsSpan";
import {registerObsTrace} from "../../observability/local/models/obsTrace";
import {gatedStreamingModel} from "../../tests/harnessStreaming";
import {ensureTestUsers, UserModel} from "../../tests/helpers";
import type {ObsSpanModel, ObsTraceModel} from "../../types/observability";
import {defineAgent, defineTool, Harness, HarnessApp, InProcessRunner} from "../harness";
import {registerHarnessConversation} from "../models/harnessConversation";
import {registerHarnessEvent, registerHarnessEventStream} from "../models/harnessEvent";
import {registerHarnessMessage} from "../models/harnessMessage";
import {registerHarnessOwner} from "../models/harnessOwner";
import {registerHarnessTask} from "../models/harnessTask";

setDefaultTimeout(30_000);

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
const ConversationModel = registerHarnessConversation();
const MessageModel = registerHarnessMessage();
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

/** A tool the test releases: the turn sits in its `tools` phase until then. */
const toolGate = () => {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  const tool = defineTool({
    description: "Wait for the test",
    execute: async () => {
      started = true;
      await released;
      return {ok: true};
    },
    name: "hold",
    parameters: z.object({}),
  });
  return {isStarted: () => started, release, tool};
};

const openHarnesses: Harness[] = [];
const openGates: Array<() => void> = [];

const setup = async () => {
  const gated = gatedStreamingModel();
  const gate = toolGate();
  openGates.push(gate.release);
  const agent = defineAgent({
    instructions: "Answer briefly.",
    model: {modelId: "gated-model", provider: "mock"},
    modelRetry: {backoffMs: 1, maxBackoffMs: 2},
    name: "test.chat",
    tools: [gate.tool],
  });
  const harness = await Harness.open({
    models: () => gated.model as unknown as LanguageModel,
    registry: [agent],
    runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
    testHooks: {random: () => 0},
  });
  openHarnesses.push(harness);
  await harness.start();
  const app: express.Application = new TerrenoApp({skipListen: true, userModel: UserModel})
    .register(new HarnessApp({harness}))
    .build();
  const login = async ({email, password}: {email: string; password: string}) => {
    const agentClient = supertest.agent(app);
    const res = await agentClient.post("/auth/login").send({email, password}).expect(200);
    agentClient.set("authorization", `Bearer ${res.body.data.token}`);
    return agentClient as unknown as TestAgent;
  };
  const ownerId = String((await UserModel.find({email: OWNER.email}).lean())[0]?._id);
  const conversation = await harness.createConversation({agent, userId: ownerId});
  return {agent, app, conversation, gate, gated, harness, login, ownerId};
};

const transcript = async (conversationId: string) =>
  (await MessageModel.find({conversationId}).sort({seq: 1}).lean()).map((message) => {
    const part = message.parts[0] as {text?: string; toolName?: string; type: string};
    return `${message.seq} ${message.role} ${part.text ?? part.toolName ?? part.type}`;
  });

const conversationStatus = async (id: string) =>
  (await ConversationModel.findExactlyOne({_id: id})).status;

describe("Harness conversation routes", () => {
  beforeAll(async () => {
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
    await ensureTestUsers([OWNER, OTHER, ADMIN]);
  });

  beforeEach(async () => {
    await Promise.all(
      [
        TaskModel,
        OwnerModel,
        ConversationModel,
        MessageModel,
        EventModel,
        EventStreamModel,
        SpanModel,
        TraceModel,
      ].map((model) => (model as {deleteMany: (filter: object) => Promise<unknown>}).deleteMany({}))
    );
  });

  afterEach(async () => {
    // A failed test must not leave a tool hanging while the harness stops.
    for (const release of openGates.splice(0)) {
      release();
    }
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
  });

  it("reads for the owner or an admin, and lists only your own conversations", async () => {
    const {agent, app, conversation, harness, login} = await setup();
    const adminId = String((await UserModel.find({email: ADMIN.email}).lean())[0]?._id);
    const adminOwn = await harness.createConversation({agent, userId: adminId});
    const owner = await login(OWNER);
    const admin = await login(ADMIN);
    const other = await login(OTHER);

    const read = await owner.get(`/harness/conversations/${conversation.id}`).expect(200);
    expect(read.body.data.agent.name).toBe("test.chat");
    await admin.get(`/harness/conversations/${conversation.id}`).expect(200);
    await other.get(`/harness/conversations/${conversation.id}`).expect(403);
    await supertest(app).get(`/harness/conversations/${conversation.id}`).expect(401);

    const ownList = await owner.get("/harness/conversations").expect(200);
    expect(ownList.body.data.map((row: {_id: string}) => row._id)).toEqual([conversation.id]);
    const adminList = await admin.get("/harness/conversations").expect(200);
    expect(adminList.body.data.map((row: {_id: string}) => row._id)).toEqual([adminOwn.id]);
    expect((await other.get("/harness/conversations").expect(200)).body.data).toEqual([]);
    await owner.post("/harness/conversations").send({}).expect(405);
  });

  it("submit refuses a subagent conversation with 409", async () => {
    const {conversation, login} = await setup();
    await ConversationModel.updateOne(
      {_id: conversation.id},
      {$set: {ownership: {id: conversation.document._id, kind: "task"}}}
    );
    const refused = await (await login(OWNER))
      .post(`/harness/conversations/${conversation.id}/submit`)
      .send({content: "Hi", requestId: "r1"})
      .expect(409);
    expect(refused.body.title).toBe("Conversation is run by its owning task");
    expect(await MessageModel.countDocuments({conversationId: conversation.id})).toBe(0);
  });

  it("submit starts a turn, is idempotent on requestId, and is the owner's alone", async () => {
    const {app, conversation, gated, login} = await setup();
    const owner = await login(OWNER);
    const path = `/harness/conversations/${conversation.id}/submit`;

    await supertest(app).post(path).send({content: "Hi", requestId: "r1"}).expect(401);
    await (await login(OTHER)).post(path).send({content: "Hi", requestId: "r1"}).expect(403);
    // Messages are sent as the conversation's user, so an admin cannot submit either.
    await (await login(ADMIN)).post(path).send({content: "Hi", requestId: "r1"}).expect(403);
    await owner.post(path).send({content: "", requestId: "r1"}).expect(400);
    await owner.post(path).send({content: "Hi", requestId: "r1", whenBusy: "later"}).expect(400);
    await owner.post(path).send({content: "Hi"}).expect(400);

    const started = await owner.post(path).send({content: "Hi", requestId: "r1"}).expect(200);
    expect(started.body.data).toEqual({
      conversationId: conversation.id,
      disposition: "started",
      requestId: "r1",
      turnTaskId: started.body.data.turnTaskId,
    });
    // A retry racing the first request gets the same answer and adds nothing.
    const raced = await Promise.all([
      owner.post(path).send({content: "Hi", requestId: "r1"}),
      owner.post(path).send({content: "Hi", requestId: "r1"}),
    ]);
    expect(raced.map((res) => res.body.data)).toEqual([started.body.data, started.body.data]);
    const repeat = await owner.post(path).send({content: "Hi again", requestId: "r1"}).expect(200);
    expect(repeat.body.data).toEqual(started.body.data);
    expect(await transcript(conversation.id)).toEqual(["1 user Hi"]);
    expect(await TaskModel.countDocuments({name: "terreno.agent.turn"})).toBe(1);

    const request = await gated.nextRequest();
    request.text("Hello");
    request.finish();
    await waitUntil(async () => (await conversationStatus(conversation.id)) === "idle", "idle");
    const afterTurn = await owner.post(path).send({content: "Hi", requestId: "r1"}).expect(200);
    expect(afterTurn.body.data).toEqual(started.body.data);
    expect(await transcript(conversation.id)).toEqual(["1 user Hi", "2 assistant Hello"]);
  });

  it("queue: runs each queued message as its own turn after the active one, in order", async () => {
    const {conversation, gated, login} = await setup();
    const owner = await login(OWNER);
    const path = `/harness/conversations/${conversation.id}/submit`;
    const first = await owner.post(path).send({content: "One", requestId: "r1"}).expect(200);
    const firstRequest = await gated.nextRequest();

    // whenBusy defaults to queue.
    const queued = await owner.post(path).send({content: "Two", requestId: "r2"}).expect(200);
    expect(queued.body.data).toEqual({
      conversationId: conversation.id,
      disposition: "queued",
      requestId: "r2",
    });
    const third = await owner
      .post(path)
      .send({content: "Three", requestId: "r3", whenBusy: "queue"})
      .expect(200);
    expect(third.body.data.disposition).toBe("queued");
    const repeats = await Promise.all([
      owner.post(path).send({content: "Two", requestId: "r2"}),
      owner.post(path).send({content: "Two", requestId: "r2", whenBusy: "queue"}),
    ]);
    expect(repeats.map((res) => res.body.data)).toEqual([queued.body.data, queued.body.data]);
    expect(
      (await ConversationModel.findExactlyOne({_id: conversation.id})).queued.map(
        (entry) => entry.requestId
      )
    ).toEqual(["r2", "r3"]);
    const announced = await EventModel.find({streamId: conversation.id, type: "message.queued"})
      .sort({seq: 1})
      .lean();
    expect(announced.map((event) => event.payload)).toEqual([
      {content: "Two", requestId: "r2", whenBusy: "queue"},
      {content: "Three", requestId: "r3", whenBusy: "queue"},
    ]);

    firstRequest.text("A1");
    firstRequest.finish();
    const secondRequest = await gated.nextRequest();
    // The queued message is the newest user message of the next turn.
    expect(secondRequest.prompt.at(-1)).toMatchObject({content: [{text: "Two"}], role: "user"});
    const started = await owner.post(path).send({content: "Two", requestId: "r2"}).expect(200);
    expect(started.body.data.disposition).toBe("started");
    expect(started.body.data.turnTaskId).not.toBe(first.body.data.turnTaskId);
    secondRequest.text("A2");
    secondRequest.finish();
    const thirdRequest = await gated.nextRequest();
    thirdRequest.text("A3");
    thirdRequest.finish();
    await waitUntil(async () => (await conversationStatus(conversation.id)) === "idle", "drained");

    expect(await transcript(conversation.id)).toEqual([
      "1 user One",
      "2 assistant A1",
      "3 user Two",
      "4 assistant A2",
      "5 user Three",
      "6 assistant A3",
    ]);
    expect((await ConversationModel.findExactlyOne({_id: conversation.id})).queued).toHaveLength(0);
    expect(await TaskModel.countDocuments({name: "terreno.agent.turn", status: "completed"})).toBe(
      3
    );
  });

  it("a queued message stranded by a crash after its turn ended runs once after restart", async () => {
    const {agent, conversation, gated, harness} = await setup();
    const first = await conversation.submit({content: "One", requestId: "r1"});
    const firstRequest = await gated.nextRequest();
    firstRequest.text("A1");
    firstRequest.finish();
    await harness.waitForTask(first._id, {timeout: {seconds: 10}});
    await harness.stop();
    // The process died after the turn's terminal commit (which set the conversation
    // idle) and before it started the submission queued during that turn.
    await ConversationModel.updateOne(
      {_id: conversation.id},
      {
        $push: {
          queued: {
            content: "Two",
            requestId: "r2",
            submittedAt: DateTime.now().toJSDate(),
            whenBusy: "queue",
          },
        },
      }
    );
    expect(await conversationStatus(conversation.id)).toBe("idle");

    const restarted = gatedStreamingModel();
    const next = await Harness.open({
      models: () => restarted.model as unknown as LanguageModel,
      registry: [agent],
      runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
    });
    openHarnesses.push(next);
    await next.start();
    const request = await restarted.nextRequest();
    expect(request.prompt.at(-1)).toMatchObject({content: [{text: "Two"}], role: "user"});
    request.text("A2");
    request.finish();
    await waitUntil(async () => (await conversationStatus(conversation.id)) === "idle", "idle");
    // Another sweep interval passes without a second start.
    await pause(1500);
    expect(await transcript(conversation.id)).toEqual([
      "1 user One",
      "2 assistant A1",
      "3 user Two",
      "4 assistant A2",
    ]);
    expect(await TaskModel.countDocuments({name: "terreno.agent.turn"})).toBe(2);
    expect(restarted.received).toHaveLength(1);
    expect((await ConversationModel.findExactlyOne({_id: conversation.id})).queued).toHaveLength(0);
  });

  it("a conversation left busy on a finished turn is freed, and its queue runs, after restart", async () => {
    const {agent, conversation, harness, ownerId} = await setup();
    await harness.stop();
    const emptyQueue = await harness.createConversation({agent, userId: ownerId});
    const stuck = [
      await conversation.submit({content: "One", requestId: "r1"}),
      await emptyQueue.submit({content: "Solo", requestId: "s1"}),
    ];
    // Each turn ended, but its conversation was never freed (state from a write that was
    // lost), and one of them has a submission waiting.
    await TaskModel.updateMany(
      {_id: {$in: stuck.map((turn) => turn._id)}},
      {$set: {outcome: {error: "Stopped", status: "aborted"}, status: "aborted"}}
    );
    await ConversationModel.updateOne(
      {_id: conversation.id},
      {
        $push: {
          queued: {
            content: "Two",
            requestId: "r2",
            submittedAt: DateTime.now().toJSDate(),
            whenBusy: "queue",
          },
        },
      }
    );
    expect(await conversationStatus(conversation.id)).toBe("busy");
    expect(await conversationStatus(emptyQueue.id)).toBe("busy");

    const restarted = gatedStreamingModel();
    const next = await Harness.open({
      models: () => restarted.model as unknown as LanguageModel,
      registry: [agent],
      runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
    });
    openHarnesses.push(next);
    await next.start();
    const request = await restarted.nextRequest();
    expect(request.prompt.at(-1)).toMatchObject({content: [{text: "Two"}], role: "user"});
    request.text("A2");
    request.finish();
    await waitUntil(async () => (await conversationStatus(conversation.id)) === "idle", "idle");
    await waitUntil(async () => (await conversationStatus(emptyQueue.id)) === "idle", "freed");
    expect(await transcript(conversation.id)).toEqual([
      "1 user One",
      "2 user Two",
      "3 assistant A2",
    ]);
    expect(restarted.received).toHaveLength(1);
  });

  it("an aborted turn frees its conversation in the abort commit and starts the queue", async () => {
    const {conversation, gated, login} = await setup();
    const owner = await login(OWNER);
    const path = `/harness/conversations/${conversation.id}/submit`;
    const first = await owner.post(path).send({content: "One", requestId: "r1"}).expect(200);
    await gated.nextRequest();
    await owner.post(path).send({content: "Two", requestId: "r2"}).expect(200);
    await owner
      .post(`/harness/tasks/${first.body.data.turnTaskId}/abort`)
      .send({reason: "Changed my mind"})
      .expect(200);
    const second = await gated.nextRequest();
    expect(second.prompt.at(-1)).toMatchObject({content: [{text: "Two"}], role: "user"});
    second.text("A2");
    second.finish();
    await waitUntil(async () => (await conversationStatus(conversation.id)) === "idle", "idle");
    expect(await transcript(conversation.id)).toEqual([
      "1 user One",
      "2 user Two",
      "3 assistant A2",
    ]);
  });

  it("steer: the active turn's next model request includes the message", async () => {
    const {conversation, gate, gated, login} = await setup();
    const owner = await login(OWNER);
    const path = `/harness/conversations/${conversation.id}/submit`;
    const started = await owner.post(path).send({content: "Check it", requestId: "r1"}).expect(200);
    const firstRequest = await gated.nextRequest();
    firstRequest.finish({toolCalls: [{id: "call-1", name: "hold"}]});
    await waitUntil(async () => gate.isStarted(), "tool running");

    const steered = await owner
      .post(path)
      .send({content: "Also check the labs", requestId: "r2", whenBusy: "steer"})
      .expect(200);
    expect(steered.body.data).toEqual({
      conversationId: conversation.id,
      disposition: "steered",
      requestId: "r2",
      turnTaskId: started.body.data.turnTaskId,
    });
    gate.release();
    const secondRequest = await gated.nextRequest();
    // After the tool result, the steering message joins this request.
    expect(secondRequest.prompt.slice(-2).map((message) => message.role)).toEqual(["tool", "user"]);
    expect(secondRequest.prompt.at(-1)).toMatchObject({content: [{text: "Also check the labs"}]});
    secondRequest.text("Done, labs too");
    secondRequest.finish();
    await waitUntil(async () => (await conversationStatus(conversation.id)) === "idle", "idle");

    expect(await transcript(conversation.id)).toEqual([
      "1 user Check it",
      "2 assistant hold",
      "3 tool hold",
      "4 user Also check the labs",
      "5 assistant Done, labs too",
    ]);
    const toolEvents = await EventModel.find({
      streamId: conversation.id,
      type: {$in: ["tool.started", "tool.finished"]},
    })
      .sort({seq: 1})
      .lean();
    expect(toolEvents.map((event) => [event.type, event.payload])).toEqual([
      [
        "tool.started",
        expect.objectContaining({
          status: "pending",
          toolCallId: "call-1",
          toolName: "hold",
          turnTaskId: started.body.data.turnTaskId,
        }),
      ],
      [
        "tool.finished",
        expect.objectContaining({
          outcome: expect.objectContaining({status: "completed"}),
          status: "completed",
          toolCallId: "call-1",
          turnTaskId: started.body.data.turnTaskId,
        }),
      ],
    ]);
    const steerMessage = await MessageModel.findExactlyOne({
      conversationId: conversation.id,
      requestId: "r2",
    });
    expect(String(steerMessage.turnTaskId)).toBe(started.body.data.turnTaskId);
    expect(await TaskModel.countDocuments({name: "terreno.agent.turn"})).toBe(1);
    const repeat = await owner
      .post(path)
      .send({content: "Also check the labs", requestId: "r2", whenBusy: "steer"})
      .expect(200);
    expect(repeat.body.data).toEqual(steered.body.data);
  });

  it("steer that arrives after the turn's last model request runs as the next turn", async () => {
    const {conversation, gated, login} = await setup();
    const owner = await login(OWNER);
    const path = `/harness/conversations/${conversation.id}/submit`;
    await owner.post(path).send({content: "Hi", requestId: "r1"}).expect(200);
    const firstRequest = await gated.nextRequest();
    const steered = await owner
      .post(path)
      .send({content: "Too late", requestId: "r2", whenBusy: "steer"})
      .expect(200);
    expect(steered.body.data.disposition).toBe("steered");
    firstRequest.text("Hello");
    firstRequest.finish();

    const next = await gated.nextRequest();
    expect(next.prompt.at(-1)).toMatchObject({content: [{text: "Too late"}], role: "user"});
    next.text("Sure");
    next.finish();
    await waitUntil(async () => (await conversationStatus(conversation.id)) === "idle", "idle");
    expect(await transcript(conversation.id)).toEqual([
      "1 user Hi",
      "2 assistant Hello",
      "3 user Too late",
      "4 assistant Sure",
    ]);
    const repeat = await owner
      .post(path)
      .send({content: "Too late", requestId: "r2", whenBusy: "steer"})
      .expect(200);
    expect(repeat.body.data.disposition).toBe("started");
  });
});
