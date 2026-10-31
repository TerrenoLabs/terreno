import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {createAuditEventModel} from "@terreno/api";
import type express from "express";
import mongoose from "mongoose";
import supertest from "supertest";

import {access} from "../access";
import {User} from "../models/user";
import {start} from "../server";
import {seedBetterAuthUserInProcess} from "../utils/betterAuthUserSeed";
import {resetVertexProviderForTests, resolveImageModel} from "./ai";

const auditEvents = () => createAuditEventModel(mongoose.connection);

const PASSWORD = "exampleAiWiringPass123";
const ADMIN_EMAIL = "ai-wiring-admin@example.com";
const USER_EMAIL = "ai-wiring-user@example.com";

interface GeminiCall {
  systemText: string;
  toolNames: string[];
  tools: {name: string; parameters?: {properties?: Record<string, unknown>}}[];
}

const originalFetch = globalThis.fetch;
let geminiCalls: GeminiCall[] = [];

const geminiChunk = {
  candidates: [{content: {parts: [{text: "ok"}], role: "model"}, finishReason: "STOP", index: 0}],
  usageMetadata: {candidatesTokenCount: 1, promptTokenCount: 1, totalTokenCount: 2},
};

/** Replaces the Google Generative AI endpoint with a scripted reply and records what the chat sent. */
const installGeminiStub = (): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("generativelanguage.googleapis.com")) {
      return originalFetch(input as never, init);
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    const tools = (body.tools ?? []).flatMap(
      (entry: {functionDeclarations?: GeminiCall["tools"]}) => entry.functionDeclarations ?? []
    );
    if (url.includes("streamGenerateContent")) {
      geminiCalls.push({
        systemText: (body.systemInstruction?.parts ?? [])
          .map((part: {text?: string}) => part.text ?? "")
          .join("\n"),
        toolNames: tools.map((tool: {name: string}) => tool.name),
        tools,
      });
      return new Response(`data: ${JSON.stringify(geminiChunk)}\n\n`, {
        headers: {"content-type": "text/event-stream"},
        status: 200,
      });
    }
    return new Response(JSON.stringify(geminiChunk), {
      headers: {"content-type": "application/json"},
      status: 200,
    });
  }) as typeof fetch;
};

const signIn = async (
  app: express.Application,
  email: string
): Promise<ReturnType<typeof supertest.agent>> => {
  const agent = supertest.agent(app);
  await agent.post("/api/auth/sign-in/email").send({email, password: PASSWORD}).expect(200);
  return agent;
};

const sendPrompt = async (
  agent: ReturnType<typeof supertest.agent>,
  headers: Record<string, string> = {}
): Promise<void> => {
  const res = await agent
    .post("/gpt/prompt")
    .set(headers)
    .send({prompt: "Hello"})
    .buffer(true)
    .parse((response, callback) => {
      let data = "";
      response.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      response.on("end", () => callback(null, data));
    });
  expect(res.status).toBe(200);
};

