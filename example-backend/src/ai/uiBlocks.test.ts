import {beforeEach, describe, expect, it} from "bun:test";
import {AIDataset, addGptRoutes, GptHistory, type HostActionContext} from "@terreno/ai";
import {configureOpenApiValidator, generateTokens, TerrenoApp} from "@terreno/api";
import {validateBlocks} from "@terreno/blocks";
import express from "express";
import {DateTime} from "luxon";
import type mongoose from "mongoose";
import supertest from "supertest";

import {createDemoAgentService} from "../api/demoAgent";
import {Todo} from "../models/todo";
import {User as UserModel} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {exampleUiBlocksOptions} from "./hostActions";
import {createTodoStatsTool, TODO_STATS_TOOL} from "./tools";

const signIn = async (): Promise<{token: string; user: UserDocument}> => {
  const email = `ui-blocks-${crypto.randomUUID()}@example.com`;
  const user = (await UserModel.register(
    {admin: false, email, name: email} as never,
    "password12345"
  )) as unknown as UserDocument;
  const {token} = await generateTokens(user);
  if (!token) {
    throw new Error("No token generated");
  }
  return {token, user};
};

describe("example ui blocks", () => {
  beforeEach(async () => {
    process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "test-secret";
    process.env.TOKEN_ISSUER = process.env.TOKEN_ISSUER || "example-backend-test";
    configureOpenApiValidator();
  });

  it("stores open and completed counts and returns that dataset id", async () => {
    const {user} = await signIn();
    await Todo.create([
      {completed: false, ownerId: user._id, title: "Open one"},
      {completed: false, ownerId: user._id, title: "Open two"},
      {completed: true, ownerId: user._id, title: "Done one"},
    ]);
    const older = await GptHistory.create({prompts: [], userId: user._id});
    older.created = DateTime.now().minus({days: 1}).toJSDate();
    await older.save();
    const history = await GptHistory.create({prompts: [], userId: user._id});
    const other = await signIn();
    await GptHistory.create({prompts: [], userId: other.user._id});
    const statsTool = createTodoStatsTool({
      userId: user._id as mongoose.Types.ObjectId,
    })[TODO_STATS_TOOL];
    if (!statsTool?.execute) {
      throw new Error("todoStats has no execute");
    }

    const result = (await statsTool.execute({}, {messages: [], toolCallId: "call_stats"})) as {
      datasetId: string;
    };
    const stored = await AIDataset.findById(result.datasetId);

    expect(stored?.userId.toString()).toBe(user._id.toString());
    expect(stored?.historyId.toString()).toBe(history._id.toString());
    expect(stored?.columns.map((column) => ({name: column.name, type: column.type}))).toEqual([
      {name: "status", type: "string"},
      {name: "count", type: "number"},
    ]);
    expect(stored?.rows).toEqual([
      ["Open", 2],
      ["Done", 1],
    ]);
  });

  it("does not store a dataset without a signed-in user", async () => {
    const statsTool = createTodoStatsTool({userId: undefined})[TODO_STATS_TOOL];
    const result = await statsTool?.execute?.({}, {messages: [], toolCallId: "call_stats"});

    expect(result).toEqual({datasetId: null, rowCount: 0});
    expect(await AIDataset.countDocuments({})).toBe(0);
  });

  it("replaces the block with a valid document", async () => {
    const handler = exampleUiBlocksOptions.hostActions?.exportDataset?.handler;
    if (!handler) {
      throw new Error("exportDataset has no handler");
    }
    const result = await handler({
      payload: {dataset: "signups"},
    } as HostActionContext);

    expect(result?.replace).toBe("block");
    const checked = validateBlocks(result?.blocks);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.doc.blocks[0]).toMatchObject({
        status: "info",
        text: "Exporting signups",
        type: "badge",
      });
    }
  });

  it("runs exportDataset through POST /gpt/actions", async () => {
    const {token, user} = await signIn();
    const history = await GptHistory.create({prompts: [], userId: user._id});
    const app = new TerrenoApp({skipListen: true, userModel: UserModel as never})
      .register({
        register: (expressApp, openApi) => {
          const router = express.Router();
          addGptRoutes(router, {
            aiService: createDemoAgentService(),
            openApiOptions: {openApi},
            uiBlocks: exampleUiBlocksOptions,
          });
          expressApp.use(router);
        },
      })
      .build();

    const response = await supertest(app)
      .post("/gpt/actions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        blockId: "actions",
        elementId: "export",
        historyId: history._id.toString(),
        messageId: "m1",
        name: "exportDataset",
        payload: {dataset: "signups"},
      });

    expect(response.status).toBe(200);
    expect(response.body.data.replace).toBe("block");
    expect(validateBlocks(response.body.data.blocks).ok).toBe(true);
  });
});
