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

const ROAST_REPLY = `v: 1
blocks:
  - type: stepper
    id: guests
    label: Number of people
    value: 5
    min: 1
    max: 20
    callback: {name: scaleStepper}
    items:
      - {label: Bone-in leg of lamb, amount: 2, unit: kg, decimals: 1}
      - {label: Carrots, amount: 8, round: up}
  - type: checklist
    id: cooking
    callback: {name: toggleChecklist}
    items:
      - {id: prep_ahead, text: Prep ahead, checked: true}
      - {id: prepare_lamb, text: Prepare the lamb}
      - {id: start_roasting, text: Start roasting}
`;

const buildActionsApp = (): express.Express =>
  new TerrenoApp({skipListen: true, userModel: UserModel as never})
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
    .build() as express.Express;

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

    const olderStats = createTodoStatsTool({
      historyId: older._id.toString(),
      userId: user._id as mongoose.Types.ObjectId,
    })[TODO_STATS_TOOL];
    const olderResult = (await olderStats?.execute?.(
      {},
      {messages: [], toolCallId: "call_old"}
    )) as {
      datasetId: string;
    };
    const olderStored = await AIDataset.findById(olderResult.datasetId);
    expect(olderStored?.historyId.toString()).toBe(older._id.toString());
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

    const response = await supertest(buildActionsApp())
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

  it("scales the stored stepper and ticks the stored checklist through POST /gpt/actions", async () => {
    const {token, user} = await signIn();
    const history = await GptHistory.create({
      prompts: [
        {text: "Plan a roast", type: "user"},
        {text: ROAST_REPLY, type: "assistant"},
      ],
      userId: user._id,
    });
    const app = buildActionsApp();
    const post = (body: Record<string, unknown>): supertest.Test =>
      supertest(app)
        .post("/gpt/actions")
        .set("Authorization", `Bearer ${token}`)
        .send({historyId: history._id.toString(), messageId: "msg-1", ...body});

    const scaled = await post({
      blockId: "guests",
      elementId: "guests_increase",
      name: "scaleStepper",
      payload: {value: 6},
    });
    const ticked = await post({
      blockId: "cooking",
      elementId: "cooking_prepare_lamb",
      name: "toggleChecklist",
      payload: {checked: true, itemId: "prepare_lamb", state: {prep_ahead: true}},
    });

    expect(scaled.status).toBe(200);
    expect(scaled.body.data.blocks.blocks[0]).toMatchObject({
      items: [
        {amount: 2.4, label: "Bone-in leg of lamb"},
        {amount: 10, label: "Carrots"},
      ],
      value: 6,
    });
    expect(ticked.status).toBe(200);
    expect(
      ticked.body.data.blocks.blocks[0].items.map((item: {checked: boolean}) => item.checked)
    ).toEqual([true, true, false]);
  });
});
