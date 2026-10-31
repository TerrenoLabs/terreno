import {afterEach, beforeAll, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {logger} from "@terreno/api";
import {expectAPIError} from "@terreno/test";
import type mongoose from "mongoose";

import {GptHistory} from "../models/gptHistory";
import {GptSkill} from "../models/gptSkill";
import {
  buildApp,
  conversationOf,
  createScriptedModel,
  lookupPlans,
  modelCall,
  type ScriptedModel,
  streamPrompt,
  systemPromptOf,
  textStep,
  toolCallStep,
  toolNamesOf,
} from "../tests/chatHarness";
import {authAsUser, authAsUserWithCredentials, ensureTestUsers, UserModel} from "../tests/helpers";

const OTHER_USER = {admin: false, email: "other@example.com", name: "Other", password: "password"};
const BASE_TIME = Date.UTC(2026, 0, 1);
const REF_FILE = {filename: "ref.png", gcsKey: "skills/x/ref.png", mimeType: "image/png", size: 10};

describe("skills in chat turns", () => {
  let userAId: mongoose.Types.ObjectId;
  let userBId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    await ensureTestUsers();
    await ensureTestUsers([OTHER_USER]);
    const a = await UserModel.findOne({email: "notAdmin@example.com"});
    const b = await UserModel.findOne({email: OTHER_USER.email});
    if (!a || !b) {
      throw new Error("Test users were not created");
    }
    userAId = a._id as mongoose.Types.ObjectId;
    userBId = b._id as mongoose.Types.ObjectId;
  });

  beforeEach(async () => {
    await GptSkill.deleteMany({});
  });

  afterEach(async () => {
    await GptHistory.deleteMany({});
  });

  const seedGlobal = async (name: string, extra: Record<string, unknown> = {}) =>
    GptSkill.create({
      description: `${name} description`,
      instructions: `${name} instructions`,
      name,
      scope: "global",
      ...extra,
    });

  const seedUser = async (
    userId: mongoose.Types.ObjectId,
    name: string,
    extra: Record<string, unknown> = {}
  ) =>
    GptSkill.create({
      description: `${name} description`,
      instructions: `${name} instructions`,
      name,
      scope: "user",
      userId,
      ...extra,
    });

  /** Sets `updated` directly so recency ordering does not depend on the clock. */
  const setUpdated = async (name: string, offsetSeconds: number): Promise<void> => {
    await GptSkill.collection.updateOne(
      {name},
      {$set: {updated: new Date(BASE_TIME + offsetSeconds * 1000)}}
    );
  };

  /** The output of the first tool result the model saw on its second call. */
  const toolOutputOf = (model: ScriptedModel): unknown => {
    const toolMessage = conversationOf(modelCall(model, 1)).find(
      (message) => message.role === "tool"
    );
    if (!toolMessage) {
      expect.unreachable("The model saw no tool result");
    }
    return (toolMessage.content as {output: {value: unknown}}[])[0].output.value;
  };

  interface TurnArgs {
    body?: Record<string, unknown>;
    modelId?: string;
    role?: "admin" | "notAdmin";
    skills?: boolean;
    steps?: ReturnType<typeof textStep>[];
    credentials?: {email: string; password: string};
    hostTools?: Record<string, unknown>;
  }

  const runTurn = async ({
    body = {prompt: "Hi"},
    credentials,
    hostTools,
    modelId,
    role = "notAdmin",
    skills = true,
    steps = [textStep("ok")],
  }: TurnArgs = {}) => {
    const model = createScriptedModel({modelId, steps});
    const app = buildApp({
      model,
      ...(skills ? {skills: true} : {}),
      ...(hostTools ? {tools: hostTools as never} : {}),
    } as never);
    const agent = credentials
      ? await authAsUserWithCredentials(app, credentials)
      : await authAsUser(app, role);
    const result = await streamPrompt(agent, body);
    return {agent, model, ...result};
  };

  const asB = {email: OTHER_USER.email, password: "password"};

  const catalogLines = (system: string): string[] => {
    const start = system.indexOf("## Skills");
    if (start === -1) {
      return [];
    }
    return system
      .slice(start)
      .split("\n")
      .filter((line) => line.startsWith("- "));
  };

  describe("catalog", () => {
    it("lists a global skill before the caller's skill, and hides it from other users", async () => {
      await seedUser(userAId, "brand-voice");
      await seedGlobal("house-style");

      const a = await runTurn();
      const system = String(systemPromptOf(modelCall(a.model, 0)));
      const lines = catalogLines(system);
      expect(lines).toEqual([
        "- house-style: house-style description",
        "- brand-voice: brand-voice description",
      ]);

      const b = await runTurn({credentials: asB});
      const systemB = String(systemPromptOf(modelCall(b.model, 0)));
      expect(systemB).toContain("- house-style: house-style description");
      expect(systemB).not.toContain("brand-voice");
    });

    it("offers load_skill when a skill is visible", async () => {
      await seedGlobal("house-style");
      const {model} = await runTurn();
      expect(toolNamesOf(modelCall(model, 0))).toContain("load_skill");
    });

    it("leaves a disabled skill out of the catalog", async () => {
      await seedGlobal("house-style");
      await seedUser(userAId, "brand-voice", {enabled: false});
      const {model} = await runTurn();
      const system = String(systemPromptOf(modelCall(model, 0)));
      expect(system).toContain("house-style");
      expect(system).not.toContain("brand-voice");
    });

    it("leaves a deleted skill out of the catalog", async () => {
      await seedGlobal("house-style");
      await seedUser(userAId, "brand-voice", {deleted: true});
      const {model} = await runTurn();
      const system = String(systemPromptOf(modelCall(model, 0)));
      // Positive control: the visible skill is listed, so the deleted one's absence is a decision.
      expect(system).toContain("- house-style: house-style description");
      expect(system).not.toContain("brand-voice");
    });

    it("adds no Skills heading and no load_skill tool when no skill is visible", async () => {
      await seedUser(userBId, "brand-voice");
      const {model} = await runTurn();
      expect(String(systemPromptOf(modelCall(model, 0)))).not.toContain("## Skills");
      expect(toolNamesOf(modelCall(model, 0))).not.toContain("load_skill");
      // Positive control: a visible skill turns the section and the tool on.
      await seedGlobal("house-style");
      const visible = await runTurn();
      expect(String(systemPromptOf(modelCall(visible.model, 0)))).toContain("## Skills");
      expect(toolNamesOf(modelCall(visible.model, 0))).toContain("load_skill");
    });

    it("caps the catalog at 50 lines: globals first, then the caller's newest skills", async () => {
      for (const name of ["global-a", "global-b", "global-c"]) {
        await seedGlobal(name);
      }
      for (let i = 0; i < 50; i += 1) {
        const name = `user-${String(i).padStart(2, "0")}`;
        await seedUser(userAId, name);
        await setUpdated(name, i);
      }

      const {model} = await runTurn();
      const lines = catalogLines(String(systemPromptOf(modelCall(model, 0))));
      expect(lines).toHaveLength(50);
      expect(lines.slice(0, 3).map((line) => line.split(":")[0])).toEqual([
        "- global-a",
        "- global-b",
        "- global-c",
      ]);
      // The 47 most recently updated user skills follow, newest first.
      expect(lines[3].split(":")[0]).toBe("- user-49");
      expect(lines[49].split(":")[0]).toBe("- user-03");
      const catalog = lines.join("\n");
      for (const oldest of ["user-00", "user-01", "user-02"]) {
        expect(catalog).not.toContain(oldest);
      }
    });

    it("keeps skills beyond the catalog cap loadable with load_skill and /name", async () => {
      for (const name of ["global-a", "global-b", "global-c"]) {
        await seedGlobal(name);
      }
      for (let i = 0; i < 50; i += 1) {
        const name = `user-${String(i).padStart(2, "0")}`;
        await seedUser(userAId, name);
        await setUpdated(name, i);
      }

      const loaded = await runTurn({
        steps: [
          toolCallStep({input: {name: "user-00"}, toolCallId: "call_1", toolName: "load_skill"}),
          textStep("done"),
        ],
      });
      const output = toolOutputOf(loaded.model) as Record<string, unknown>;
      expect(output.instructions).toBe("user-00 instructions");

      const forced = await runTurn({body: {prompt: "/user-00 go"}});
      expect(String(systemPromptOf(modelCall(forced.model, 0)))).toContain(
        "## Active skill: user-00"
      );
    });

    it("shows one entry for a name shared by a later global skill and the caller's skill", async () => {
      await seedUser(userAId, "brand-voice", {description: "Mine", instructions: "My voice"});
      await seedGlobal("brand-voice", {description: "Global voice", instructions: "Global words"});

      const catalog = await runTurn();
      const lines = catalogLines(String(systemPromptOf(modelCall(catalog.model, 0)))).filter(
        (line) => line.startsWith("- brand-voice")
      );
      expect(lines).toEqual(["- brand-voice: Global voice"]);

      const loaded = await runTurn({
        steps: [
          toolCallStep({
            input: {name: "brand-voice"},
            toolCallId: "call_1",
            toolName: "load_skill",
          }),
          textStep("done"),
        ],
      });
      const output = toolOutputOf(loaded.model) as Record<string, unknown>;
      expect(output.instructions).toBe("Global words");

      const forced = await runTurn({body: {prompt: "/brand-voice hi"}});
      const system = String(systemPromptOf(modelCall(forced.model, 0)));
      expect(system).toContain("Global words");
      expect(system).not.toContain("My voice");
    });

    it("puts the catalog after the request systemPrompt", async () => {
      await seedGlobal("house-style");
      const {model} = await runTurn({body: {prompt: "Hi", systemPrompt: "Req prompt"}});
      const system = String(systemPromptOf(modelCall(model, 0)));
      expect(system.indexOf("## Skills")).toBeGreaterThan(system.indexOf("Req prompt"));
    });
  });

  describe("load_skill", () => {
    const loadResult = async (
      name: string,
      credentials?: {email: string; password: string}
    ): Promise<unknown> => {
      const {model} = await runTurn({
        credentials,
        steps: [
          toolCallStep({input: {name}, toolCallId: "call_1", toolName: "load_skill"}),
          textStep("done"),
        ],
      });
      return toolOutputOf(model);
    };

    it("returns the instructions and file refs", async () => {
      await seedUser(userAId, "brand-voice", {
        description: "Voice",
        files: [REF_FILE],
        instructions: "Write warmly",
      });
      expect(await loadResult("brand-voice")).toEqual({
        description: "Voice",
        files: [{filename: "ref.png", mimeType: "image/png", ref: "skill:brand-voice/ref.png"}],
        instructions: "Write warmly",
        name: "brand-voice",
      });
    });

    it("returns an unknown-skill error for another user's skill", async () => {
      await seedUser(userAId, "brand-voice");
      // A visible skill, so load_skill is offered to B.
      await seedGlobal("house-style");
      expect(await loadResult("brand-voice", asB)).toEqual({error: "Unknown skill: brand-voice"});
    });

    it("returns an unknown-skill error for a missing, disabled, or deleted skill", async () => {
      await seedUser(userAId, "off-skill", {enabled: false});
      await seedUser(userAId, "gone-skill", {deleted: true});
      // A visible skill, so load_skill is offered.
      await seedGlobal("house-style");
      expect(await loadResult("nope")).toEqual({error: "Unknown skill: nope"});
      expect(await loadResult("off-skill")).toEqual({error: "Unknown skill: off-skill"});
      expect(await loadResult("gone-skill")).toEqual({error: "Unknown skill: gone-skill"});
    });
  });

  describe("/name", () => {
    it("injects an Active skill section and keeps the stored prompt unchanged", async () => {
      await seedUser(userAId, "brand-voice", {instructions: "Write warmly"});
      const prompt = "/brand-voice write a tagline";
      const {events, model, status} = await runTurn({body: {prompt}});
      expect(status).toBe(200);
      const done = events.find((event) => event.done !== undefined);
      const system = String(systemPromptOf(modelCall(model, 0)));
      expect(system).toContain("## Active skill: brand-voice");
      expect(system).toContain("Write warmly");
      const history = await GptHistory.findById(String(done?.historyId));
      expect(history?.prompts[0].text).toBe(prompt);
    });

    it("places Active skill sections after the catalog", async () => {
      await seedUser(userAId, "brand-voice");
      const {model} = await runTurn({body: {prompt: "/brand-voice hi"}});
      const system = String(systemPromptOf(modelCall(model, 0)));
      expect(system.indexOf("## Active skill: brand-voice")).toBeGreaterThan(
        system.indexOf("## Skills")
      );
    });

    it("injects every skill named by up to three leading tokens", async () => {
      await seedGlobal("brand");
      await seedGlobal("poster");
      const {model} = await runTurn({body: {prompt: "/brand /poster make a flyer"}});
      const system = String(systemPromptOf(modelCall(model, 0)));
      expect(system).toContain("## Active skill: brand");
      expect(system).toContain("## Active skill: poster");
    });

    it("answers an unknown name with 400 before streaming", async () => {
      const model = createScriptedModel({steps: [textStep("ok")]});
      const agent = await authAsUser(buildApp({model, skills: true} as never), "notAdmin");
      await seedGlobal("house-style");
      const res = await agent.post("/gpt/prompt").send({prompt: "/nope hi"});
      expectAPIError(res, {status: 400, title: "Unknown skill: nope"});
      expect(model.doStream).not.toHaveBeenCalled();
      expect(await GptHistory.countDocuments({})).toBe(0);
    });

    it("answers another user's skill name with 400", async () => {
      await seedUser(userBId, "secret-skill");
      const model = createScriptedModel({steps: [textStep("ok")]});
      const agent = await authAsUser(buildApp({model, skills: true} as never), "notAdmin");
      const res = await agent.post("/gpt/prompt").send({prompt: "/secret-skill hi"});
      expectAPIError(res, {status: 400, title: "Unknown skill: secret-skill"});
    });

    it("resolves only the first three of four leading tokens", async () => {
      for (const name of ["x1", "x2", "x3", "x4"]) {
        await seedGlobal(name);
      }
      const {model, status} = await runTurn({body: {prompt: "/x1 /x2 /x3 /x4 go"}});
      expect(status).toBe(200);
      const system = String(systemPromptOf(modelCall(model, 0)));
      for (const name of ["x1", "x2", "x3"]) {
        expect(system).toContain(`## Active skill: ${name}`);
      }
      expect(system).not.toContain("## Active skill: x4");
    });
  });

  describe("when skills is off or the model is an image model", () => {
    it("leaves system and tools identical to a turn without the option", async () => {
      await seedGlobal("house-style");
      const without = await runTurn({skills: false});
      const baselineSystem = String(systemPromptOf(modelCall(without.model, 0)));
      expect(baselineSystem).not.toContain("## Skills");
      expect(baselineSystem).not.toContain("house-style");
      expect(toolNamesOf(modelCall(without.model, 0))).not.toContain("load_skill");
      // Positive control: the same data is offered once the option is on.
      const withSkills = await runTurn();
      expect(String(systemPromptOf(modelCall(withSkills.model, 0)))).toContain("house-style");
    });

    it("ignores a leading /name when skills is off", async () => {
      await seedGlobal("house-style");
      const {model, status} = await runTurn({body: {prompt: "/house-style hi"}, skills: false});
      expect(status).toBe(200);
      expect(String(systemPromptOf(modelCall(model, 0)))).not.toContain("## Active skill");
      // Positive control: with skills on, the same prompt activates the skill.
      const on = await runTurn({body: {prompt: "/house-style hi"}});
      expect(String(systemPromptOf(modelCall(on.model, 0)))).toContain(
        "## Active skill: house-style"
      );
    });

    it("adds no catalog and no tool for an image model", async () => {
      await seedGlobal("house-style");
      const {model, status} = await runTurn({modelId: "gemini-3-pro-image"});
      expect(status).toBe(200);
      expect(String(systemPromptOf(modelCall(model, 0)))).not.toContain("## Skills");
      expect(toolNamesOf(modelCall(model, 0))).not.toContain("load_skill");
      // Positive control: a text model on the same data gets both.
      const text = await runTurn();
      expect(String(systemPromptOf(modelCall(text.model, 0)))).toContain("## Skills");
      expect(toolNamesOf(modelCall(text.model, 0))).toContain("load_skill");
    });
  });

  describe("buffered turn and host tools", () => {
    it("offers the catalog and load_skill in the buffered headless turn", async () => {
      await seedGlobal("house-style");
      const model = createScriptedModel({steps: [textStep("ok")]});
      const app = buildApp({asks: true, model, skills: true} as never);
      const agent = await authAsUser(app, "notAdmin");
      const created = await agent.post("/gpt/histories").send({});
      const res = await agent.post(`/gpt/histories/${created.body.data._id}/turn`).send({
        prompt: "Hi",
      });
      expect(res.status).toBe(200);
      expect(String(systemPromptOf(modelCall(model, 0)))).toContain(
        "- house-style: house-style description"
      );
      expect(toolNamesOf(modelCall(model, 0))).toContain("load_skill");
    });

    it("lets the built-in load_skill win over a host tool of the same name and warns", async () => {
      await seedGlobal("house-style", {instructions: "Built-in answer"});
      const warn = spyOn(logger, "warn").mockImplementation((() => {}) as never);
      try {
        const {model} = await runTurn({
          hostTools: {load_skill: lookupPlans},
          steps: [
            toolCallStep({
              input: {name: "house-style"},
              toolCallId: "call_1",
              toolName: "load_skill",
            }),
            textStep("done"),
          ],
        });
        const output = toolOutputOf(model) as Record<string, unknown>;
        expect(output.instructions).toBe("Built-in answer");
        expect(warn).toHaveBeenCalled();
        expect(warn.mock.calls.some((call) => String(call[0]).includes("load_skill"))).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });
  });
});
