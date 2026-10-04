import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import {assert} from "chai";
import type express from "express";

import {authAsUser, ensureTestUsers, UserModel} from "../../tests/helpers";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsSpan} from "../local/models/obsSpan";
import {registerObsTrace} from "../local/models/obsTrace";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import {
  OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME,
  OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME,
  OBS_TEST_MULTI_STAGE_FINAL_SCHEMA_NAME,
} from "../testMultiStageSchemas";
import type {ObservabilityGenerateClient, SpanKind} from "../types";

const MISSING_AI_SERVICE_TITLE =
  "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.";

const call1Output = {phrase: "alpha phrase"};
const call2Output = {keywords: ["beta", "gamma"]};
const finalOutput = {
  keywords: ["beta", "gamma"],
  metrics: {
    call1: {charCount: 12, wordCount: 2},
    call2: {charCount: 11, wordCount: 2},
    combinedCharCount: 23,
  },
  phrase: "alpha phrase",
  sentence: "combined output",
};

const createFakeAiService = (
  behavior: Partial<ObservabilityGenerateClient> & {
    failOn?: string;
  } = {}
): ObservabilityGenerateClient => {
  return {
    generateJsonObject: mock(async ({schemaName}) => {
      if (behavior.failOn && schemaName === behavior.failOn) {
        throw new Error(`failed on ${behavior.failOn}`);
      }
      if (schemaName === OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME) {
        return call1Output as never;
      }
      if (schemaName === OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME) {
        return call2Output as never;
      }
      if (schemaName === OBS_TEST_MULTI_STAGE_FINAL_SCHEMA_NAME) {
        return finalOutput as never;
      }
      throw new Error(`unexpected schema ${schemaName}`);
    }),
    generateText: mock(async () => {
      throw new Error("multi-stage workflow must use generateJsonObject");
    }),
    modelId: "fake-observability-model",
    ...behavior,
  };
};

const flattenKinds = (nodes: Array<{children: unknown[]; kind: SpanKind}>): SpanKind[] => {
  const kinds: SpanKind[] = [];
  for (const node of nodes) {
    kinds.push(node.kind);
    kinds.push(...flattenKinds(node.children as Array<{children: unknown[]; kind: SpanKind}>));
  }
  return kinds;
};

