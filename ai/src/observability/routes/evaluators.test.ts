import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type express from "express";

import {authAsUser, ensureTestUsers, UserModel} from "../../tests/helpers";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsEvaluator} from "../local/models/obsEvaluator";
import {registerObsPrompt} from "../local/models/obsPrompt";
import {registerObsPromptLabel} from "../local/models/obsPromptLabel";
import {registerObsPromptVersion} from "../local/models/obsPromptVersion";
import {LocalPromptStore} from "../local/promptStore";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";

describe("observability evaluator routes", () => {
  let app: express.Application;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsEvaluator().deleteMany({});
    await registerObsPromptLabel().deleteMany({});
    await registerObsPromptVersion().deleteMany({});
    await registerObsPrompt().deleteMany({});
    const promptStore = new LocalPromptStore();
    await promptStore.create({
      folder: "eval",
      name: "eval-judge-correctness",
      outputSchema: {
        properties: {correct: {type: "boolean"}},
        required: ["correct"],
        type: "object",
      },
      system: "Judge correctness",
      type: "text",
    });
    await promptStore.moveLabel("eval-judge-correctness", {label: "production", version: 1});
    app = new TerrenoApp({skipListen: true, userModel: UserModel})
      .register(new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]}))
      .build();
  });

  it("installs a template by name and rejects human live sampling", async () => {
    const agent = await authAsUser(app, "admin");
    const templates = await agent.get("/ai/observability/evaluators/templates");
    expect(templates.status).toBe(200);
    expect(templates.body.data.some((row: {name: string}) => row.name === "correctness")).toBe(
      true
    );

    const installed = await agent.post("/ai/observability/evaluators/templates/correctness");
    expect(installed.status).toBe(201);
    expect(installed.body.data.name).toBe("correctness");
    expect(installed.body.data.type).toBe("llm-judge");

    const humanInstalled = await agent.post(
      "/ai/observability/evaluators/templates/correctness-human"
    );
    expect(humanInstalled.status).toBe(201);
    expect(humanInstalled.body.data.type).toBe("human");

    const live = await agent.post("/ai/observability/evaluators").send({
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      name: "live-human",
      runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 10},
      target: "full trace",
      type: "human",
    });
    expect(live.status).toBe(400);
  });

  it("supports evaluator CRUD routes", async () => {
    const agent = await authAsUser(app, "admin");
    const listed = await agent.get("/ai/observability/evaluators");
    expect(listed.status).toBe(200);

    const created = await agent.post("/ai/observability/evaluators").send({
      assertion: {constraint: "exists", path: "answer"},
      confidenceAlertBelow: 0.6,
      description: "route evaluator",
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      instructions: "Check it",
      judgePromptName: "eval-judge-correctness",
      name: "route-evaluator",
      target: "full trace",
      type: "llm-judge",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.target).toBe("full trace");

    const spanTarget = await agent.post("/ai/observability/evaluators").send({
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      judgePromptName: "eval-judge-correctness",
      name: "span-evaluator",
      target: "generation span",
      type: "llm-judge",
    });
    expect(spanTarget.status).toBe(400);
    expect(spanTarget.body.title).toBe("Only full trace evaluators are supported");
    const evaluatorId = created.body.data.id as string;

    const detail = await agent.get(`/ai/observability/evaluators/${evaluatorId}`);
    expect(detail.status).toBe(200);

    const updated = await agent.patch(`/ai/observability/evaluators/${evaluatorId}`).send({
      description: "updated",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.description).toBe("updated");

    const deleted = await agent.delete(`/ai/observability/evaluators/${evaluatorId}`);
    expect(deleted.status).toBe(204);
  });
});