describe("example-backend AI wiring (default prompt, skills, image generation)", () => {
  let app: express.Application;
  let admin: ReturnType<typeof supertest.agent>;
  let user: ReturnType<typeof supertest.agent>;

  beforeAll(async () => {
    app = await start(true);
  });

  beforeEach(async () => {
    geminiCalls = [];
    Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
    Reflect.deleteProperty(process.env, "GOOGLE_VERTEX_PROJECT");
    await access.roles.seedDefaults();
    await auditEvents().deleteMany({});
    for (const email of [ADMIN_EMAIL, USER_EMAIL]) {
      await seedBetterAuthUserInProcess({email, name: email, password: PASSWORD});
    }
    await User.updateOne({email: ADMIN_EMAIL}, {$set: {admin: true}});
    access.invalidateCache({userId: (await User.findExactlyOne({email: ADMIN_EMAIL})).id});
    admin = await signIn(app, ADMIN_EMAIL);
    user = await signIn(app, USER_EMAIL);
    installGeminiStub();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(process.env, "GOOGLE_VERTEX_PROJECT");
    Reflect.deleteProperty(process.env, "GOOGLE_VERTEX_ALLOWED_MODELS");
    Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
    resetVertexProviderForTests();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("puts the admin's default system prompt first in the next chat turn", async () => {
    await admin
      .patch("/configuration")
      .send({ai: {systemPrompt: "Answer as Terreno Bot"}})
      .expect(200);
    await sendPrompt(user, {"x-ai-api-key": "test-key"});

    expect(geminiCalls.length).toBeGreaterThan(0);
    expect(geminiCalls[0].systemText.startsWith("Answer as Terreno Bot")).toBe(true);
  });

  it("lets the seeded user list skills", async () => {
    await user.get("/gpt/skills").expect(200);
  });

  it("marks both ai prompt fields as markdown widgets in the configuration meta", async () => {
    const res = await admin.get("/configuration/meta").expect(200);
    const ai = res.body.sections.find((section: {name: string}) => section.name === "ai");
    expect(ai.fields.systemPrompt.widget).toBe("markdown");
    expect(ai.fields.imageStylePrompt.widget).toBe("markdown");
  });

  it("offers the new generate_image tool when the request sends x-ai-api-key", async () => {
    await sendPrompt(user, {"x-ai-api-key": "test-key"});

    const call = geminiCalls[0];
    expect(call.toolNames.filter((name) => name === "generate_image")).toHaveLength(1);
    const imageTool = call.tools.find((tool) => tool.name === "generate_image");
    // The library tool takes {prompt, references}; the removed host tool did not take references.
    expect(Object.keys(imageTool?.parameters?.properties ?? {})).toEqual(
      expect.arrayContaining(["prompt", "references"])
    );
  });

  it("adds load_skill to tool-capable chat turns because skills are on", async () => {
    // T5 offers load_skill only when the user can see at least one skill.
    await user
      .post("/gpt/skills")
      .send({description: "Brand tone", instructions: "Be friendly.", name: "brand-voice"})
      .expect(201);
    await sendPrompt(user, {"x-ai-api-key": "test-key"});
    expect(geminiCalls[0].toolNames).toContain("load_skill");
  });

  it("writes one AuditEvent naming ai.systemPrompt when an admin edits the default prompt", async () => {
    await admin
      .patch("/configuration")
      .send({ai: {systemPrompt: "x"}})
      .expect(200);

    const events = (await auditEvents().find({}).lean()).filter((event) =>
      JSON.stringify(event).includes("ai.systemPrompt")
    );
    expect(events).toHaveLength(1);
    expect(String(events[0].actorId)).toBe(
      String((await User.findExactlyOne({email: ADMIN_EMAIL})).id)
    );
  });

  it("still lists the curated chat models at /ai/models", async () => {
    const res = await user.get("/ai/models").expect(200);
    const models = res.body.data.models as {value: string}[];
    expect(models.map((model) => model.value)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
      "gemini-3-pro-image",
    ]);
  });

  describe("image model resolution", () => {
    const requestWithKey = (apiKey?: string): express.Request =>
      ({
        header: (name: string) => (name === "x-ai-api-key" ? apiKey : undefined),
      }) as express.Request;

    it("leaves generate_image out with no Vertex project and no Gemini key", () => {
      expect(
        resolveImageModel({modelId: "gemini-3-pro-image", req: requestWithKey()})
      ).toBeUndefined();
    });

    it("leaves generate_image out when Vertex does not allow the image model", () => {
      process.env.GOOGLE_VERTEX_PROJECT = "test-project";
      process.env.GOOGLE_VERTEX_ALLOWED_MODELS = "gemini-3.8-flash";
      resetVertexProviderForTests();

      expect(
        resolveImageModel({modelId: "gemini-3-pro-image", req: requestWithKey()})
      ).toBeUndefined();
    });

    it("falls back to GEMINI_API_KEY when Vertex does not allow the image model", () => {
      process.env.GOOGLE_VERTEX_PROJECT = "test-project";
      process.env.GOOGLE_VERTEX_ALLOWED_MODELS = "gemini-3.8-flash";
      process.env.GEMINI_API_KEY = "server-key";
      resetVertexProviderForTests();

      const model = resolveImageModel({modelId: "gemini-3-pro-image", req: requestWithKey()});
      expect(typeof model === "object" ? model.modelId : model).toBe("gemini-3-pro-image");
    });

    it("uses the request key even when Vertex does not allow the image model", () => {
      process.env.GOOGLE_VERTEX_PROJECT = "test-project";
      process.env.GOOGLE_VERTEX_ALLOWED_MODELS = "gemini-3.8-flash";
      resetVertexProviderForTests();

      const model = resolveImageModel({
        modelId: "gemini-3-pro-image",
        req: requestWithKey("test-key"),
      });
      expect(typeof model === "object" ? model.modelId : model).toBe("gemini-3-pro-image");
    });
  });
});
