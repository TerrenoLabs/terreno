import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type express from "express";

import {authAsUser, ensureTestUsers, UserModel} from "../../tests/helpers";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsDataset} from "../local/models/obsDataset";
import {registerObsDatasetItem} from "../local/models/obsDatasetItem";
import {registerObsPrompt} from "../local/models/obsPrompt";
import {registerObsPromptLabel} from "../local/models/obsPromptLabel";
import {registerObsPromptVersion} from "../local/models/obsPromptVersion";
import {LocalPromptStore} from "../local/promptStore";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";

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
    app = new TerrenoApp({skipListen: true, userModel: UserModel})
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
