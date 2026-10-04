import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import {createLocalObservabilityPlugin} from "./localPlugin";
import {registerObsExperiment} from "./models/obsExperiment";
import {registerObsPrompt} from "./models/obsPrompt";
import {registerObsPromptLabel} from "./models/obsPromptLabel";
import {registerObsPromptVersion} from "./models/obsPromptVersion";
import {registerObsTrace} from "./models/obsTrace";
import {LocalPromptStore} from "./promptStore";

describe("LocalPromptStore", () => {
  let store: LocalPromptStore;

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    store = new LocalPromptStore();
    new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]});
    await registerObsPrompt().deleteMany({});
    await registerObsPromptVersion().deleteMany({});
    await registerObsPromptLabel().deleteMany({});
    await registerObsTrace().deleteMany({});
    await registerObsExperiment().deleteMany({});
  });

  it("round-trips an optional description on create, list, and detail", async () => {
    await store.create({
      description: "Summarizes user notes for clinicians",
      folder: "examples",
      name: "summarize",
      system: "Summarize",
      type: "text",
    });
    await store.create({
      folder: "examples",
      name: "legacy-no-description",
      system: "Legacy",
      type: "text",
    });

    const listed = await store.list({folder: "examples"});
    expect(listed.find((row) => row.name === "summarize")?.description).toBe(
      "Summarizes user notes for clinicians"
    );
    expect(listed.find((row) => row.name === "legacy-no-description")?.description).toBeUndefined();

    const detail = await store.getDetail("summarize");
    expect(detail.description).toBe("Summarizes user notes for clinicians");
    const legacy = await store.getDetail("legacy-no-description");
    expect(legacy.description).toBeUndefined();
  });

  it("composes bounded relationships with only this prompt's traces and experiments", async () => {
    await store.create({
      folder: "examples",
      name: "hub-prompt",
      system: "v1",
      type: "text",
    });
    await store.createVersion("hub-prompt", {system: "v2", type: "text"});
    const ObsTrace = registerObsTrace();
    await ObsTrace.create({
      name: "hub-v1",
      prompts: [{name: "hub-prompt", version: 1}],
      startedAt: DateTime.utc().minus({minutes: 2}).toJSDate(),
      status: "ok",
    });
    await ObsTrace.create({
      name: "hub-v2",
      prompts: [{name: "hub-prompt", version: 2}],
      startedAt: DateTime.utc().minus({minutes: 1}).toJSDate(),
      status: "error",
    });
    await ObsTrace.create({
      name: "other-prompt",
      prompts: [{name: "other", version: 1}],
      startedAt: DateTime.utc().toJSDate(),
      status: "ok",
    });
    const ObsExperiment = registerObsExperiment();
    await ObsExperiment.create({
      datasetId: new mongoose.Types.ObjectId(),
      evaluatorIds: [],
      name: "hub-run",
      promptName: "hub-prompt",
      status: "completed",
      thresholds: [],
      versions: [1, 2],
    });
    await ObsExperiment.create({
      datasetId: new mongoose.Types.ObjectId(),
      evaluatorIds: [],
      name: "foreign-run",
      promptName: "other",
      status: "pending",
      thresholds: [],
      versions: [1, 2],
    });

    const detail = await store.getDetail("hub-prompt");
    expect(detail.relationships.experiments.total).toBe(1);
    expect(detail.relationships.experiments.items).toEqual([
      expect.objectContaining({name: "hub-run", promptName: "hub-prompt"}),
    ]);
    expect(detail.relationships.traces.total).toBe(2);
    expect(detail.relationships.traces.items.map((row) => row.name).sort()).toEqual([
      "hub-v1",
      "hub-v2",
    ]);
    expect(
      detail.relationships.traces.items.every((row) => {
        return row.promptName === "hub-prompt";
      })
    ).toBe(true);
    expect(
      detail.relationships.traces.items.find((row) => row.name === "hub-v2")?.promptVersion
    ).toBe(2);
  });

  it("filters hub traces by prompt version and keeps unfiltered detail", async () => {
    await store.create({
      folder: "examples",
      name: "version-filter",
      system: "v1",
      type: "text",
    });
    await store.createVersion("version-filter", {system: "v2", type: "text"});
    const ObsTrace = registerObsTrace();
    await ObsTrace.create({
      name: "only-v1",
      prompts: [{name: "version-filter", version: 1}],
      startedAt: DateTime.utc().minus({minutes: 2}).toJSDate(),
      status: "ok",
    });
    await ObsTrace.create({
      name: "only-v2",
      prompts: [{name: "version-filter", version: 2}],
      startedAt: DateTime.utc().minus({minutes: 1}).toJSDate(),
      status: "ok",
    });

    const v2 = await store.getDetail("version-filter", {promptVersion: 2});
    expect(v2.relationships.traces.total).toBe(1);
    expect(v2.relationships.traces.items.map((row) => row.name)).toEqual(["only-v2"]);
    expect(v2.relationships.traces.items[0]?.promptVersion).toBe(2);

    const all = await store.getDetail("version-filter");
    expect(all.relationships.traces.total).toBe(2);
    expect(all.relationships.traces.items.map((row) => row.name).sort()).toEqual([
      "only-v1",
      "only-v2",
    ]);
  });

  it("caps relationship traces at the published limit while reporting total", async () => {
    await store.create({
      folder: "examples",
      name: "bounded-traces",
      system: "v1",
      type: "text",
    });
    const ObsTrace = registerObsTrace();
    const seedCount = 25;
    for (let index = 0; index < seedCount; index += 1) {
      await ObsTrace.create({
        name: `trace-${index}`,
        prompts: [{name: "bounded-traces", version: 1}],
        startedAt: DateTime.utc().minus({minutes: index}).toJSDate(),
        status: "ok",
      });
    }

    const detail = await store.getDetail("bounded-traces");
    expect(detail.relationships.traces.total).toBe(seedCount);
    expect(detail.relationships.traces.limit).toBe(20);
    expect(detail.relationships.traces.items).toHaveLength(20);
  });

  it("leaves v1 unchanged after creating v2 and resolves production by label", async () => {
    await store.create({
      folder: "examples",
      name: "greeter",
      system: "You are v1",
      template: "Hello {{name}}",
      type: "text",
    });
    await store.moveLabel("greeter", {label: "production", version: 1});
    await store.createVersion("greeter", {
      system: "You are v2",
      template: "Hi {{name}}",
      type: "text",
    });
    const moved = await store.moveLabel("greeter", {label: "production", version: 2});

    const v1 = await registerObsPromptVersion().findExactlyOne({version: 1});
    expect(v1.system).toBe("You are v1");
    expect(moved.outgoingVersion).toBe(1);

    const production = await store.get({label: "production", name: "greeter"});
    expect(production?.version).toBe(2);
    expect(production?.body).toBe("You are v2");
  });

  it("returns — for production and 7-day usage rollup when include=usage7d", async () => {
    await store.create({
      folder: "examples",
      name: "summarize",
      system: "Summarize",
      type: "text",
    });
    await store.create({
      folder: "other",
      name: "unrelated",
      system: "Nope",
      type: "text",
    });
    const ObsTrace = registerObsTrace();
    await ObsTrace.create({
      created: DateTime.utc().minus({days: 1}).toJSDate(),
      name: "summarize-call",
      prompts: [{label: "production", name: "summarize", version: 1}],
      startedAt: DateTime.utc().minus({days: 1}).toJSDate(),
      status: "ok",
      usage: {costUsd: 0.4, inputTokens: 10, outputTokens: 20},
    });
    await ObsTrace.create({
      created: DateTime.utc().minus({days: 8}).toJSDate(),
      name: "old-call",
      prompts: [{name: "summarize", version: 1}],
      startedAt: DateTime.utc().minus({days: 8}).toJSDate(),
      status: "ok",
      usage: {costUsd: 9},
    });

    const listed = await store.list({folder: "examples", includeUsage7d: true, search: "sum"});
    expect(listed).toEqual([
      {
        folder: "examples",
        latestVersion: 1,
        name: "summarize",
        production: "—",
        type: "text",
        usage7d: {calls: 1, costUsd: 0.4},
      },
    ]);
  });

  it("validates create/moveLabel inputs and resolves versions by label or number", async () => {
    try {
      await store.create({folder: "", name: "bad"});
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/folder and name/);
    }

    await store.create({
      folder: "examples",
      name: "versioned",
      system: "v1",
      type: "text",
    });
    await store.createVersion("versioned", {system: "v2", type: "text"});

    try {
      await store.moveLabel("versioned", {label: "qa", version: 2});
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/production or staging/);
    }

    try {
      await store.moveLabel("versioned", {label: "production", version: 99});
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/Unknown version 99/);
    }

    await store.create({
      folder: "examples",
      name: "duplicate",
      system: "one",
      type: "text",
    });
    try {
      await store.create({folder: "examples", name: "duplicate", system: "two", type: "text"});
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/already exists/);
    }

    expect(await store.getVersionByLabel("missing")).toBeUndefined();
    expect((await store.getVersionByNumber("versioned", 2))?.system).toBe("v2");
    expect(await store.getVersionByNumber("versioned", 99)).toBeUndefined();
  });

  it("compiles templates and runs playground generation with optional pricing", async () => {
    await store.create({
      folder: "examples",
      name: "playground",
      system: "System {{name}}",
      template: "Hello {{name}}",
      type: "text",
      variables: [{key: "name", required: true}],
    });
    expect(store.compile({system: "", template: "Hi", variables: {}})).toEqual([
      {content: "Hi", role: "user"},
    ]);

    const result = await store.runPlayground({
      generator: {
        generate: async () => {
          return {inputTokens: 10, latencyMs: 12, output: "done", outputTokens: 5};
        },
      },
      modelId: "mock-model",
      name: "playground",
      priceMap: {["mock-model"]: {inputPerMTok: 1, outputPerMTok: 2}},
      variables: {name: "Ada"},
      version: 1,
    });
    expect(result.output).toBe("done");
    expect(result.costUsd).toBeCloseTo(0.00002);
    expect(result.compiledMessages).toEqual([
      {content: "System Ada", role: "system"},
      {content: "Hello Ada", role: "user"},
    ]);

    const latest = await store.runPlayground({
      generator: {
        generate: async () => {
          return {output: "latest"};
        },
      },
      name: "playground",
      variables: {name: "Grace"},
    });
    assert.equal(latest.output, "latest");
    assert.deepEqual(latest.compiledMessages, [
      {content: "System Grace", role: "system"},
      {content: "Hello Grace", role: "user"},
    ]);
    assert.isUndefined(await store.get({name: "missing"}));
    assert.isUndefined(await store.getVersionByNumber("missing", 1));
  });
});
