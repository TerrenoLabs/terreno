import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type express from "express";

import {authAsUser, ensureTestUsers, terrenoUserModel} from "../../tests/helpers";
import {LocalDatasetStore} from "../local/datasetStore";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsDataset} from "../local/models/obsDataset";
import {registerObsDatasetItem} from "../local/models/obsDatasetItem";
import {registerObsPrompt} from "../local/models/obsPrompt";
import {registerObsPromptLabel} from "../local/models/obsPromptLabel";
import {registerObsPromptVersion} from "../local/models/obsPromptVersion";
import {registerObsScore} from "../local/models/obsScore";
import {registerObsTrace} from "../local/models/obsTrace";
import {LocalPromptStore} from "../local/promptStore";
import {LocalTraceStore} from "../local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import type {ScoreRecord} from "../types";

describe("observability dataset routes", () => {
  let app: express.Application;
  let promptStore: LocalPromptStore;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsDataset().deleteMany({});
    await registerObsDatasetItem().deleteMany({});
    await registerObsPrompt().deleteMany({});
    await registerObsPromptVersion().deleteMany({});
    await registerObsPromptLabel().deleteMany({});
    promptStore = new LocalPromptStore();
    const plugin = createLocalObservabilityPlugin();
    app = new TerrenoApp({skipListen: true, userModel: terrenoUserModel})
      .register(new ObservabilityApp({plugins: [plugin]}))
      .build();
  });

  it("rejects import for non-admin users", async () => {
    const admin = await authAsUser(app, "admin");
    const created = await admin.post("/ai/observability/datasets").send({name: "route-set"});
    expect(created.status).toBe(201);
    const datasetId = created.body.data.id as string;

    const user = await authAsUser(app, "notAdmin");
    const denied = await user
      .post(`/ai/observability/datasets/${datasetId}/import`)
      .send([{text: "hello"}]);
    expect(denied.status).toBe(403);
  });

  it("imports bare JSON rows", async () => {
    const admin = await authAsUser(app, "admin");
    const created = await admin.post("/ai/observability/datasets").send({name: "json-set"});
    const datasetId = created.body.data.id as string;

    const imported = await admin
      .post(`/ai/observability/datasets/${datasetId}/import`)
      .send([{text: "hello"}, {text: "world"}]);
    expect(imported.status).toBe(200);
    expect(imported.body.data.created).toBe(2);

    const items = await admin.get(`/ai/observability/datasets/${datasetId}/items`);
    expect(items.body.data).toHaveLength(2);
  });

  it("imports direct quoted CSV with text/csv", async () => {
    const admin = await authAsUser(app, "admin");
    const created = await admin.post("/ai/observability/datasets").send({name: "csv-direct"});
    const datasetId = created.body.data.id as string;
    const csv = ["input.text,proofread", '"hello, world",true'].join("\n");

    const imported = await admin
      .post(`/ai/observability/datasets/${datasetId}/import`)
      .set("Content-Type", "text/csv")
      .send(csv);
    expect(imported.status).toBe(200);
    expect(imported.body.data.created).toBe(1);
    expect(imported.body.data.items?.[0]?.input?.text ?? imported.body.data).toBeDefined();
  });

  it("imports CSV through JSON wrapper", async () => {
    const admin = await authAsUser(app, "admin");
    const created = await admin.post("/ai/observability/datasets").send({name: "csv-wrap"});
    const datasetId = created.body.data.id as string;
    const content = ["input.text", "alpha"].join("\n");

    const imported = await admin
      .post(`/ai/observability/datasets/${datasetId}/import`)
      .send({content, format: "csv"});
    expect(imported.status).toBe(200);
    expect(imported.body.data.created).toBe(1);
  });

  it("returns 400 for JSON and CSV schema validation failures", async () => {
    await promptStore.create({
      folder: "examples",
      inputSchema: {
        properties: {text: {type: "string"}},
        required: ["text"],
        type: "object",
      },
      name: "bound-prompt",
      type: "text",
    });
    await promptStore.moveLabel("bound-prompt", {label: "production", version: 1});

    const admin = await authAsUser(app, "admin");
    const created = await admin.post("/ai/observability/datasets").send({
      inputSchemaPromptName: "bound-prompt",
      name: "schema-bound",
    });
    const datasetId = created.body.data.id as string;

    const jsonFail = await admin
      .post(`/ai/observability/datasets/${datasetId}/import`)
      .send([{text: 123}]);
    expect(jsonFail.status).toBe(400);
    expect(jsonFail.body.title ?? jsonFail.body.message).toMatch(/Import failed on row/);

    const csvFail = await admin
      .post(`/ai/observability/datasets/${datasetId}/import`)
      .send({content: "input.text\n123", format: "csv"});
    expect(csvFail.status).toBe(400);
    expect(csvFail.body.title ?? csvFail.body.message).toMatch(/Import failed on row/);
  });

  it("supports dataset CRUD, item routes, and trace copy validation", async () => {
    const admin = await authAsUser(app, "admin");
    const listed = await admin.get("/ai/observability/datasets");
    expect(listed.status).toBe(200);

    const created = await admin.post("/ai/observability/datasets").send({name: "route-crud"});
    expect(created.status).toBe(201);
    const datasetId = created.body.data.id as string;

    const detail = await admin.get(`/ai/observability/datasets/${datasetId}`);
    expect(detail.status).toBe(200);

    const updated = await admin.patch(`/ai/observability/datasets/${datasetId}`).send({
      description: "updated",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.description).toBe("updated");

    const item = await admin.post(`/ai/observability/datasets/${datasetId}/items`).send({
      input: {text: "hello"},
      proofread: true,
    });
    expect(item.status).toBe(201);
    const itemId = item.body.data.id as string;

    const patched = await admin
      .patch(`/ai/observability/datasets/${datasetId}/items/${itemId}`)
      .send({proofread: false});
    expect(patched.status).toBe(200);
    expect(patched.body.data.proofread).toBe(false);

    const missingCsv = await admin
      .post(`/ai/observability/datasets/${datasetId}/import`)
      .send({format: "csv"});
    expect(missingCsv.status).toBe(400);

    const missingTrace = await admin.post("/ai/observability/traces/add-to-dataset").send({});
    expect(missingTrace.status).toBe(400);

    const deletedItem = await admin.delete(
      `/ai/observability/datasets/${datasetId}/items/${itemId}`
    );
    expect(deletedItem.status).toBe(204);

    const deleted = await admin.delete(`/ai/observability/datasets/${datasetId}`);
    expect(deleted.status).toBe(204);
  });
});

