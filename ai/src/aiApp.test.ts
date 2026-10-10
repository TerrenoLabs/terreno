import {afterEach, beforeAll, describe, expect, it, mock} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type {LanguageModel} from "ai";
import type express from "express";
import supertest from "supertest";

import {AiApp} from "./aiApp";
import {AIRequest} from "./models/aiRequest";
import {GptHistory} from "./models/gptHistory";
import type {FileStorageService} from "./service/fileStorage";
import type {MCPService} from "./service/mcpService";
import {createScriptedModel, modelCall, textStep, toolCallStep} from "./tests/chatHarness";
import {authAsUserWithCredentials, ensureTestUsers, UserModel} from "./tests/helpers";

const AI_APP_TEST_USER = {
  admin: false,
  email: "aiapp@example.com",
  name: "User",
  password: "password",
} as const;

const createMockModel = () => ({
  doGenerate: mock(async () => ({
    content: [{text: "ok", type: "text" as const}],
    finishReason: "stop" as const,
    usage: {inputTokens: 1, outputTokens: 1},
  })),
  doStream: mock(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({
          finishReason: "stop" as const,
          type: "finish" as const,
          usage: {inputTokens: 1, outputTokens: 1},
        });
        controller.close();
      },
    }),
  })),
  modelId: "mock-model",
  provider: "mock-provider",
  specificationVersion: "v2" as const,
  supportedUrls: {},
});

