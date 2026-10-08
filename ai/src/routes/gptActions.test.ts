import {afterEach, describe, expect, it} from "bun:test";
import {z} from "@terreno/api";
import type mongoose from "mongoose";

import {AIRequest} from "../models/aiRequest";
import {GptHistory} from "../models/gptHistory";
import {scaleStepperHostAction} from "../service/scaleStepper";
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
    expect(logged?.response).toContain("Exporting");
    expect(JSON.parse(logged?.prompt ?? "{}")).toEqual({
      blockId: "row",
      elementId: "run_btn",
      historyId: history._id.toString(),
      messageId: "m1",
      name: "export_csv",
    });
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

  it("rejects a missing body, a bad history id, and a history that does not exist", async () => {
    await ensureTestUsers();
    const app = buildApp({
      model,
      uiBlocks: {hostActions: {export_csv: {handler: async () => ({text: "ok"})}}},
    });
    const agent = await authAsUser(app, "notAdmin");
    const missingBody = await agent.post("/gpt/actions").send({});
    expect(missingBody.status).toBe(400);

    const body = {
      blockId: "row",
      elementId: "run_btn",
      historyId: "not-an-id",
      messageId: "m1",
      name: "export_csv",
    };
    const badId = await agent.post("/gpt/actions").send(body);
    expect(badId.status).toBe(400);
    expect(badId.body.title).toBe("historyId is not valid");

    const missing = await agent.post("/gpt/actions").send({
      ...body,
      historyId: "000000000000000000000000",
    });
    expect(missing.status).toBe(404);
    expect(missing.body.title).toBe("History not found");
  });

  it("rejects a replace value the client does not understand", async () => {
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
            handler: async () => ({replace: "page" as "block", text: "nope"}),
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
    expect(res.body.title).toBe("Action returned an unknown replace value");
  });
});

const ROAST_STEPPER = `v: 1
blocks:
  - type: heading
    text: Sunday roast
  - type: card
    children:
      - type: stepper
        id: guests
        label: Number of people
        unit: People
        value: 5
        min: 1
        max: 20
        callback:
          name: scaleStepper
          payload:
            recipe: roast
        items:
          - {label: Lamb, amount: 2, unit: kg, decimals: 1}
          - {label: Parsnips, amount: 7, round: up}
          - {label: Broccoli, amount: 625, unit: g}
`;

describe("POST /gpt/actions with scaleStepperHostAction", () => {
  afterEach(async () => {
    await AIRequest.deleteMany({});
    await GptHistory.deleteMany({});
  });

  const setup = async (
    assistantPrompts: string[]
  ): Promise<{agent: Awaited<ReturnType<typeof authAsUser>>; historyId: string}> => {
    const created = await ensureTestUsers();
    const userId = (created[1] as {_id: mongoose.Types.ObjectId})._id;
    const history = await GptHistory.create({
      prompts: [
        {text: "Plan a roast", type: "user"},
        ...assistantPrompts.map((text) => ({text, type: "assistant" as const})),
      ],
      userId,
    });
    const app = buildApp({
      model,
      uiBlocks: {hostActions: {scaleStepper: scaleStepperHostAction}},
    });
    return {agent: await authAsUser(app, "notAdmin"), historyId: history._id.toString()};
  };

  const tap = (
    historyId: string,
    fields: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    blockId: "guests",
    elementId: "guests_increase",
    historyId,
    messageId: "msg-1",
    name: "scaleStepper",
    payload: {recipe: "roast", value: 6},
    ...fields,
  });

  it("returns the scaled stepper and logs ids and value without the response", async () => {
    const {agent, historyId} = await setup([ROAST_STEPPER]);
    const res = await agent.post("/gpt/actions").send(tap(historyId));
    expect(res.status).toBe(200);
    expect(res.body.data.replace).toBe("block");
    expect(res.body.data.blocks.v).toBe(1);
    expect(res.body.data.blocks.blocks).toHaveLength(1);
    const stepper = res.body.data.blocks.blocks[0];
    expect(stepper.type).toBe("stepper");
    expect(stepper.id).toBe("guests");
    expect(stepper.value).toBe(6);
    expect(stepper.items.map((item: {amount: number}) => item.amount)).toEqual([2.4, 9, 750]);

    const logged = await AIRequest.findExactlyOne({requestType: "ui_action"});
    expect(logged?.response).toBeUndefined();
    expect(JSON.parse(logged?.prompt ?? "{}")).toEqual({
      blockId: "guests",
      elementId: "guests_increase",
      historyId,
      messageId: "msg-1",
      name: "scaleStepper",
      value: 6,
    });
    expect(logged?.prompt).not.toContain("roast");
  });

  it("returns 400 above max, 404 for an unknown block, and 409 when the block is ambiguous", async () => {
    const {agent, historyId} = await setup([ROAST_STEPPER, ROAST_STEPPER]);
    const tooMany = await agent
      .post("/gpt/actions")
      .send(tap(historyId, {payload: {recipe: "roast", value: 21}}));
    expect(tooMany.status).toBe(400);

    const unknown = await agent.post("/gpt/actions").send(tap(historyId, {blockId: "nobody"}));
    expect(unknown.status).toBe(404);

    const ambiguous = await agent.post("/gpt/actions").send(tap(historyId, {messageId: "msg-9"}));
    expect(ambiguous.status).toBe(409);

    const direct = await agent.post("/gpt/actions").send(tap(historyId, {messageId: "msg-2"}));
    expect(direct.status).toBe(200);

    const notANumber = await agent
      .post("/gpt/actions")
      .send(tap(historyId, {payload: {value: "6"}}));
    expect(notANumber.status).toBe(400);
    expect(notANumber.body.title).toBe("Invalid payload");

    const errorRows = await AIRequest.find({error: {$exists: true}, requestType: "ui_action"});
    for (const row of errorRows) {
      expect(row.response).toBeUndefined();
    }
  });
});