describe("add-to-dataset carries user feedback", () => {
  let app: express.Application;
  const traces = new LocalTraceStore();

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsDataset().deleteMany({});
    await registerObsDatasetItem().deleteMany({});
    await registerObsTrace().deleteMany({});
    await registerObsScore().deleteMany({});
    app = new TerrenoApp({skipListen: true, userModel: terrenoUserModel})
      .register(new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]}))
      .build();
  });

  const makeTrace = async (sensitive = false): Promise<string> => {
    const exported = await traces.exportTrace({
      endedAt: "2026-01-01T00:00:01.000Z",
      id: "unused",
      input: {text: "hello"},
      name: "generate",
      output: {answer: "world"},
      prompts: [],
      sensitive,
      spans: [],
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "ok",
    });
    return exported.id;
  };

  const score = async (
    traceId: string,
    fields: Pick<ScoreRecord, "dataType" | "name" | "source" | "value"> & {comment?: string}
  ): Promise<void> => {
    await traces.exportScore({traceId, ...fields});
  };

  // Item typed instead of `any` to satisfy the noExplicitAny lint rule.
  interface AddedItem {
    metadata: {userFeedback?: {[key: string]: unknown}};
    proofread: boolean;
    tags: string[];
    [key: string]: unknown;
  }

  const addToDataset = async (traceId: string): Promise<{item: AddedItem; datasetId: string}> => {
    const admin = await authAsUser(app, "admin");
    const created = await admin.post("/ai/observability/datasets").send({name: "fb-set"});
    const datasetId = created.body.data.id as string;
    const res = await admin
      .post("/ai/observability/traces/add-to-dataset")
      .send({datasetId, traceIds: [traceId]});
    expect(res.status).toBe(201);
    return {datasetId, item: res.body.data[0]};
  };

  it("thumbs down with a comment lands unproofread, tagged, with userFeedback", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      comment: "Too long",
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      value: false,
    });
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(false);
    expect(item.tags).toContain("user:thumbs-down");
    expect(item.metadata.userFeedback).toEqual({
      comment: "Too long",
      signals: [],
      thumbs: "down",
    });
  });

  it("thumbs up plus copied stays proofread with no user tags", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      value: true,
    });
    await score(traceId, {
      dataType: "boolean",
      name: "copied",
      source: "user-signal",
      value: true,
    });
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(true);
    expect(item.tags.filter((tag: string) => tag.startsWith("user:"))).toEqual([]);
    expect(item.metadata.userFeedback).toEqual({signals: ["copied"], thumbs: "up"});
  });

  it("dismissed alone lands unproofread with user:dismissed", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      dataType: "boolean",
      name: "dismissed",
      source: "user-signal",
      value: true,
    });
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(false);
    expect(item.tags).toContain("user:dismissed");
    expect(item.metadata.userFeedback).toEqual({signals: ["dismissed"]});
  });

  it("outcome fp tags user:false-positive and is unproofread", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      dataType: "categorical",
      name: "outcome",
      source: "user-feedback",
      value: "fp",
    });
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(false);
    expect(item.tags).toContain("user:false-positive");
    expect(item.metadata.userFeedback).toEqual({outcome: "fp", signals: []});
  });

  it("outcome fn tags user:false-negative and is unproofread", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      dataType: "categorical",
      name: "outcome",
      source: "user-feedback",
      value: "fn",
    });
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(false);
    expect(item.tags).toContain("user:false-negative");
  });

  it("outcome tp stays proofread and carries the outcome", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      dataType: "categorical",
      name: "outcome",
      source: "user-feedback",
      value: "tp",
    });
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(true);
    expect(item.tags).toEqual([]);
    expect(item.metadata.userFeedback).toEqual({outcome: "tp", signals: []});
  });

  it("applies every matching tag when thumbs down and dismissed both exist", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      value: false,
    });
    await score(traceId, {
      dataType: "boolean",
      name: "dismissed",
      source: "user-signal",
      value: true,
    });
    const {item} = await addToDataset(traceId);
    expect(item.tags).toContain("user:thumbs-down");
    expect(item.tags).toContain("user:dismissed");
  });

  it("a trace with no scores behaves as before", async () => {
    const traceId = await makeTrace();
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(true);
    expect(item.tags).toEqual([]);
    expect(item.metadata?.userFeedback).toBeUndefined();
  });

  it("a deselected thumbs down does not count", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      value: false,
    });
    await traces.deleteFeedbackScore({name: "thumbs_up", source: "user-feedback", traceId});
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(true);
    expect(item.tags).toEqual([]);
    expect(item.metadata?.userFeedback).toBeUndefined();
  });

  it("a changed vote uses the latest thumbs value", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      value: false,
    });
    await score(traceId, {
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      value: true,
    });
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(true);
    expect(item.metadata.userFeedback).toEqual({signals: [], thumbs: "up"});
  });

  it("sensitive trace with thumbs up stays unproofread and keeps the comment", async () => {
    const traceId = await makeTrace(true);
    await score(traceId, {
      comment: "Nice",
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      value: true,
    });
    const {item} = await addToDataset(traceId);
    expect(item.proofread).toBe(false);
    expect(item.metadata.userFeedback).toEqual({comment: "Nice", signals: [], thumbs: "up"});
  });

  it("an experiment without includeUnproofread skips the thumbs-down item", async () => {
    const traceId = await makeTrace();
    await score(traceId, {
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      value: false,
    });
    const {datasetId} = await addToDataset(traceId);
    const store = new LocalDatasetStore(new LocalPromptStore());
    expect(await store.listExperimentItems(datasetId, false)).toHaveLength(0);
    expect(await store.listExperimentItems(datasetId, true)).toHaveLength(1);
  });
});
