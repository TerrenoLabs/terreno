import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type express from "express";
import {DateTime} from "luxon";

import {authAsUser, ensureTestUsers, UserModel} from "../../tests/helpers";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsScore} from "../local/models/obsScore";
import {registerObsSpan} from "../local/models/obsSpan";
import {registerObsTrace} from "../local/models/obsTrace";
import {LocalTraceStore} from "../local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";

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
    app = new TerrenoApp({skipListen: true, userModel: UserModel})
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
