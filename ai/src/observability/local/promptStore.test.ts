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

  it("returns version schemas from prompt detail", async () => {
    const outputSchema = {
      properties: {helpfulness: {type: "number"}},
      required: ["helpfulness"],
      type: "object",
    };
    await store.create({
      folder: "evaluators",
      name: "eval-judge-helpfulness",
      outputFieldNotes: {helpfulness: "0 to 1"},
      outputSchema,
      system: "Score helpfulness",
      type: "chat",
    });
    const detail = await store.getDetail("eval-judge-helpfulness");
    assert.deepEqual(detail.versions[0]?.outputSchema, outputSchema);
    assert.deepEqual(detail.versions[0]?.outputFieldNotes, {helpfulness: "0 to 1"});
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

  it("lists prompts whose saved text references this prompt", async () => {
    await store.create({
      folder: "shared",
      name: "base-rules",
      template: "Be brief.",
      type: "text",
    });
    await store.moveLabel("base-rules", {label: "production", version: 1});
    await store.create({
      folder: "examples",
      name: "triage-intake",
      template: "{{> base-rules}}\nTriage the form.",
      type: "text",
    });
    await store.createVersion("triage-intake", {
      template: "No shared rules.",
      type: "text",
    });
    await store.create({
      folder: "examples",
      name: "pinned-caller",
      template: "{{> base-rules version=1}}",
      type: "text",
    });
    await store.create({
      folder: "examples",
      name: "unrelated",
      template: "base-rules is only mentioned in prose.",
      type: "text",
    });

    const detail = await store.getDetail("base-rules");
    expect(detail.usedBy).toEqual({
      items: [
        {folder: "examples", name: "pinned-caller", versions: [1]},
        {folder: "examples", name: "triage-intake", versions: [1]},
      ],
      limit: 20,
      total: 2,
    });

    const caller = await store.getDetail("triage-intake");
    expect(caller.usedBy).toEqual({items: [], limit: 20, total: 0});
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

  describe("shared prompt references", () => {
    const baseTag = "{{> base-rules}}";

    beforeEach(async () => {
      await store.create({
        folder: "shared",
        name: "base-rules",
        template: "Answer in plain language for {{audience}}.",
        type: "text",
      });
      await store.moveLabel("base-rules", {label: "production", version: 1});
    });

    it("resolves a shared prompt into every prompt that references it and lists it as an include", async () => {
      await store.create({
        folder: "triage",
        name: "triage-intake",
        system: `${baseTag}\nTriage the intake form.`,
        type: "text",
      });
      await store.moveLabel("triage-intake", {label: "production", version: 1});

      const resolved = await store.get({name: "triage-intake"});
      expect(resolved?.body).toBe(
        "Answer in plain language for {{audience}}.\nTriage the intake form."
      );
      expect(resolved?.includes).toEqual([
        {includedBy: "triage-intake", label: "production", name: "base-rules", version: 1},
      ]);

      const byNumber = await store.getVersionByNumber("triage-intake", 1);
      expect(byNumber?.system).toBe(resolved?.body);
      expect(byNumber?.includes).toEqual(resolved?.includes ?? []);

      // The editor keeps the reference so the shared text stays in one place.
      const detail = await store.getDetail("triage-intake");
      expect(detail.versions[0].system).toBe(`${baseTag}\nTriage the intake form.`);
    });

    it("picks up a promoted shared version without a new version of the including prompt", async () => {
      await store.create({folder: "triage", name: "triage-intake", system: baseTag, type: "text"});
      await store.moveLabel("triage-intake", {label: "production", version: 1});
      await store.createVersion("base-rules", {template: "Be brief.", type: "text"});
      await store.moveLabel("base-rules", {label: "production", version: 2});

      const resolved = await store.get({name: "triage-intake"});
      expect(resolved?.body).toBe("Be brief.");
      expect(resolved?.version).toBe(1);
      expect(resolved?.includes?.[0]?.version).toBe(2);
    });

    it("pins a shared version with version=", async () => {
      await store.createVersion("base-rules", {template: "Be brief.", type: "text"});
      await store.moveLabel("base-rules", {label: "production", version: 2});
      await store.create({
        folder: "triage",
        name: "pinned",
        system: "{{> base-rules version=1}}",
        type: "text",
      });
      await store.moveLabel("pinned", {label: "production", version: 1});

      const resolved = await store.get({name: "pinned"});
      expect(resolved?.body).toBe("Answer in plain language for {{audience}}.");
      expect(resolved?.includes).toEqual([{includedBy: "pinned", name: "base-rules", version: 1}]);
    });

    it("rejects unknown and cyclic references when a version is saved", async () => {
      await expect(
        store.create({
          folder: "triage",
          name: "broken",
          system: "{{> missing}}",
          type: "text",
        })
      ).rejects.toThrow("Invalid prompt reference");
      assert.isNull(await registerObsPrompt().findOneOrNone({name: "broken"}));

      await store.create({folder: "triage", name: "triage-intake", system: baseTag, type: "text"});
      await expect(
        store.createVersion("base-rules", {
          template: "{{> triage-intake label=latest}}",
          type: "text",
        })
      ).rejects.toThrow("Prompt reference cycle");
    });

    it("rejects a save that references a label the shared prompt does not have", async () => {
      await store.create({folder: "shared", name: "draft-rules", template: "Draft", type: "text"});
      await expect(
        store.create({
          folder: "triage",
          name: "uses-draft",
          system: "{{> draft-rules}}",
          type: "text",
        })
      ).rejects.toThrow("Invalid prompt reference");
      await expect(
        store.createVersion("base-rules", {
          template: "{{> draft-rules label=staging}}",
          type: "text",
        })
      ).rejects.toThrow("Invalid prompt reference");
      await expect(
        store.createVersion("base-rules", {template: "{{> draft-rules version=9}}", type: "text"})
      ).rejects.toThrow("Invalid prompt reference");

      await store.moveLabel("draft-rules", {label: "production", version: 1});
      await store.create({
        folder: "triage",
        name: "uses-draft",
        system: "{{> draft-rules}}",
        type: "text",
      });
      await store.moveLabel("uses-draft", {label: "production", version: 1});
      expect((await store.get({name: "uses-draft"}))?.body).toBe("Draft");
    });

    it("rejects a label move that would close a reference cycle", async () => {
      await store.create({folder: "triage", name: "triage-intake", system: "Plain", type: "text"});
      await store.moveLabel("triage-intake", {label: "staging", version: 1});
      await store.createVersion("base-rules", {
        template: "{{> triage-intake label=staging}}",
        type: "text",
      });
      // Valid on its own: base-rules production is still v1, which references nothing.
      await store.createVersion("triage-intake", {system: baseTag, type: "text"});

      // base-rules latest (v2) includes triage-intake staging, which would now include base-rules.
      await expect(
        store.moveLabel("triage-intake", {label: "staging", version: 2})
      ).rejects.toThrow("Prompt reference cycle");
      expect((await store.get({label: "staging", name: "triage-intake"}))?.version).toBe(1);
      expect((await store.get({label: "latest", name: "base-rules"}))?.body).toBe("Plain");
    });

    it("rejects a new version whose latest label would close a reference cycle", async () => {
      await store.create({
        folder: "triage",
        name: "triage-intake",
        system: "{{> base-rules label=latest}}",
        type: "text",
      });
      await expect(
        store.createVersion("base-rules", {
          template: "{{> triage-intake label=latest}}",
          type: "text",
        })
      ).rejects.toThrow("Prompt reference cycle");
    });

    describe("nesting below a prompt that includes the saved one", () => {
      // top → p1 → … → p5 is exactly MAX_PROMPT_REFERENCE_DEPTH levels deep.
      const chain = ["p1", "p2", "p3", "p4", "p5"];

      beforeEach(async () => {
        await store.create({folder: "shared", name: "p5", template: "Leaf", type: "text"});
        await store.moveLabel("p5", {label: "production", version: 1});
        for (let index = chain.length - 2; index >= 0; index--) {
          const name = chain[index];
          const next = chain[index + 1];
          const tag = next === "p5" ? "{{> p5 label=latest}}" : `{{> ${next}}}`;
          await store.create({folder: "shared", name, template: tag, type: "text"});
          await store.moveLabel(name, {label: "production", version: 1});
        }
        await store.create({folder: "triage", name: "top", system: "{{> p1}}", type: "text"});
        await store.moveLabel("top", {label: "production", version: 1});
      });

      it("rejects a new version that would push an including prompt past the limit", async () => {
        await expect(store.createVersion("p5", {template: baseTag, type: "text"})).rejects.toThrow(
          "Prompt references nested too deeply"
        );
        expect((await store.get({label: "latest", name: "p5"}))?.version).toBe(1);
        expect((await store.get({name: "top"}))?.body).toBe("Leaf");
      });

      it("rejects a new version that would push an unlabelled including version past the limit", async () => {
        // top v1 keeps the five-level chain but no longer holds a label.
        await store.createVersion("top", {system: "Plain", type: "text"});
        await store.moveLabel("top", {label: "production", version: 2});

        await expect(store.createVersion("p5", {template: baseTag, type: "text"})).rejects.toThrow(
          "Prompt references nested too deeply"
        );
        expect((await store.getVersionByNumber("top", 1))?.system).toBe("Leaf");
      });

      it("rejects a label move that would push an including prompt past the limit", async () => {
        // p4 now includes p5 production, so a referencing p5 version can land as `latest`.
        await store.createVersion("p4", {template: "{{> p5}}", type: "text"});
        await store.moveLabel("p4", {label: "production", version: 2});
        await store.createVersion("p5", {template: baseTag, type: "text"});

        await expect(store.moveLabel("p5", {label: "production", version: 2})).rejects.toThrow(
          "Prompt references nested too deeply"
        );
        expect((await store.get({name: "top"}))?.body).toBe("Leaf");
      });
    });

    it("compiles shared text and variables in the playground", async () => {
      await store.create({
        folder: "triage",
        name: "triage-intake",
        system: baseTag,
        template: "Intake: {{form}}",
        type: "text",
      });

      const result = await store.runPlayground({
        generator: {
          generate: async () => {
            return {latencyMs: 1, output: "ok"};
          },
        },
        modelId: "mock-model",
        name: "triage-intake",
        variables: {audience: "teens", form: "sleep trouble"},
      });
      expect(result.compiledMessages).toEqual([
        {content: "Answer in plain language for teens.", role: "system"},
        {content: "Intake: sleep trouble", role: "user"},
      ]);
    });
  });
});
