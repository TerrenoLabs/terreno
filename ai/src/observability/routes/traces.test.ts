import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  createAccess,
  setupAuth,
  TerrenoApp,
  terrenoStatements,
  type UserModel as UserModelType,
} from "@terreno/api";
import {expectAPIError, getBaseServer} from "@terreno/test";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import request from "supertest";
import {createTraceId} from "../../service/aiService";

import {authAsUser, ensureTestUsers, terrenoUserModel, UserModel} from "../../tests/helpers";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsScore} from "../local/models/obsScore";
import {registerObsSpan} from "../local/models/obsSpan";
import {registerObsTrace} from "../local/models/obsTrace";
import {LocalTraceStore} from "../local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import type {ObservabilityPlugin, ScoreRecord} from "../types";

describe("observability trace routes", () => {
  let app: express.Application;
  let store: LocalTraceStore;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsTrace().deleteMany({});
    await registerObsSpan().deleteMany({});
    await registerObsScore().deleteMany({});
    const plugin = createLocalObservabilityPlugin();
    store =
      plugin.traceSink && "store" in plugin.traceSink
        ? (plugin.traceSink as {store: LocalTraceStore}).store
        : new LocalTraceStore();
    app = new TerrenoApp({skipListen: true, userModel: terrenoUserModel})
      .register(new ObservabilityApp({plugins: [plugin]}))
      .build();
  });

  it("returns nested spans, both prompts, and posted scores", async () => {
    const startedAt = DateTime.utc().toISO() ?? "";
    const exported = await store.exportTrace({
      id: "t1",
      name: "multi",
      prompts: [
        {name: "summarize", version: 1},
        {name: "title", version: 1},
      ],
      sensitive: false,
      spans: [
        {
          durationMs: 20,
          id: "root",
          kind: "CHAIN",
          name: "root",
          startedAt,
          status: "ok",
        },
        {
          durationMs: 5,
          id: "llm",
          kind: "LLM",
          name: "llm",
          parentSpanId: "root",
          startedAt,
          startOffsetMs: 3,
          status: "ok",
          usage: {inputTokens: 2, model: "unpriced", outputTokens: 3},
        },
      ],
      startedAt,
      status: "ok",
    });
    const agent = await authAsUser(app, "admin");
    const detail = await agent.get(`/ai/observability/traces/${exported.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.prompts).toHaveLength(2);
    expect(detail.body.data.spans[0].children).toHaveLength(1);
    expect("costUsd" in (detail.body.data.spans[0].children[0].usage ?? {})).toBe(false);

    const scored = await agent.post(`/ai/observability/traces/${exported.id}/scores`).send({
      dataType: "numeric",
      name: "quality",
      source: "human",
      value: 4,
    });
    expect(scored.status).toBe(201);

    const listed = await agent.get("/ai/observability/traces?hasScore=true&prompt=summarize");
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((row: {id: string}) => row.id)).toEqual([exported.id]);
    expect(listed.body.more).toBe(false);
    expect(listed.body.page).toBe(1);
    expect(listed.body.total).toBe(1);
  });

  it("filters the trace list by scope", async () => {
    const startedAt = DateTime.utc().toISO() ?? "";
    const base = {name: "scoped", prompts: [], sensitive: false, spans: [], startedAt};
    const inScope = await store.exportTrace({...base, id: "a", status: "ok"});
    await store.exportTrace({...base, id: "b", status: "ok"});
    await registerObsTrace().updateOne({_id: inScope.id}, {scope: "ws-1"});

    const agent = await authAsUser(app, "admin");
    const listed = await agent.get("/ai/observability/traces?scope=ws-1");
    expect(listed.status).toBe(200);
    expect(
      listed.body.data.map((row: {id: string; scope?: string}) => [row.id, row.scope])
    ).toEqual([[inScope.id, "ws-1"]]);
  });

  it("filters the trace list by tag", async () => {
    const startedAt = DateTime.utc().toISO() ?? "";
    const base = {name: "tagged", prompts: [], sensitive: false, spans: [], startedAt};
    const tagged = await store.exportTrace({...base, id: "a", status: "ok"});
    await store.exportTrace({...base, id: "b", status: "ok"});
    await registerObsTrace().updateOne({_id: tagged.id}, {tags: ["model:glm-5.3", "key:shade"]});

    const agent = await authAsUser(app, "admin");
    const listed = await agent.get("/ai/observability/traces?tag=key:shade");
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((row: {id: string; tags: string[]}) => [row.id, row.tags])).toEqual(
      [[tagged.id, ["model:glm-5.3", "key:shade"]]]
    );
  });

  it("sorts the trace list across pages and rejects unknown sort keys", async () => {
    const base = DateTime.utc().minus({hours: 1});
    const exportAt = async (
      name: string,
      offsetMs: number,
      latencyMs: number,
      costUsd: number,
      inputTokens: number
    ): Promise<string> => {
      const exported = await store.exportTrace({
        endedAt: base.plus({milliseconds: offsetMs + latencyMs}).toISO() ?? "",
        id: name,
        name,
        prompts: [{name, version: 1}],
        sensitive: false,
        spans: [],
        startedAt: base.plus({milliseconds: offsetMs}).toISO() ?? "",
        status: "ok",
        usage: {costUsd, inputTokens, outputTokens: 0},
      });
      return exported.id;
    };
    const cheapSlow = await exportAt("cheap-slow", 0, 900, 0.0001, 500);
    const priceyFast = await exportAt("pricey-fast", 1000, 50, 0.05, 20);
    const midMid = await exportAt("mid-mid", 2000, 300, 0.001, 12_345);
    const admin = await authAsUser(app, "admin");

    const pageIds = async (query: string): Promise<string[]> => {
      const first = await admin.get(`/ai/observability/traces?${query}&limit=2&page=1`);
      const second = await admin.get(`/ai/observability/traces?${query}&limit=2&page=2`);
      expect(first.status).toBe(200);
      expect(first.body.more).toBe(true);
      expect(second.body.more).toBe(false);
      return [...first.body.data, ...second.body.data].map((row: {id: string}) => row.id);
    };

    expect(await pageIds("sort=-cost")).toEqual([priceyFast, midMid, cheapSlow]);
    expect(await pageIds("sort=cost")).toEqual([cheapSlow, midMid, priceyFast]);
    expect(await pageIds("sort=-latency")).toEqual([cheapSlow, midMid, priceyFast]);
    expect(await pageIds("sort=latency")).toEqual([priceyFast, midMid, cheapSlow]);
    expect(await pageIds("sort=-tokens")).toEqual([midMid, cheapSlow, priceyFast]);
    expect(await pageIds("sort=tokens")).toEqual([priceyFast, cheapSlow, midMid]);
    expect(await pageIds("sort=startedAt")).toEqual([cheapSlow, priceyFast, midMid]);
    expect(await pageIds("sort=-name")).toEqual([priceyFast, midMid, cheapSlow]);
    // Default stays newest first.
    expect(await pageIds("status=ok")).toEqual([midMid, priceyFast, cheapSlow]);

    const multiPrompt = await admin.get(
      "/ai/observability/traces?prompt[0]=cheap-slow&prompt[1]=mid-mid&sort=name"
    );
    expect(multiPrompt.status).toBe(200);
    expect(multiPrompt.body.data.map((row: {id: string}) => row.id)).toEqual([cheapSlow, midMid]);

    const unknown = await admin.get("/ai/observability/traces?sort=created");
    expect(unknown.status).toBe(400);
    const listSort = await admin.get("/ai/observability/traces?sort[0]=cost");
    expect(listSort.status).toBe(400);
    const objectPrompt = await admin.get("/ai/observability/traces?prompt[name]=x");
    expect(objectPrompt.status).toBe(400);
  });

  it("forbids non-admins from listing traces", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.get("/ai/observability/traces");
    expect(res.status).toBe(403);
  });

  it("validates trace list query params and score payloads", async () => {
    const startedAt = DateTime.utc().toISO() ?? "";
    const exported = await store.exportTrace({
      id: "trace-query",
      name: "query",
      prompts: [{name: "summarize", version: 1}],
      sensitive: false,
      spans: [],
      startedAt,
      status: "ok",
    });
    const admin = await authAsUser(app, "admin");

    const badBoolean = await admin.get("/ai/observability/traces?hasScore=maybe");
    expect(badBoolean.status).toBe(400);

    const badPage = await admin.get("/ai/observability/traces?page=0");
    expect(badPage.status).toBe(400);

    const filtered = await admin.get(
      "/ai/observability/traces?flaggedForDataset=false&limit=5&page=1&status=ok"
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.map((row: {id: string}) => row.id)).toContain(exported.id);

    const v2Trace = await store.exportTrace({
      id: "trace-v2",
      name: "summarize-v2",
      prompts: [{name: "summarize", version: 2}],
      sensitive: false,
      spans: [],
      startedAt,
      status: "ok",
    });
    const v2Only = await admin.get("/ai/observability/traces?prompt=summarize&promptVersion=2");
    expect(v2Only.status).toBe(200);
    expect(v2Only.body.data.map((row: {id: string}) => row.id)).toEqual([v2Trace.id]);
    const v1Only = await admin.get("/ai/observability/traces?prompt=summarize&promptVersion=1");
    expect(v1Only.body.data.map((row: {id: string}) => row.id)).toEqual([exported.id]);

    const missingPrompt = await admin.get("/ai/observability/traces?promptVersion=1");
    expect(missingPrompt.status).toBe(400);
    expect(missingPrompt.body.title).toBe("prompt is required when promptVersion is set");

    const zeroVersion = await admin.get(
      "/ai/observability/traces?prompt=summarize&promptVersion=0"
    );
    expect(zeroVersion.status).toBe(400);

    const fractional = await admin.get(
      "/ai/observability/traces?prompt=summarize&promptVersion=1.5"
    );
    expect(fractional.status).toBe(400);

    const nonInteger = await admin.get(
      "/ai/observability/traces?prompt=summarize&promptVersion=abc"
    );
    expect(nonInteger.status).toBe(400);

    const missingFields = await admin.post(`/ai/observability/traces/${exported.id}/scores`).send({
      name: "quality",
    });
    expect(missingFields.status).toBe(400);
  });
});

describe("POST /ai/observability/traces/:id/feedback", () => {
  let app: express.Application;
  let store: LocalTraceStore;
  let ownerId: string;
  let adminId: string;
  let traceId: string;
  const feedbackPath = (id: string): string => `/ai/observability/traces/${id}/feedback`;

  const exportTraceFor = async (userId: string | undefined): Promise<string> => {
    const id = createTraceId();
    await store.exportTrace({
      id,
      name: "example-summarize",
      prompts: [{name: "example-summarize", version: 1}],
      sensitive: false,
      spans: [],
      startedAt: DateTime.utc().toISO() ?? "",
      status: "ok",
      userId,
    });
    return id;
  };

  const liveScores = async (id: string): Promise<{[key: string]: unknown}[]> => {
    return (await registerObsScore().find({traceId: id})).map(
      (doc) => doc.toObject() as unknown as {[key: string]: unknown}
    ); // cast: Mongoose doc type has no index signature
  };

  const buildApp = (extraPlugins: ObservabilityPlugin[] = []): express.Application => {
    const plugin = createLocalObservabilityPlugin();
    store =
      plugin.traceSink && "store" in plugin.traceSink
        ? (plugin.traceSink as {store: LocalTraceStore}).store
        : new LocalTraceStore();
    return new TerrenoApp({skipListen: true, userModel: terrenoUserModel})
      .register(new ObservabilityApp({plugins: [plugin, ...extraPlugins]}))
      .build();
  };

  beforeAll(async () => {
    const users = await ensureTestUsers();
    adminId = String(users[0]?._id);
    ownerId = String(users[1]?._id);
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsTrace().deleteMany({});
    await registerObsSpan().deleteMany({});
    await registerObsScore().collection.deleteMany({});
    app = buildApp();
    traceId = await exportTraceFor(ownerId);
  });

  it("owner thumbs down with a padded comment writes one trimmed user-feedback score", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent
      .post(feedbackPath(traceId))
      .send({comment: "  Dropped one of my todos  ", thumbs: "down"});

    expect(res.status).toBe(200);
    expect(res.body.data.traceId).toBe(traceId);
    expect(res.body.data.flaggedForDataset).toBe(false);
    expect(res.body.data.scores).toHaveLength(1);
    const scores = await liveScores(traceId);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({
      comment: "Dropped one of my todos",
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      value: false,
    });
  });

  it("owner changing a vote replaces the score and drops the comment", async () => {
    const agent = await authAsUser(app, "notAdmin");
    await agent.post(feedbackPath(traceId)).send({comment: "bad", thumbs: "down"});
    const res = await agent.post(feedbackPath(traceId)).send({thumbs: "up"});

    expect(res.status).toBe(200);
    const scores = await liveScores(traceId);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.value).toBe(true);
    expect(scores[0]?.comment).toBeUndefined();
  });

  it("owner thumbs null returns no scores and leaves no live thumbs_up", async () => {
    const agent = await authAsUser(app, "notAdmin");
    await agent.post(feedbackPath(traceId)).send({thumbs: "down"});
    const res = await agent.post(feedbackPath(traceId)).send({thumbs: null});

    expect(res.status).toBe(200);
    expect(res.body.data.scores).toEqual([]);
    expect(await liveScores(traceId)).toHaveLength(0);
    // Soft-deleted, not hard-deleted.
    expect(
      await registerObsScore().collection.countDocuments({
        deleted: true,
        name: "thumbs_up",
        traceId: new mongoose.Types.ObjectId(traceId),
      })
    ).toBe(1);
  });

  it("thumbs null with no prior vote is a 200 no-op", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post(feedbackPath(traceId)).send({thumbs: null});
    expect(res.status).toBe(200);
    expect(res.body.data.scores).toEqual([]);
  });

  it("a vote after deselecting creates a live score again", async () => {
    const agent = await authAsUser(app, "notAdmin");
    await agent.post(feedbackPath(traceId)).send({thumbs: "down"});
    await agent.post(feedbackPath(traceId)).send({thumbs: null});
    const res = await agent.post(feedbackPath(traceId)).send({thumbs: "up"});
    expect(res.status).toBe(200);
    const scores = await liveScores(traceId);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.value).toBe(true);
  });

  it("sends each non-null write, comment included, to an extra ScoreSink", async () => {
    resetObservabilityApp();
    const exported = mock(async (_score: ScoreRecord): Promise<void> => {});
    app = buildApp([
      {
        capabilities: new Set(["scores"]),
        id: "extra",
        scoreSink: {export: exported},
      },
    ]);
    traceId = await exportTraceFor(ownerId);
    const agent = await authAsUser(app, "notAdmin");

    await agent.post(feedbackPath(traceId)).send({comment: "Too long", thumbs: "down"});
    expect(exported).toHaveBeenCalledTimes(1);
    expect(exported.mock.calls[0]?.[0]).toMatchObject({
      comment: "Too long",
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      traceId,
      value: false,
    });

    await agent.post(feedbackPath(traceId)).send({thumbs: null});
    expect(exported).toHaveBeenCalledTimes(1);
  });

  it("owner who is not an admin gets 200 with RBAC accessControl set", async () => {
    resetObservabilityApp();
    const typedUserModel = UserModel as unknown as UserModelType;
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async () => ({}),
      statements: terrenoStatements,
    });
    const plugin = createLocalObservabilityPlugin();
    store = (plugin.traceSink as unknown as {store: LocalTraceStore}).store;
    const rbacApp = getBaseServer();
    setupAuth(rbacApp, typedUserModel);
    addAuthRoutes(rbacApp, typedUserModel);
    new ObservabilityApp({accessControl, plugins: [plugin]}).register(rbacApp);
    rbacApp.use(apiUnauthorizedMiddleware);
    rbacApp.use(apiErrorMiddleware);
    traceId = await exportTraceFor(ownerId);

    const agent = await authAsUser(rbacApp, "notAdmin");
    const res = await agent.post(feedbackPath(traceId)).send({thumbs: "up"});
    expect(res.status).toBe(200);
    expect(await liveScores(traceId)).toHaveLength(1);
  });

  it("forbids another non-admin user", async () => {
    const other = await exportTraceFor(adminId);
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post(feedbackPath(other)).send({thumbs: "up"});
    expectAPIError(res, {status: 403});
    expect(await liveScores(other)).toHaveLength(0);
  });

  it("forbids an admin who is not the owner", async () => {
    const agent = await authAsUser(app, "admin");
    const res = await agent.post(feedbackPath(traceId)).send({thumbs: "down"});
    expectAPIError(res, {status: 403});
    expect(await liveScores(traceId)).toHaveLength(0);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).post(feedbackPath(traceId)).send({thumbs: "up"});
    expect(res.status).toBe(401);
  });

  it("returns 403 for a trace with no userId", async () => {
    const anonymous = await exportTraceFor(undefined);
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post(feedbackPath(anonymous)).send({thumbs: "up"});
    expectAPIError(res, {status: 403});
  });

  it("writes exactly one ObsScore per thumbs write with only the local plugin", async () => {
    const agent = await authAsUser(app, "notAdmin");
    await agent.post(feedbackPath(traceId)).send({thumbs: "down"});
    expect(await registerObsScore().collection.countDocuments({})).toBe(1);
  });

  it("two concurrent thumbs-down requests leave exactly one live thumbs_up score", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const results = await Promise.all([
      agent.post(feedbackPath(traceId)).send({thumbs: "down"}),
      agent.post(feedbackPath(traceId)).send({thumbs: "down"}),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const scores = await liveScores(traceId);
    expect(scores.filter((s) => s.name === "thumbs_up")).toHaveLength(1);
    expect(await registerObsScore().collection.countDocuments({})).toBe(1);
  });

  it("returns 404 for an unknown trace id and 400 for a malformed one", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const missing = await agent
      .post(feedbackPath(new mongoose.Types.ObjectId().toString()))
      .send({thumbs: "up"});
    expectAPIError(missing, {status: 404});
    const malformed = await agent.post(feedbackPath("not-an-id")).send({thumbs: "up"});
    expectAPIError(malformed, {status: 400});
  });

  it("rejects bad bodies with 400", async () => {
    const agent = await authAsUser(app, "notAdmin");
    expectAPIError(await agent.post(feedbackPath(traceId)).send({}), {status: 400});
    expectAPIError(await agent.post(feedbackPath(traceId)).send({comment: "x"}), {
      status: 400,
      title: "comment needs thumbs or outcome",
    });
    expectAPIError(await agent.post(feedbackPath(traceId)).send({thumbs: "meh"}), {status: 400});
    expectAPIError(
      await agent.post(feedbackPath(traceId)).send({comment: "x".repeat(2001), thumbs: "down"}),
      {status: 400}
    );
    expect(await liveScores(traceId)).toHaveLength(0);
  });

  it("accepts a 2000-character comment and rejects a whitespace-only comment", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const ok = await agent
      .post(feedbackPath(traceId))
      .send({comment: "x".repeat(2000), thumbs: "down"});
    expect(ok.status).toBe(200);
    const blank = await agent.post(feedbackPath(traceId)).send({comment: "   ", thumbs: "down"});
    expect(blank.status).toBe(400);
  });

  it("signal dismissed returns and stores a boolean true user-signal score", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post(feedbackPath(traceId)).send({signal: "dismissed"});
    expect(res.status).toBe(200);
    expect(res.body.data.scores).toHaveLength(1);
    expect(res.body.data.scores[0]).toMatchObject({
      dataType: "boolean",
      name: "dismissed",
      source: "user-signal",
      value: true,
    });
    const scores = await liveScores(traceId);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({name: "dismissed", source: "user-signal", value: true});
  });

  it("signal copied twice leaves one live copied score", async () => {
    const agent = await authAsUser(app, "notAdmin");
    expect((await agent.post(feedbackPath(traceId)).send({signal: "copied"})).status).toBe(200);
    expect((await agent.post(feedbackPath(traceId)).send({signal: "copied"})).status).toBe(200);
    const scores = await liveScores(traceId);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({name: "copied", source: "user-signal"});
  });

  it("an unknown signal returns 400 listing the allowed signals", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post(feedbackPath(traceId)).send({signal: "liked"});
    expectAPIError(res, {status: 400});
    for (const signal of ["accepted", "dismissed", "copied", "edited", "regenerated"]) {
      expect(res.body.title).toContain(signal);
    }
    expect(await liveScores(traceId)).toHaveLength(0);
  });

  it("outcome fp with a comment writes a categorical outcome score with the comment", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent
      .post(feedbackPath(traceId))
      .send({comment: "Not a crisis", outcome: "fp"});
    expect(res.status).toBe(200);
    expect(res.body.data.scores[0]).toMatchObject({
      comment: "Not a crisis",
      dataType: "categorical",
      name: "outcome",
      source: "user-feedback",
      value: "fp",
    });
    const scores = await liveScores(traceId);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({comment: "Not a crisis", name: "outcome", value: "fp"});
  });

  it("outcome alone is valid and a later outcome replaces it", async () => {
    const agent = await authAsUser(app, "notAdmin");
    expect((await agent.post(feedbackPath(traceId)).send({outcome: "fp"})).status).toBe(200);
    expect((await agent.post(feedbackPath(traceId)).send({outcome: "tn"})).status).toBe(200);
    const scores = await liveScores(traceId);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({name: "outcome", value: "tn"});
  });

  it("an invalid outcome returns 400 and keeps the earlier valid outcome", async () => {
    const agent = await authAsUser(app, "notAdmin");
    expect((await agent.post(feedbackPath(traceId)).send({outcome: "tp"})).status).toBe(200);
    expectAPIError(await agent.post(feedbackPath(traceId)).send({outcome: "xx"}), {status: 400});
    const scores = await liveScores(traceId);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({name: "outcome", value: "tp"});
  });

  it("flagDataset true then false toggles the flag in the response and on the trace", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const on = await agent.post(feedbackPath(traceId)).send({flagDataset: true});
    expect(on.status).toBe(200);
    expect(on.body.data.flaggedForDataset).toBe(true);
    expect((await registerObsTrace().findById(traceId))?.flaggedForDataset).toBe(true);

    const off = await agent.post(feedbackPath(traceId)).send({flagDataset: false});
    expect(off.status).toBe(200);
    expect(off.body.data.flaggedForDataset).toBe(false);
    expect((await registerObsTrace().findById(traceId))?.flaggedForDataset).toBe(false);
    expect(await liveScores(traceId)).toHaveLength(0);
  });

  it("thumbs, signal, and flagDataset combine in one 200", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent
      .post(feedbackPath(traceId))
      .send({flagDataset: true, signal: "regenerated", thumbs: "down"});
    expect(res.status).toBe(200);
    expect(res.body.data.flaggedForDataset).toBe(true);
    expect(res.body.data.scores).toHaveLength(2);
    const scores = await liveScores(traceId);
    expect(scores.map((score) => `${score.source}:${score.name}`).sort()).toEqual([
      "user-feedback:thumbs_up",
      "user-signal:regenerated",
    ]);
  });

  it("a stranger gets 403 for a signal and for flagDataset, and nothing is written", async () => {
    const stranger = await exportTraceFor(adminId);
    const agent = await authAsUser(app, "notAdmin");
    expectAPIError(await agent.post(feedbackPath(stranger)).send({signal: "copied"}), {
      status: 403,
    });
    expectAPIError(await agent.post(feedbackPath(stranger)).send({flagDataset: true}), {
      status: 403,
    });
    expect(await liveScores(stranger)).toHaveLength(0);
    expect((await registerObsTrace().findById(stranger))?.flaggedForDataset).toBeFalsy();
  });

  it("the admin scores route accepts source user-signal", async () => {
    const admin = await authAsUser(app, "admin");
    const res = await admin.post(`/ai/observability/traces/${traceId}/scores`).send({
      dataType: "boolean",
      name: "dismissed",
      source: "user-signal",
      value: true,
    });
    expect(res.status).toBe(201);
    const scores = await liveScores(traceId);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({name: "dismissed", source: "user-signal", value: true});
  });

  it("trace list hasScore matches a thumbs-scored trace and not a deselected one", async () => {
    const second = await exportTraceFor(ownerId);
    const agent = await authAsUser(app, "notAdmin");
    await agent.post(feedbackPath(traceId)).send({thumbs: "down"});
    await agent.post(feedbackPath(second)).send({thumbs: "down"});
    await agent.post(feedbackPath(second)).send({thumbs: null});

    const admin = await authAsUser(app, "admin");
    const listed = await admin.get("/ai/observability/traces?hasScore=true");
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((row: {id: string}) => row.id)).toEqual([traceId]);
  });

  it("trace detail shows the feedback score with its comment", async () => {
    const agent = await authAsUser(app, "notAdmin");
    await agent.post(feedbackPath(traceId)).send({comment: "Too long", thumbs: "down"});
    const admin = await authAsUser(app, "admin");
    const detail = await admin.get(`/ai/observability/traces/${traceId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.scores).toHaveLength(1);
    expect(detail.body.data.scores[0]).toMatchObject({
      comment: "Too long",
      name: "thumbs_up",
      source: "user-feedback",
      value: false,
    });
  });
});

