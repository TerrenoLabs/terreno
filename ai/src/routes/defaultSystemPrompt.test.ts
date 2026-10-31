import {afterEach, beforeAll, describe, expect, it} from "bun:test";
import {type ConfigurationModel, configurationPlugin} from "@terreno/api";
import mongoose from "mongoose";
import {GptHistory} from "../models/gptHistory";
import {Project} from "../models/project";
import {MemoryTraceSink} from "../observability/local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "../observability/observabilityApp";
import type {ObservabilityPlugin} from "../observability/types";
import {
  buildApp,
  createScriptedModel,
  modelCall,
  streamPrompt,
  systemPromptOf,
  textStep,
} from "../tests/chatHarness";
import {authAsUser, ensureTestUsers, UserModel} from "../tests/helpers";

interface TestAppConfig {
  ai: {imageStylePrompt: string; systemPrompt: string};
}

// Imported lazily so the module missing before T2 fails only the config case, not the whole file.
const loadConfigModel = async (): Promise<{
  AppConfig: ConfigurationModel<TestAppConfig>;
  configurationPromptGetter: (
    model: unknown,
    path: string
  ) => (args: {req: never}) => Promise<unknown>;
}> => {
  const {aiConfigurationSchema, configurationPromptGetter} = await import("../configuration");
  const appConfigSchema = new mongoose.Schema<TestAppConfig>({ai: aiConfigurationSchema});
  appConfigSchema.plugin(configurationPlugin);
  const AppConfig =
    (mongoose.models.DefaultPromptTestConfig as unknown as ConfigurationModel<TestAppConfig>) ??
    mongoose.model<TestAppConfig, ConfigurationModel<TestAppConfig>>(
      "DefaultPromptTestConfig",
      appConfigSchema
    );
  return {AppConfig, configurationPromptGetter: configurationPromptGetter as never};
};

/** Runs one `/gpt/prompt` turn as a non-admin and returns the system prompt the model received. */
const systemFor = async ({
  body = {prompt: "Hi"},
  defaultSystemPrompt,
  modelId,
  role = "notAdmin",
}: {
  body?: Record<string, unknown>;
  defaultSystemPrompt?: unknown;
  modelId?: string;
  role?: "admin" | "notAdmin";
}): Promise<string> => {
  const model = createScriptedModel({modelId, steps: [textStep("ok")]});
  const app = buildApp({
    defaultSystemPrompt: defaultSystemPrompt as never,
    model,
  });
  const agent = await authAsUser(app, role);
  const {events, status} = await streamPrompt(agent, body);
  expect(status).toBe(200);
  expect(events.some((event) => event.done !== undefined)).toBe(true);
  return String(systemPromptOf(modelCall(model, 0)));
};

