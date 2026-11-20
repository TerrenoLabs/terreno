import {afterAll, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {
  createLocalObservabilityPlugin,
  LocalPromptStore,
  ObservabilityApp,
  resetObservabilityApp,
} from "@terreno/ai";
import {
  configureOpenApiValidator,
  generateTokens,
  resetOpenApiValidatorConfig,
  TerrenoApp,
} from "@terreno/api";
import expressLib from "express";
import mongoose from "mongoose";
import supertest from "supertest";
import {User as UserModel} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {addAiRoutes, setAiService} from "./ai";

describe("POST /ai/example-summarize", () => {
  let app: ReturnType<TerrenoApp["build"]>;
  let token: string;
  let user: UserDocument;

  beforeAll(async () => {
    process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "test-secret";
    process.env.TOKEN_ISSUER = process.env.TOKEN_ISSUER || "example-backend-test";
    // The no-key path is the one under test, so no server model may be configured.
    Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
    Reflect.deleteProperty(process.env, "GOOGLE_VERTEX_PROJECT");
    // An earlier suite in this process may have cached a Gemini service from the preload's key.
    setAiService(undefined);
    configureOpenApiValidator();
    app = new TerrenoApp({skipListen: true, userModel: UserModel as never})
      .register({
        register: (expressApp, openApi) => {
          const router = expressLib.Router();
          addAiRoutes(router, {openApi} as Parameters<typeof addAiRoutes>[1]);
          expressApp.use(router);
        },
      })
      .build();
  });

  afterAll(() => {
    resetOpenApiValidatorConfig();
    resetObservabilityApp();
  });

  beforeEach(async () => {
    new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]});
    const promptStore = new LocalPromptStore();
    await promptStore.create({
      folder: "examples",
      name: "example-summarize",
      system: "Summarize the text.",
      template: "{{text}}",
      type: "chat",
    });
    await promptStore.moveLabel("example-summarize", {label: "production", version: 1});
    const email = `summarize-${crypto.randomUUID()}@example.com`;
    user = (await UserModel.register(
      {admin: false, email, name: email} as never,
      "password12345"
    )) as unknown as UserDocument;
    token = (await generateTokens(user)).token as string;
  });

  it("with no server model and no key header, answers 200 with the demo reply and an existing trace", async () => {
    const res = await supertest(app)
      .post("/ai/example-summarize")
      .set("Authorization", `Bearer ${token}`)
      .send({text: "Buy milk. Walk the dog. Finish the report."});

    expect(res.status).toBe(200);
    expect(typeof res.body.data.output).toBe("string");
    expect(res.body.data.output.length).toBeGreaterThan(0);
    expect(res.body.data.traceId).toMatch(/^[0-9a-f]{24}$/);
    const trace = await mongoose.model("ObsTrace").findById(res.body.data.traceId);
    expect(trace).not.toBeNull();
    expect(String(trace?.get("userId"))).toBe(String(user._id));
    expect(trace?.toObject().prompts[0]?.name).toBe("example-summarize");
  });

  it("returns a different traceId on each call", async () => {
    const send = () =>
      supertest(app)
        .post("/ai/example-summarize")
        .set("Authorization", `Bearer ${token}`)
        .send({text: "Buy milk."});

    const first = await send();
    const second = await send();

    expect(first.body.data.traceId).toMatch(/^[0-9a-f]{24}$/);
    expect(second.body.data.traceId).not.toBe(first.body.data.traceId);
  });

  it("returns 400 for empty text", async () => {
    const res = await supertest(app)
      .post("/ai/example-summarize")
      .set("Authorization", `Bearer ${token}`)
      .send({text: "   "});

    expect(res.status).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await supertest(app).post("/ai/example-summarize").send({text: "hi"});

    expect(res.status).toBe(401);
  });
});