describe("GET /ai/observability/traces feedback filters", () => {
  let app: express.Application;
  let store: LocalTraceStore;
  let a: string;
  let b: string;
  let c: string;
  let d: string;
  const listPath = "/ai/observability/traces";

  const addTrace = async (promptName: string): Promise<string> => {
    const id = createTraceId();
    await store.exportTrace({
      id,
      name: promptName,
      prompts: [{name: promptName, version: 1}],
      sensitive: false,
      spans: [],
      startedAt: DateTime.utc().toISO() ?? "",
      status: "ok",
    });
    return id;
  };

  const rowIds = (res: {body: {data: {id: string}[]}}): string[] =>
    res.body.data.map((row) => row.id).sort();

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsTrace().deleteMany({});
    await registerObsSpan().deleteMany({});
    await registerObsScore().collection.deleteMany({});
    const plugin = createLocalObservabilityPlugin();
    store =
      plugin.traceSink && "store" in plugin.traceSink
        ? (plugin.traceSink as {store: LocalTraceStore}).store
        : new LocalTraceStore();
    app = new TerrenoApp({skipListen: true, userModel: terrenoUserModel})
      .register(new ObservabilityApp({plugins: [plugin]}))
      .build();
    a = await addTrace("example-summarize");
    b = await addTrace("other");
    c = await addTrace("other");
    d = await addTrace("other");
    await new LocalTraceStore().exportScore({
      comment: "too long",
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      traceId: a,
      value: false,
    });
    await new LocalTraceStore().exportScore({
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      traceId: b,
      value: true,
    });
    await new LocalTraceStore().exportScore({
      dataType: "boolean",
      name: "dismissed",
      source: "user-signal",
      traceId: c,
      value: true,
    });
  });

  it("thumbs=down returns only the thumbs-down trace", async () => {
    const agent = await authAsUser(app, "admin");
    const res = await agent.get(`${listPath}?thumbs=down`);
    expect(res.status).toBe(200);
    expect(rowIds(res)).toEqual([a]);
    expect(res.body.total).toBe(1);
  });

  it("thumbs=up returns only the thumbs-up trace", async () => {
    const agent = await authAsUser(app, "admin");
    expect(rowIds(await agent.get(`${listPath}?thumbs=up`))).toEqual([b]);
  });

  it("signal=dismissed returns only the dismissed trace", async () => {
    const agent = await authAsUser(app, "admin");
    expect(rowIds(await agent.get(`${listPath}?signal=dismissed`))).toEqual([c]);
  });

  it("hasComment=true returns only the commented trace", async () => {
    const agent = await authAsUser(app, "admin");
    expect(rowIds(await agent.get(`${listPath}?hasComment=true`))).toEqual([a]);
  });

  it("hasComment=false returns every trace without a comment", async () => {
    const agent = await authAsUser(app, "admin");
    const res = await agent.get(`${listPath}?hasComment=false`);
    expect(res.status).toBe(200);
    expect(rowIds(res)).toEqual([b, c, d].sort());
  });

  it("thumbs=down combines with prompt", async () => {
    const agent = await authAsUser(app, "admin");
    expect(rowIds(await agent.get(`${listPath}?thumbs=down&prompt=example-summarize`))).toEqual([
      a,
    ]);
    expect(rowIds(await agent.get(`${listPath}?thumbs=down&prompt=other`))).toEqual([]);
  });

  it("a deselected thumbs score does not match thumbs=down", async () => {
    await new LocalTraceStore().deleteFeedbackScore({
      name: "thumbs_up",
      source: "user-feedback",
      traceId: a,
    });
    const agent = await authAsUser(app, "admin");
    const res = await agent.get(`${listPath}?thumbs=down`);
    expect(res.status).toBe(200);
    expect(rowIds(res)).toEqual([]);
  });

  it("an invalid thumbs value returns 400", async () => {
    const agent = await authAsUser(app, "admin");
    expectAPIError(await agent.get(`${listPath}?thumbs=sideways`), {status: 400});
  });

  it("an unknown signal returns 400", async () => {
    const agent = await authAsUser(app, "admin");
    expectAPIError(await agent.get(`${listPath}?signal=liked`), {status: 400});
  });

  it("an invalid hasComment value returns 400", async () => {
    const agent = await authAsUser(app, "admin");
    expectAPIError(await agent.get(`${listPath}?hasComment=maybe`), {status: 400});
  });

  it("a non-admin gets 403 on a filtered list", async () => {
    const agent = await authAsUser(app, "notAdmin");
    expectAPIError(await agent.get(`${listPath}?thumbs=down`), {status: 403});
  });

  it("a request without a token gets 401 on a filtered list", async () => {
    expectAPIError(await request(app).get(`${listPath}?thumbs=down`), {status: 401});
  });
});