describe("observability test-multi-stage route", () => {
  let app: express.Application;
  let fakeAiService: ObservabilityGenerateClient;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsTrace().deleteMany({});
    await registerObsSpan().deleteMany({});
    const plugin = createLocalObservabilityPlugin();
    fakeAiService = createFakeAiService();
    app = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(new ObservabilityApp({aiService: fakeAiService, plugins: [plugin]}))
      .build();
  });

  it("runs the workflow, exports one nested trace, and returns trace detail", async () => {
    const agent = await authAsUser(app, "admin");
    const res = await agent.post("/ai/observability/traces/test-multi-stage").send({
      input: "Terreno observability smoke input",
    });
    expect(res.status).toBe(200);
    assert.isString(res.body.data.traceId);
    assert.equal(res.body.data.output.sentence, "combined output");
    assert.deepEqual(res.body.data.output.keywords, ["beta", "gamma"]);
    assert.equal(res.body.data.stages.length, 4);

    const detail = await agent.get(`/ai/observability/traces/${res.body.data.traceId}`);
    expect(detail.status).toBe(200);
    assert.equal(detail.body.data.name, "test-multi-stage");
    assert.equal(flattenKinds(detail.body.data.spans).join(","), "CHAIN,LLM,LLM,TOOL,LLM");
    assert.equal(detail.body.data.spans[0].children[0].parentSpanId, detail.body.data.spans[0].id);
    assert.equal(detail.body.data.output.sentence, "combined output");
    assert.equal(
      detail.body.data.spans[0].children[0].input.schemaName,
      OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME
    );
    assert.isOk(detail.body.data.spans[0].children[0].input.outputSchema);
  });

  it("returns 403 for non-admin callers", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post("/ai/observability/traces/test-multi-stage").send({
      input: "blocked",
    });
    expect(res.status).toBe(403);
  });

  it("returns 503 when no server or request AI service is available", async () => {
    const plugin = createLocalObservabilityPlugin();
    const noAiApp = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(new ObservabilityApp({plugins: [plugin]}))
      .build();
    const agent = await authAsUser(noAiApp, "admin");
    const res = await agent.post("/ai/observability/traces/test-multi-stage").send({
      input: "missing service",
    });
    expect(res.status).toBe(503);
    assert.equal(res.body.title, MISSING_AI_SERVICE_TITLE);
  });

  it("builds an AI service from the request api key when the server has none", async () => {
    const requestAiServiceFactory = mock(({apiKey}: {apiKey?: string}) => {
      return apiKey === "request-key" ? createFakeAiService() : undefined;
    });
    const plugin = createLocalObservabilityPlugin();
    const requestKeyApp = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(new ObservabilityApp({plugins: [plugin], requestAiServiceFactory}))
      .build();
    const agent = await authAsUser(requestKeyApp, "admin");

    const res = await agent
      .post("/ai/observability/traces/test-multi-stage")
      .set("x-ai-api-key", "request-key")
      .send({input: "request key smoke test"});

    expect(res.status).toBe(200);
    assert.isString(res.body.data.traceId);
    assert.equal(requestAiServiceFactory.mock.calls[0]?.[0].apiKey, "request-key");
  });

  it("exports an error trace and rethrows when a child LLM stage fails", async () => {
    const failingService = createFakeAiService({failOn: OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME});
    const plugin = createLocalObservabilityPlugin();
    const failingApp = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(new ObservabilityApp({aiService: failingService, plugins: [plugin]}))
      .build();
    const agent = await authAsUser(failingApp, "admin");
    const res = await agent.post("/ai/observability/traces/test-multi-stage").send({
      input: "fail on second stage",
    });
    expect(res.status).toBe(500);

    const listed = await agent.get("/ai/observability/traces?status=error&limit=5");
    expect(listed.status).toBe(200);
    assert.isAtLeast(listed.body.data.length, 1);
    const traceId = listed.body.data[0].id as string;
    const detail = await agent.get(`/ai/observability/traces/${traceId}`);
    assert.equal(detail.body.data.status, "error");
    const childKinds = flattenKinds(detail.body.data.spans);
    assert.include(childKinds, "LLM");
    assert.equal(childKinds.filter((kind) => kind === "LLM").length, 2);
    const failedSpan = detail.body.data.spans[0].children.find(
      (span: {name: string; status: string}) => span.name === "call-2"
    );
    assert.equal(failedSpan?.status, "error");
  });

  it("exports the completed child stages when final synthesis fails", async () => {
    const failingService = createFakeAiService({failOn: OBS_TEST_MULTI_STAGE_FINAL_SCHEMA_NAME});
    const plugin = createLocalObservabilityPlugin();
    const failingApp = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(new ObservabilityApp({aiService: failingService, plugins: [plugin]}))
      .build();
    const agent = await authAsUser(failingApp, "admin");

    const res = await agent.post("/ai/observability/traces/test-multi-stage").send({
      input: "fail on final stage",
    });

    expect(res.status).toBe(500);
    const listed = await agent.get("/ai/observability/traces?status=error&limit=5");
    const traceId = listed.body.data[0].id as string;
    const detail = await agent.get(`/ai/observability/traces/${traceId}`);
    const children = detail.body.data.spans[0].children as Array<{
      kind: SpanKind;
      name: string;
      status: string;
    }>;
    assert.deepEqual(
      children.map((span) => span.kind),
      ["LLM", "LLM", "TOOL", "LLM"]
    );
    assert.equal(children.at(-1)?.name, "final");
    assert.equal(children.at(-1)?.status, "error");
  });
});
