import {afterEach, describe, expect, it} from "bun:test";
import {z} from "@terreno/api";
import type mongoose from "mongoose";

import {AIRequest} from "../models/aiRequest";
import {GptHistory} from "../models/gptHistory";
import {buildApp, createScriptedModel} from "../tests/chatHarness";
import {authAsUser, ensureTestUsers} from "../tests/helpers";
import {HOST_ACTION_TIMEOUT_MS} from "./gptActions";

const model = createScriptedModel({steps: [[]]});

const validBlocks = (): Record<string, unknown> => {
  const doc: Record<string, unknown> = {};
  doc.v = 1;
  doc.blocks = [{status: "info", text: "Exporting", type: "badge"}];
  return doc;
};

describe("POST /gpt/actions", () => {
  afterEach(async () => {
    await AIRequest.deleteMany({});
    await GptHistory.deleteMany({});
  });

  it("keeps the default handler cap at 10 seconds", () => {
    expect(HOST_ACTION_TIMEOUT_MS).toBe(10_000);
  });

  it("is not mounted when uiBlocks is off", async () => {
    await ensureTestUsers();
    const app = buildApp({model});
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post("/gpt/actions").send({name: "export_csv"});
    expect(res.status).toBe(404);
  });

  it("rejects an unknown name, a bad payload, and a non-owner", async () => {
    const created = await ensureTestUsers();
    const userId = (created[1] as {_id: mongoose.Types.ObjectId})._id;
    const history = await GptHistory.create({
      prompts: [{text: "Hello", type: "user"}],
      userId,
    });
    const app = buildApp({
      model,
      uiBlocks: {
        hostActions: {
          export_csv: {
            handler: async () => ({blocks: validBlocks(), replace: "block" as const}),
            payload: z.object({format: z.literal("csv")}).strict(),
          },
        },
      },
    });
    const agent = await authAsUser(app, "notAdmin");
    const body = {
      blockId: "row",
      elementId: "run_btn",
      historyId: history._id.toString(),
      messageId: "m1",
      name: "export_csv",
      payload: {format: "csv"},
    };

    const unknown = await agent.post("/gpt/actions").send({...body, name: "missing"});
    expect(unknown.status).toBe(404);
    expect(unknown.body.title).toBe("Unknown action");

    const invalid = await agent.post("/gpt/actions").send({...body, payload: {format: "pdf"}});
    expect(invalid.status).toBe(400);
    expect(invalid.body.title).toBe("Invalid payload");
    expect(invalid.body.meta.fields.format).toEqual(expect.any(String));

    const other = await authAsUser(app, "admin");
    const denied = await other.post("/gpt/actions").send(body);
    expect(denied.status).toBe(403);
  });

  it("returns the handler document and logs ui_action", async () => {
    const created = await ensureTestUsers();
    const userId = (created[1] as {_id: mongoose.Types.ObjectId})._id;
    const history = await GptHistory.create({
      prompts: [{text: "Hello", type: "user"}],
      userId,
    });
    const app = buildApp({
      model,
      uiBlocks: {
        hostActions: {
          export_csv: {
            handler: async ({payload}) => {
              expect(payload).toEqual({format: "csv"});
              return {blocks: validBlocks(), replace: "block" as const};
            },
            payload: z.object({format: z.literal("csv")}).strict(),
          },
        },
      },
    });
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post("/gpt/actions").send({
      blockId: "row",
      elementId: "run_btn",
      historyId: history._id.toString(),
      messageId: "m1",
      name: "export_csv",
      payload: {format: "csv"},
    });
    expect(res.status).toBe(200);
    expect(res.body.data.replace).toBe("block");
    expect(res.body.data.blocks.blocks[0].text).toBe("Exporting");
    const logged = await AIRequest.findExactlyOne({requestType: "ui_action"});
    expect(logged?.requestType).toBe("ui_action");
    expect(logged?.error).toBeUndefined();
  });

  it("returns 504 and logs the timeout", async () => {
    const created = await ensureTestUsers();
    const userId = (created[1] as {_id: mongoose.Types.ObjectId})._id;
    const history = await GptHistory.create({
      prompts: [{text: "Hello", type: "user"}],
      userId,
    });
    const app = buildApp({
      model,
      uiBlocks: {
        actionTimeoutMs: 30,
        hostActions: {
          export_csv: {
            handler: () => new Promise(() => {}),
          },
        },
      },
    });
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post("/gpt/actions").send({
      blockId: "row",
      elementId: "run_btn",
      historyId: history._id.toString(),
      messageId: "m1",
      name: "export_csv",
    });
    expect(res.status).toBe(504);
    const logged = await AIRequest.findExactlyOne({requestType: "ui_action"});
    expect(logged?.error).toBe("Action timed out");
  });

  it("returns 500 when the handler's document is invalid", async () => {
    const created = await ensureTestUsers();
    const userId = (created[1] as {_id: mongoose.Types.ObjectId})._id;
    const history = await GptHistory.create({
      prompts: [{text: "Hello", type: "user"}],
      userId,
    });
    const app = buildApp({
      model,
      uiBlocks: {
        hostActions: {
          export_csv: {
            handler: async () => {
              const doc: Record<string, unknown> = {};
              doc.v = 1;
              doc.blocks = [{color: "primary", text: "Hi", type: "heading"}];
              return {blocks: doc, replace: "block" as const};
            },
          },
        },
      },
    });
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post("/gpt/actions").send({
      blockId: "row",
      elementId: "run_btn",
      historyId: history._id.toString(),
      messageId: "m1",
      name: "export_csv",
    });
    expect(res.status).toBe(500);
    expect(res.body.title).toBe("Action returned an invalid document");
    expect(res.body.meta.fields["blocks[0].color"]).toEqual(expect.stringContaining("UNKNOWN_KEY"));
  });
});
