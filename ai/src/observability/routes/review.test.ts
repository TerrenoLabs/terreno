import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import {assert} from "chai";
import type express from "express";
import {DateTime} from "luxon";

import {authAsUser, ensureTestUsers, UserModel} from "../../tests/helpers";
import {LocalEvaluatorStore} from "../local/evaluatorStore";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsEvaluator} from "../local/models/obsEvaluator";
import {registerObsReviewItem} from "../local/models/obsReviewItem";
import {registerObsTrace} from "../local/models/obsTrace";
import {LocalTraceStore} from "../local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";

describe("observability review routes", () => {
  let app: express.Application;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsReviewItem().deleteMany({});
    await registerObsEvaluator().deleteMany({});
    await registerObsTrace().deleteMany({});
    app = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]}))
      .build();
  });

  it("enqueues a trace and lists it pending oldest-first", async () => {
    const evaluator = await new LocalEvaluatorStore().create({
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      name: "queue-human",
      target: "full trace",
      type: "human",
    });
    const trace = await new LocalTraceStore().exportTrace({
      id: "t",
      input: {text: "hello"},
      name: "gen",
      output: {summary: "hi"},
      prompts: [{name: "summarize", version: 1}],
      sensitive: false,
      spans: [
        {
          id: "s",
          kind: "LLM",
          name: "llm",
          startedAt: DateTime.utc().toISO() ?? "",
          status: "ok",
        },
      ],
      startedAt: DateTime.utc().toISO() ?? "",
      status: "ok",
    });
    const agent = await authAsUser(app, "admin");
    const enqueued = await agent.post("/ai/observability/traces/review").send({
      evaluatorId: evaluator.id,
      reason: "manual",
      traceIds: [trace.id],
    });
    expect(enqueued.status).toBe(201);
    const listed = await agent.get("/ai/observability/review?status=pending");
    expect(listed.status).toBe(200);
    expect(listed.body.counts.pending).toBe(1);
    expect(listed.body.more).toBe(false);
    expect(listed.body.data[0].traceId).toBe(trace.id);
    expect(listed.body.data[0].traceName).toBe("gen");
    const detail = await agent.get(`/ai/observability/review/${listed.body.data[0].id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.rawInput).toEqual({text: "hello"});
    expect(detail.body.data.rawOutput).toEqual({summary: "hi"});

    const submitted = await agent
      .post(`/ai/observability/review/${listed.body.data[0].id}`)
      .send({action: "submit", comment: "grounded", scores: {correct: true}});
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("done");
    const pending = await agent.get("/ai/observability/review?status=pending");
    expect(pending.body.counts.pending).toBe(0);
    expect(pending.body.counts.done).toBe(1);
  });

  it("rejects a non-human evaluator from human review intake", async () => {
    const evaluator = await new LocalEvaluatorStore().create({
      assertion: {constraint: "exists", path: "output"},
      dimensions: [{dataType: "boolean", key: "valid", required: true}],
      name: "queue-automatic",
      target: "full trace",
      type: "json-assert",
    });
    const trace = await new LocalTraceStore().exportTrace({
      id: "automatic-review",
      input: {text: "hello"},
      name: "gen",
      output: {summary: "hi"},
      prompts: [],
      sensitive: false,
      spans: [],
      startedAt: DateTime.utc().toISO() ?? "",
      status: "ok",
    });
    const response = await (await authAsUser(app, "admin"))
      .post("/ai/observability/traces/review")
      .send({
        evaluatorId: evaluator.id,
        reason: "manual",
        traceIds: [trace.id],
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.title, "Human review requires a human evaluator");
  });
});