describe("AiApp", () => {
  beforeAll(async () => {
    await ensureTestUsers([AI_APP_TEST_USER]);
  });

  afterEach(async () => {
    await AIRequest.deleteMany({});
    await GptHistory.deleteMany({});
  });

  const authAsUser = async (app: express.Application) => {
    return authAsUserWithCredentials(app, {
      email: AI_APP_TEST_USER.email,
      password: AI_APP_TEST_USER.password,
    });
  };

  it("registers gpt and project routes by default", async () => {
    const {AIService} = await import("./service/aiService");
    const aiService = new AIService({model: createMockModel() as unknown as LanguageModel});
    const plugin = new AiApp({aiService});
    const app = new TerrenoApp({
      configureApp: (router) => plugin.register(router as unknown as express.Application),
      skipListen: true,
      userModel: UserModel,
    }).build();

    const agent = await authAsUser(app);
    const tools = await agent.get("/gpt/tools");
    expect(tools.status).toBe(200);
    const histories = await agent.get("/gpt/histories");
    expect(histories.status).toBe(200);
    const projects = await agent.get("/gpt/projects");
    expect(projects.status).toBe(200);
  });

  it("skips the project routes with projects: false", async () => {
    const {AIService} = await import("./service/aiService");
    const aiService = new AIService({model: createMockModel() as unknown as LanguageModel});
    const plugin = new AiApp({aiService, projects: false});
    const app = new TerrenoApp({
      configureApp: (router) => plugin.register(router as unknown as express.Application),
      skipListen: true,
      userModel: UserModel,
    }).build();

    const agent = await authAsUser(app);
    expect((await agent.get("/gpt/histories")).status).toBe(200);
    expect((await agent.get("/gpt/projects")).status).toBe(404);
  });

  it("passes asks to the gpt routes, so the model is offered the ask tools", async () => {
    const {AIService} = await import("./service/aiService");
    const model = createMockModel();
    const aiService = new AIService({model: model as unknown as LanguageModel});
    const plugin = new AiApp({aiService, asks: true});
    const app = new TerrenoApp({
      configureApp: (router) => plugin.register(router as unknown as express.Application),
      skipListen: true,
      userModel: UserModel,
    }).build();
    const agent = await authAsUser(app);

    const res = await agent.post("/gpt/prompt").send({prompt: "Hi"});

    expect(res.status).toBe(200);
    const [callOptions] = model.doStream.mock.calls[0] as unknown as [{tools?: {name: string}[]}];
    expect(callOptions.tools?.map((tool) => tool.name)).toEqual([
      "ask_choice",
      "ask_confirm",
      "ask_markdown",
      "ask_form",
      "ask_files",
    ]);
  });

  it("adds the documented headless turn actions to the history routes", async () => {
    const {AIService} = await import("./service/aiService");
    const model = createMockModel();
    const aiService = new AIService({model: model as unknown as LanguageModel});
    const app = new TerrenoApp({
      configureApp: (router, options) =>
        new AiApp({aiService, asks: true, openApiOptions: options}).register(
          router as unknown as express.Application
        ),
      skipListen: true,
      userModel: UserModel,
    }).build();
    const agent = await authAsUser(app);

    const openApi = await agent.get("/openapi.json");
    const created = await agent.post("/gpt/histories").send({});
    const historyId = created.body.data._id;
    const turn = await agent
      .post(`/gpt/histories/${historyId}/turn`)
      .send({prompt: "Hi", surface: "compact"});
    const pendingAsks = await agent.get("/gpt/histories/pendingAsks");

    const historyPaths = Object.keys(openApi.body.paths).filter((path) =>
      path.startsWith("/gpt/histories")
    );
    expect(historyPaths.sort()).toEqual([
      "/gpt/histories/",
      "/gpt/histories/pendingAsks",
      "/gpt/histories/{id}",
      "/gpt/histories/{id}/rating",
      "/gpt/histories/{id}/stream",
      "/gpt/histories/{id}/turn",
    ]);
    expect(turn.body.data).toEqual({historyId, text: ""});
    expect(pendingAsks.body.data).toEqual([]);
    const [callOptions] = model.doStream.mock.calls[0] as unknown as [{tools?: {name: string}[]}];
    expect(callOptions.tools?.map((tool) => tool.name)).toEqual(["ask_choice", "ask_confirm"]);
  });

  it("adds the headless actions only with asks on, so hosts without asks get no new endpoints", async () => {
    const {AIService} = await import("./service/aiService");
    const historyRoutes = async (asks?: boolean) => {
      const model = createMockModel();
      const aiService = new AIService({model: model as unknown as LanguageModel});
      const app = new TerrenoApp({
        configureApp: (router, options) =>
          new AiApp({aiService, asks, openApiOptions: options}).register(
            router as unknown as express.Application
          ),
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(app);
      const openApi = await agent.get("/openapi.json");
      const created = await agent.post("/gpt/histories").send({});
      await agent.post(`/gpt/histories/${created.body.data._id}/turn`).send({prompt: "Hi"});
      const pendingAsks = await agent.get("/gpt/histories/pendingAsks");
      const paths = Object.keys(openApi.body.paths).filter((path) =>
        path.startsWith("/gpt/histories")
      );
      return {
        paths: paths.sort(),
        pendingAsksStatus: pendingAsks.status,
        turnModelCalls: model.doStream.mock.calls.length,
      };
    };

    expect(await historyRoutes()).toEqual({
      paths: [
        "/gpt/histories/",
        "/gpt/histories/{id}",
        "/gpt/histories/{id}/rating",
        "/gpt/histories/{id}/stream",
      ],
      pendingAsksStatus: 404,
      turnModelCalls: 0,
    });
    expect(await historyRoutes(true)).toEqual({
      paths: [
        "/gpt/histories/",
        "/gpt/histories/pendingAsks",
        "/gpt/histories/{id}",
        "/gpt/histories/{id}/rating",
        "/gpt/histories/{id}/stream",
        "/gpt/histories/{id}/turn",
      ],
      pendingAsksStatus: 200,
      turnModelCalls: 1,
    });
  });

  it("registers file routes only when fileStorageService and gcsBucket are provided", async () => {
    const fileStorageService = {
      delete: mock(async () => {}),
      getSignedUrl: mock(async () => "https://gcs/signed"),
      upload: mock(async () => ({
        filename: "file",
        gcsKey: "uploads/file",
        mimeType: "application/octet-stream",
        size: 0,
        url: "https://gcs/file",
      })),
    } as unknown as FileStorageService;
    const plugin = new AiApp({fileStorageService, gcsBucket: "test-bucket"});
    const app = new TerrenoApp({
      configureApp: (router) => plugin.register(router as unknown as express.Application),
      skipListen: true,
      userModel: UserModel,
    }).build();
    // Unauthenticated access to upload route: ensure it exists (returns 401, not 404).
    const upload = await supertest(app).post("/files/upload");
    expect(upload.status).not.toBe(404);
  });

  it("caps uploads at asks.maxFileSizeBytes and loads a files answer's uploads from storage", async () => {
    const {AIService} = await import("./service/aiService");
    const {FileAttachment} = await import("./models/fileAttachment");
    const text = Buffer.from("Coffee, 4.50\n");
    const upload = mock(async () => {
      const [user] = await UserModel.find({email: AI_APP_TEST_USER.email});
      const attachment = await FileAttachment.create({
        filename: "items.txt",
        gcsKey: "uploads/items.txt",
        mimeType: "text/plain",
        size: text.length,
        url: "https://gcs/items.txt",
        userId: user._id,
      });
      return {
        filename: "items.txt",
        gcsKey: "uploads/items.txt",
        id: attachment._id.toString(),
        mimeType: "text/plain",
        size: text.length,
        url: "https://gcs/items.txt",
      };
    });
    const download = mock(async () => text);
    const fileStorageService = {download, upload} as unknown as FileStorageService;
    const model = createScriptedModel({
      steps: [
        toolCallStep({
          input: {accept: ["text"], prompt: "Upload the receipt."},
          toolCallId: "call_receipt",
          toolName: "ask_files",
        }),
        textStep("Got it."),
      ],
    });
    const aiService = new AIService({model: model as unknown as LanguageModel});
    const plugin = new AiApp({
      aiService,
      asks: {maxFileSizeBytes: 32},
      fileStorageService,
      gcsBucket: "test-bucket",
    });
    const app = new TerrenoApp({
      configureApp: (router) => plugin.register(router as unknown as express.Application),
      skipListen: true,
      userModel: UserModel,
    }).build();
    const agent = await authAsUser(app);

    const tooLarge = await agent
      .post("/files/upload")
      .attach("file", Buffer.alloc(64, "a"), {contentType: "text/plain", filename: "big.txt"});
    const uploaded = await agent
      .post("/files/upload")
      .attach("file", text, {contentType: "text/plain", filename: "items.txt"});
    await agent.post("/gpt/prompt").send({prompt: "Log lunch"});
    const [history] = await GptHistory.find({});
    await agent.post("/gpt/prompt").send({
      askResponse: {
        action: "accept",
        content: {
          files: [
            {
              fileId: uploaded.body.data.id,
              filename: "items.txt",
              mimeType: "text/plain",
              size: text.length,
            },
          ],
        },
        toolCallId: "call_receipt",
      },
      historyId: history._id.toString(),
    });

    expect(tooLarge.status).not.toBe(200);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith("uploads/items.txt");
    expect(JSON.stringify(modelCall(model, 1).prompt)).toContain("Coffee, 4.50");
    await FileAttachment.deleteMany({});
  });

  it("skips file routes when only fileStorageService is provided", async () => {
    const fileStorageService = {
      upload: mock(async () => ({
        filename: "x",
        gcsKey: "uploads/x",
        mimeType: "application/octet-stream",
        size: 0,
        url: "x",
      })),
    } as unknown as FileStorageService;
    const plugin = new AiApp({fileStorageService});
    const app = new TerrenoApp({
      configureApp: (router) => plugin.register(router as unknown as express.Application),
      skipListen: true,
      userModel: UserModel,
    }).build();
    const upload = await supertest(app).post("/files/upload");
    expect(upload.status).toBe(404);
  });

  it("registers mcp routes when mcpService is provided", async () => {
    const mcpService = {
      getServerStatus: mock(() => []),
      getTools: mock(async () => ({})),
      reconnectServer: mock(async () => {}),
    } as unknown as MCPService;
    const plugin = new AiApp({mcpService});
    const app = new TerrenoApp({
      configureApp: (router) => plugin.register(router as unknown as express.Application),
      skipListen: true,
      userModel: UserModel,
    }).build();
    const agent = await authAsUser(app);
    const servers = await agent.get("/mcp/servers");
    expect(servers.status).not.toBe(404);
  });
});