describe("defaultSystemPrompt on chat turns", () => {
  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(async () => {
    resetObservabilityApp();
    await Project.deleteMany({});
    await GptHistory.deleteMany({});
  });

  it("puts a string default first in the system prompt", async () => {
    const system = await systemFor({defaultSystemPrompt: "Be terse."});
    expect(system.startsWith("Be terse.")).toBe(true);
  });

  it("calls a function default with {req} carrying req.user", async () => {
    let seenEmail: unknown;
    const system = await systemFor({
      defaultSystemPrompt: ({req}: {req: {user?: {email?: string}}}) => {
        seenEmail = req.user?.email;
        return "From config";
      },
    });
    expect(system.startsWith("From config")).toBe(true);
    expect(seenEmail).toBe("notAdmin@example.com");
  });

  it("orders default, project context, then request systemPrompt", async () => {
    const user = await UserModel.findOne({email: "notAdmin@example.com"});
    const project = await Project.create({
      name: "Test Project",
      systemContext: "Project X",
      userId: user?._id,
    });
    const system = await systemFor({
      body: {projectId: project._id.toString(), prompt: "Hi", systemPrompt: "Req"},
      defaultSystemPrompt: "From config",
    });
    const defaultAt = system.indexOf("From config");
    const projectAt = system.indexOf("Project X");
    const reqAt = system.indexOf("Req");
    expect(defaultAt).toBe(0);
    expect(projectAt).toBeGreaterThan(defaultAt);
    expect(reqAt).toBeGreaterThan(projectAt);
  });

  it("leaves the system prompt unchanged for a whitespace-only default", async () => {
    const baseline = await systemFor({});
    expect(await systemFor({defaultSystemPrompt: "   "})).toBe(baseline);
    // Positive control: the option is honored, so the unchanged output above is a decision.
    expect((await systemFor({defaultSystemPrompt: "Be terse."})).startsWith("Be terse.")).toBe(
      true
    );
  });

  it("leaves the system prompt unchanged when the function returns undefined", async () => {
    const baseline = await systemFor({});
    let calls = 0;
    const system = await systemFor({
      defaultSystemPrompt: () => {
        calls += 1;
        return undefined;
      },
    });
    expect(calls).toBe(1);
    expect(system).toBe(baseline);
  });

  it("still completes the turn and omits the default when the function throws", async () => {
    const baseline = await systemFor({});
    let calls = 0;
    const system = await systemFor({
      defaultSystemPrompt: () => {
        calls += 1;
        throw new Error("config store down");
      },
    });
    expect(calls).toBe(1);
    expect(system).toBe(baseline);
  });

  it("does not prepend the default when an admin promptName override is used", async () => {
    const plugin = {
      capabilities: new Set([
        "datasets",
        "experiments",
        "prompts",
        "reviewQueue",
        "scores",
        "traces",
      ]),
      datasetStore: {},
      experimentRunner: {},
      id: "local",
      promptRegistry: {
        get: async () => ({
          body: "Override",
          label: "production",
          name: "override-prompt",
          sensitive: false,
          version: 1,
        }),
      },
      reviewQueue: {},
      traceSink: new MemoryTraceSink(),
    } as unknown as ObservabilityPlugin;
    new ObservabilityApp({plugins: [plugin]});

    const system = await systemFor({
      body: {prompt: "Hi", promptName: "override-prompt"},
      defaultSystemPrompt: "Be terse.",
      role: "admin",
    });
    expect(system.startsWith("Override")).toBe(true);
    expect(system).not.toContain("Be terse.");
    // Positive control: the same admin without promptName does get the default.
    const plain = await systemFor({defaultSystemPrompt: "Be terse.", role: "admin"});
    expect(plain.startsWith("Be terse.")).toBe(true);
  });

  it("puts the default first for a directly picked image model", async () => {
    const system = await systemFor({
      defaultSystemPrompt: "Be terse.",
      modelId: "gemini-3-pro-image",
    });
    expect(system.startsWith("Be terse.")).toBe(true);
  });

  it("puts the default first in the buffered headless turn", async () => {
    const model = createScriptedModel({steps: [textStep("ok")]});
    const app = buildApp({asks: true, defaultSystemPrompt: "Be terse.", model});
    const agent = await authAsUser(app, "notAdmin");
    const created = await agent.post("/gpt/histories").send({});
    const res = await agent.post(`/gpt/histories/${created.body.data._id}/turn`).send({
      prompt: "Hi",
    });
    expect(res.status).toBe(200);
    expect(String(systemPromptOf(modelCall(model, 0))).startsWith("Be terse.")).toBe(true);
  });

  describe("configurationPromptGetter", () => {
    it("returns the saved value, or undefined when it is empty", async () => {
      const {AppConfig, configurationPromptGetter} = await loadConfigModel();
      await AppConfig.collection.deleteMany({});
      const getter = configurationPromptGetter(AppConfig, "ai.systemPrompt");
      await AppConfig.updateConfig({ai: {systemPrompt: "Saved prompt"}});
      expect(await getter({req: {} as never})).toBe("Saved prompt");
      await AppConfig.updateConfig({ai: {systemPrompt: ""}});
      expect(await getter({req: {} as never})).toBeUndefined();
    });
  });
});
