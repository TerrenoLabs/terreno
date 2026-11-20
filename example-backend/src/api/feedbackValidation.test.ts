import {afterAll, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {
  createLocalObservabilityPlugin,
  createTraceId,
  GptHistory,
  LocalTraceStore,
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
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";
import {User as UserModel} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {addAiRoutes, setAiService} from "./ai";

// Clearing a vote sends `null`. Runs the example backend's routes with the OpenAPI validator
// configured so a schema that rejects `null` (once a route opts into body validation) shows up here.
describe("clearing feedback through the example backend", () => {
  let app: ReturnType<TerrenoApp["build"]>;
  let token: string;
  let user: UserDocument;

  beforeAll(async () => {
    process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "test-secret";
    process.env.TOKEN_ISSUER = process.env.TOKEN_ISSUER || "example-backend-test";
    Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
    Reflect.deleteProperty(process.env, "GOOGLE_VERTEX_PROJECT");
    setAiService(undefined);
    configureOpenApiValidator();
    app = new TerrenoApp({skipListen: true, userModel: UserModel as never})
      .register(new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]}))
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
    const email = `feedback-${crypto.randomUUID()}@example.com`;
    user = (await UserModel.register(
      {admin: false, email, name: email} as never,
      "password12345"
    )) as unknown as UserDocument;
    token = (await generateTokens(user)).token as string;
  });

  const liveThumbs = async (traceId: string): Promise<number> => {
    return mongoose.connection.collection("obsscores").countDocuments({
      deleted: false,
      name: "thumbs_up",
      traceId: new mongoose.Types.ObjectId(traceId),
    });
  };

  const exportOwnedTrace = async (): Promise<string> => {
    const traceId = createTraceId();
    await new LocalTraceStore().exportTrace({
      id: traceId,
      name: "example-summarize",
      prompts: [],
      sensitive: false,
      spans: [],
      startedAt: DateTime.utc().toISO() ?? "",
      status: "ok",
      userId: String(user._id),
    });
    return traceId;
  };

  it("clears a thumbs vote with thumbs: null", async () => {
    const traceId = await exportOwnedTrace();
    const path = `/ai/observability/traces/${traceId}/feedback`;

    const down = await supertest(app)
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .send({thumbs: "down"});
    expect(down.status).toBe(200);
    expect(await liveThumbs(traceId)).toBe(1);

    const cleared = await supertest(app)
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .send({thumbs: null});
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.scores).toEqual([]);
    expect(await liveThumbs(traceId)).toBe(0);
  });

  it("clears a chat rating with rating: null and removes the trace score", async () => {
    const traceId = await exportOwnedTrace();
    const history = await GptHistory.create({
      prompts: [
        {text: "Hi", type: "user"},
        {text: "Hello!", traceId, type: "assistant"},
      ],
      userId: user._id,
    });
    const path = `/gpt/histories/${String(history._id)}/rating`;

    const down = await supertest(app)
      .patch(path)
      .set("Authorization", `Bearer ${token}`)
      .send({comment: "Too short", promptIndex: 1, rating: "down"});
    expect(down.status).toBe(200);
    expect(await liveThumbs(traceId)).toBe(1);

    const cleared = await supertest(app)
      .patch(path)
      .set("Authorization", `Bearer ${token}`)
      .send({promptIndex: 1, rating: null});
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.rating).toBeNull();
    expect(await liveThumbs(traceId)).toBe(0);
  });
});
