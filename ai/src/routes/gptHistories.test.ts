import {afterEach, beforeAll, describe, expect, it, mock} from "bun:test";
import {
  configureOpenApiValidator,
  type ModelRouterOptions,
  Permissions,
  resetOpenApiValidatorConfig,
  TerrenoApp,
  z,
} from "@terreno/api";
import {askJsonSchemas, pendingAskListSchema, turnResultSchema} from "@terreno/blocks";
import type {LanguageModel} from "ai";
import {DateTime} from "luxon";

import {AIRequest} from "../models/aiRequest";
import {GptHistory} from "../models/gptHistory";
import {AIService} from "../service/aiService";
import {COMPACT_SURFACE_SYSTEM_PROMPT} from "../service/prompts";
import {
  type Agent,
  buildApp,
  conversationOf,
  createScriptedModel,
  deferred,
  failingTextStep,
  loadHistory,
  modelCall,
  PLAN_ASK_CALL,
  PLAN_ASK_ROW,
  PLAN_SIMPLE_CARD,
  REGION_ASK_CALL,
  REGION_SIMPLE_CARD,
  rowsOf,
  serveApp,
  systemPromptOf,
  TEAM_ANSWER,
  textStep,
  toolCallStep,
  toolNamesOf,
  USER_PROMPT,
} from "../tests/chatHarness";
import {authAsUser, authAsUserWithCredentials, ensureTestUsers, UserModel} from "../tests/helpers";
import type {GptHistoryDocument} from "../types";
import {addGptHistoryRoutes} from "./gptHistories";

const OTHER_USER = {admin: false, email: "other@example.com", name: "Other", password: "password"};

const TEAM_ANSWER_ROW = {
  result: TEAM_ANSWER,
  text: "Tool result: ask_choice",
  toolCallId: "call_plan",
  toolName: "ask_choice",
  type: "tool-result",
};

const TEAM_REPLY = "Setting up the Team plan.";

const ANSWERED_PLAN_ROWS = [
  {text: USER_PROMPT, type: "user"},
  {...PLAN_ASK_ROW, ask: {kind: "choice", status: "answered"}},
  TEAM_ANSWER_ROW,
  {model: "scripted-model", text: TEAM_REPLY, type: "assistant"},
];

const TEAM_BUTTON = {buttonId: "option:team", toolCallId: "call_plan"};

const createHistory = async (agent: Agent): Promise<string> => {
  const res = await agent.post("/gpt/histories").send({});
  expect(res.status).toBe(201);
  return res.body.data._id;
};

const postTurn = (agent: Agent, historyId: string, body: Record<string, unknown>) =>
  agent.post(`/gpt/histories/${historyId}/turn`).send(body);

/** Creates a history and runs a headless turn that pauses on the plan ask. */
const pauseOnPlanAsk = async (agent: Agent): Promise<string> => {
  const historyId = await createHistory(agent);
  const res = await postTurn(agent, historyId, {prompt: USER_PROMPT});
  expect(res.body.data.pendingAsk?.toolCallId).toBe("call_plan");
  return historyId;
};

/** Reloads the history until the title is saved, the last write of a turn that replied. */
const waitForTitle = async (historyId: string): Promise<GptHistoryDocument> => {
  const deadline = DateTime.now().plus({seconds: 5});
  while (DateTime.now() < deadline) {
    const history = await loadHistory(historyId);
    if (history.title) {
      return history;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`History ${historyId} never saved a title`);
};

describe("/gpt/histories headless turns", () => {
  beforeAll(async () => {
    await ensureTestUsers();
    await ensureTestUsers([OTHER_USER]);
    await GptHistory.deleteMany({});
  });

  afterEach(async () => {
    await AIRequest.deleteMany({});
    await GptHistory.deleteMany({});
  });

  describe("POST /gpt/histories/:id/turn", () => {
    it("pauses on an ask with its simple card, then resumes with the pressed button's answer", async () => {
      const model = createScriptedModel({
        steps: [toolCallStep(PLAN_ASK_CALL), textStep(TEAM_REPLY)],
      });
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await createHistory(agent);

      const asked = await postTurn(agent, historyId, {prompt: USER_PROMPT, surface: "compact"});
      const answered = await postTurn(agent, historyId, {...TEAM_BUTTON, surface: "compact"});

      expect(asked.status).toBe(200);
      expect(asked.body.data).toEqual({
        historyId,
        pendingAsk: {kind: "choice", simple: PLAN_SIMPLE_CARD, toolCallId: "call_plan"},
        text: "",
      });
      expect(answered.status).toBe(200);
      expect(answered.body.data).toEqual({historyId, text: TEAM_REPLY, title: "Workspace setup"});
      for (const res of [asked, answered]) {
        expect(turnResultSchema.parse(res.body.data)).toEqual(res.body.data);
      }
      expect(conversationOf(modelCall(model, 1)).at(-1)).toEqual({
        content: [
          {
            output: {type: "json", value: TEAM_ANSWER},
            toolCallId: "call_plan",
            toolName: "ask_choice",
            type: "tool-result",
          },
        ],
        role: "tool",
      });
      for (const index of [0, 1]) {
        const call = modelCall(model, index);
        expect(toolNamesOf(call)).toEqual(["ask_choice", "ask_confirm"]);
        expect(call.tools?.[0]?.inputSchema.properties).toMatchObject({options: {maxItems: 3}});
        expect(systemPromptOf(call)).toEndWith(COMPACT_SURFACE_SYSTEM_PROMPT);
      }
      const history = await loadHistory(historyId);
      expect(history.pendingAsk).toBeUndefined();
      expect(rowsOf(history)).toEqual(ANSWERED_PLAN_ROWS);
    });

    it.each([
      {buttonId: "approve", confirmed: true, reply: "Sent the weekly report."},
      {buttonId: "deny", confirmed: false, reply: "I did not send it."},
    ])(
      "pauses a compact turn on a confirm card without handoff and resumes with the $buttonId button",
      async ({buttonId, confirmed, reply}) => {
        const reportInput = {
          confirmLabel: "Send report",
          denyLabel: "Not now",
          prompt: "Send the weekly report to the team now?",
        };
        const model = createScriptedModel({
          steps: [
            toolCallStep({input: reportInput, toolCallId: "call_report", toolName: "ask_confirm"}),
            textStep(reply),
          ],
        });
        const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
        const historyId = await createHistory(agent);

        const asked = await postTurn(agent, historyId, {
          prompt: "Send the weekly report",
          surface: "compact",
        });
        const answered = await postTurn(agent, historyId, {
          buttonId,
          surface: "compact",
          toolCallId: "call_report",
        });

        expect(asked.body.data).toEqual({
          historyId,
          pendingAsk: {
            kind: "confirm",
            simple: {
              buttons: [
                {
                  id: "approve",
                  label: "Send report",
                  response: {action: "accept", content: {confirmed: true}},
                  style: "primary",
                },
                {
                  id: "deny",
                  label: "Not now",
                  response: {action: "accept", content: {confirmed: false}},
                  style: "cancel",
                },
              ],
              handoff: false,
              kind: "confirm",
              text: "Send the weekly report to the team now?",
              toolCallId: "call_report",
            },
            toolCallId: "call_report",
          },
          text: "",
        });
        expect(turnResultSchema.parse(asked.body.data)).toEqual(asked.body.data);
        expect(answered.body.data).toEqual({historyId, text: reply, title: "Workspace setup"});
        expect(conversationOf(modelCall(model, 1)).at(-1)).toEqual({
          content: [
            {
              output: {type: "json", value: {action: "accept", content: {confirmed}}},
              toolCallId: "call_report",
              toolName: "ask_confirm",
              type: "tool-result",
            },
          ],
          role: "tool",
        });
      }
    );

    it.each([
      {
        answer: {action: "accept", content: {changed: false, markdown: "Ship it on Friday."}},
        buttonId: "approve",
        reply: "Posted the draft as is.",
      },
      {answer: {action: "decline"}, buttonId: "cancel", reply: "I left the draft alone."},
    ])(
      "pauses on a markdown card with handoff and resumes with the $buttonId button",
      async ({answer, buttonId, reply}) => {
        const draftInput = {initial: "Ship it on Friday.", prompt: "Edit the release note."};
        const model = createScriptedModel({
          steps: [
            toolCallStep({input: draftInput, toolCallId: "call_note", toolName: "ask_markdown"}),
            textStep(reply),
          ],
        });
        const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
        const historyId = await createHistory(agent);

        const asked = await postTurn(agent, historyId, {prompt: "Draft a release note"});
        const answered = await postTurn(agent, historyId, {buttonId, toolCallId: "call_note"});

        expect(asked.body.data).toEqual({
          historyId,
          pendingAsk: {
            kind: "markdown",
            simple: {
              buttons: [
                {
                  id: "approve",
                  label: "Approve draft",
                  response: {
                    action: "accept",
                    content: {changed: false, markdown: "Ship it on Friday."},
                  },
                  style: "primary",
                },
                {id: "cancel", label: "Cancel", response: {action: "decline"}, style: "cancel"},
              ],
              handoff: true,
              kind: "markdown",
              text: "Edit the release note.",
              toolCallId: "call_note",
            },
            toolCallId: "call_note",
          },
          text: "",
        });
        expect(turnResultSchema.parse(asked.body.data)).toEqual(asked.body.data);
        expect(answered.body.data).toEqual({historyId, text: reply, title: "Workspace setup"});
        expect(conversationOf(modelCall(model, 1)).at(-1)).toEqual({
          content: [
            {
              output: {type: "json", value: answer},
              toolCallId: "call_note",
              toolName: "ask_markdown",
              type: "tool-result",
            },
          ],
          role: "tool",
        });
      }
    );

    it.each([
      {
        answer: {action: "accept", content: {values: {email: "billing@acme.test", seats: 5}}},
        buttonId: "submit-defaults",
        reply: "Sent the invoice to billing@acme.test.",
      },
      {answer: {action: "decline"}, buttonId: "cancel", reply: "I left the invoice alone."},
    ])(
      "pauses on a form card with handoff and resumes with the $buttonId button",
      async ({answer, buttonId, reply}) => {
        const formInput = {
          fields: [
            {
              default: "billing@acme.test",
              id: "email",
              label: "Email",
              required: true,
              type: "email",
            },
            {default: 5, id: "seats", integer: true, label: "Seats", min: 1, type: "number"},
            {id: "po", label: "PO number", type: "text"},
          ],
          prompt: "Where should I send the invoice?",
        };
        const model = createScriptedModel({
          steps: [
            toolCallStep({input: formInput, toolCallId: "call_invoice", toolName: "ask_form"}),
            textStep(reply),
          ],
        });
        const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
        const historyId = await createHistory(agent);

        const asked = await postTurn(agent, historyId, {prompt: "Invoice details"});
        const answered = await postTurn(agent, historyId, {buttonId, toolCallId: "call_invoice"});

        expect(asked.body.data).toEqual({
          historyId,
          pendingAsk: {
            kind: "form",
            simple: {
              buttons: [
                {
                  id: "submit-defaults",
                  label: "Submit defaults",
                  response: {
                    action: "accept",
                    content: {values: {email: "billing@acme.test", seats: 5}},
                  },
                  style: "primary",
                },
                {id: "cancel", label: "Cancel", response: {action: "decline"}, style: "cancel"},
              ],
              handoff: true,
              kind: "form",
              text: "Where should I send the invoice?",
              toolCallId: "call_invoice",
            },
            toolCallId: "call_invoice",
          },
          text: "",
        });
        expect(turnResultSchema.parse(asked.body.data)).toEqual(asked.body.data);
        expect(answered.body.data).toEqual({historyId, text: reply, title: "Workspace setup"});
        expect(conversationOf(modelCall(model, 1)).at(-1)).toEqual({
          content: [
            {
              output: {type: "json", value: answer},
              toolCallId: "call_invoice",
              toolName: "ask_form",
              type: "tool-result",
            },
          ],
          role: "tool",
        });
      }
    );

    it("resumes with a full askResponse, as a client that renders the ask sends it", async () => {
      const model = createScriptedModel({
        steps: [toolCallStep(PLAN_ASK_CALL), textStep(TEAM_REPLY)],
      });
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await pauseOnPlanAsk(agent);

      const res = await postTurn(agent, historyId, {
        askResponse: {toolCallId: "call_plan", ...TEAM_ANSWER},
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({historyId, text: TEAM_REPLY, title: "Workspace setup"});
      expect(rowsOf(await loadHistory(historyId))).toEqual(ANSWERED_PLAN_ROWS);
      expect(systemPromptOf(modelCall(model, 1))).not.toContain(COMPACT_SURFACE_SYSTEM_PROMPT);
    });

    it("cancels the pending ask when a prompt arrives, and returns the reply", async () => {
      const model = createScriptedModel({
        steps: [toolCallStep(PLAN_ASK_CALL), textStep("Team is $20 per seat.")],
      });
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await pauseOnPlanAsk(agent);

      const res = await postTurn(agent, historyId, {prompt: "What does Team cost?"});

      expect(res.body.data).toEqual({
        historyId,
        text: "Team is $20 per seat.",
        title: "Workspace setup",
      });
      const history = await loadHistory(historyId);
      expect(history.pendingAsk).toBeUndefined();
      expect(rowsOf(history).slice(1, 3)).toEqual([
        {...PLAN_ASK_ROW, ask: {kind: "choice", status: "cancelled"}},
        {...TEAM_ANSWER_ROW, result: {action: "cancel", reason: "user_sent_message"}},
      ]);
    });

    it("returns the error in the result when the model fails after the turn starts, and keeps the answer", async () => {
      const model = createScriptedModel({steps: [toolCallStep(PLAN_ASK_CALL)]});
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await pauseOnPlanAsk(agent);
      model.doStream.mockImplementationOnce(async () => {
        throw new Error("The model is overloaded");
      });

      const res = await postTurn(agent, historyId, TEAM_BUTTON);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({error: "The model is overloaded", historyId, text: ""});
      const history = await loadHistory(historyId);
      expect(history.pendingAsk).toBeUndefined();
      expect(rowsOf(history).at(-1)).toEqual(TEAM_ANSWER_ROW);
    });

    it("returns the error and keeps the message when the model stream fails mid-reply", async () => {
      const model = createScriptedModel({
        steps: [failingTextStep("Setting up", "Connection reset")],
      });
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await createHistory(agent);

      const res = await postTurn(agent, historyId, {prompt: USER_PROMPT});

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({error: "Connection reset", historyId, text: ""});
      expect(rowsOf(await loadHistory(historyId))).toEqual([{text: USER_PROMPT, type: "user"}]);
    });

    it("finishes and saves the turn when the client disconnects mid-turn", async () => {
      const arrived = deferred();
      const release = deferred();
      const model = createScriptedModel({
        holds: {1: {arrived, release: release.promise}},
        steps: [toolCallStep(PLAN_ASK_CALL), textStep(TEAM_REPLY)],
      });
      const served = await serveApp(buildApp({asks: true, model}));
      try {
        const agent = await authAsUser(served.url, "notAdmin");
        const historyId = await pauseOnPlanAsk(agent);
        const request = postTurn(agent, historyId, {...TEAM_BUTTON, surface: "compact"});
        const outcome = request.then(
          () => "responded",
          (error: Error) => error.message
        );
        await arrived.promise;

        request.abort();

        expect(await outcome).toBe("Aborted");
        expect((await loadHistory(historyId)).title).toBeUndefined();
        release.resolve();
        const history = await waitForTitle(historyId);
        expect(history.pendingAsk).toBeUndefined();
        expect(rowsOf(history)).toEqual(ANSWERED_PLAN_ROWS);
      } finally {
        release.resolve();
        await served.close();
      }
    });
  });

  describe("rejected turns", () => {
    it("returns 400 UNKNOWN_BUTTON for a button that is not on the card, and keeps the ask pending", async () => {
      const model = createScriptedModel({steps: [toolCallStep(PLAN_ASK_CALL)]});
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await pauseOnPlanAsk(agent);

      const res = await postTurn(agent, historyId, {
        buttonId: "option:gold",
        toolCallId: "call_plan",
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        code: "UNKNOWN_BUTTON",
        detail: "The button is not on the pending ask's simple card. See fields.",
        meta: {
          fields: [
            {
              code: "UNKNOWN_BUTTON",
              fix: 'Send the id of one of the card\'s buttons: "option:team", "option:starter", "option:enterprise".',
              message: 'Button "option:gold" is not on the pending ask\'s simple card.',
              path: "buttonId",
            },
          ],
        },
        requestId: expect.any(String),
        status: 400,
        title: "Unknown buttonId",
      });
      expect(model.doStream).toHaveBeenCalledTimes(1);
      expect((await loadHistory(historyId)).pendingAsk?.toolCallId).toBe("call_plan");
    });

    it("returns 409 for a toolCallId that is not the pending ask, and for an ask already answered", async () => {
      const model = createScriptedModel({
        steps: [toolCallStep(PLAN_ASK_CALL), textStep(TEAM_REPLY)],
      });
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await pauseOnPlanAsk(agent);

      const wrongAsk = await postTurn(agent, historyId, {...TEAM_BUTTON, toolCallId: "call_old"});
      await postTurn(agent, historyId, TEAM_BUTTON);
      const answeredTwice = await postTurn(agent, historyId, TEAM_BUTTON);
      const answerAfterAnswer = await postTurn(agent, historyId, {
        askResponse: {toolCallId: "call_plan", ...TEAM_ANSWER},
      });

      expect(wrongAsk.status).toBe(409);
      expect(wrongAsk.body).toEqual({
        detail: "Tool call call_old is not the ask this conversation is waiting on.",
        requestId: expect.any(String),
        status: 409,
        title: "This ask is no longer pending",
      });
      for (const res of [answeredTwice, answerAfterAnswer]) {
        expect(res.status).toBe(409);
        expect(res.body.title).toBe("This ask is no longer pending");
      }
      expect(model.doStream).toHaveBeenCalledTimes(2);
    });

    it("returns 403 to another user and to an admin, without running the turn", async () => {
      const model = createScriptedModel({steps: [toolCallStep(PLAN_ASK_CALL)]});
      const app = buildApp({asks: true, model});
      const owner = await authAsUser(app, "notAdmin");
      const historyId = await pauseOnPlanAsk(owner);
      const otherUser = await authAsUserWithCredentials(app, OTHER_USER);
      const admin = await authAsUser(app, "admin");

      const fromOtherUser = await postTurn(otherUser, historyId, TEAM_BUTTON);
      const fromAdmin = await postTurn(admin, historyId, TEAM_BUTTON);

      expect(fromOtherUser.status).toBe(403);
      expect(fromOtherUser.body).toMatchObject({
        code: "action-access-denied",
        title: "Access denied",
      });
      expect(fromAdmin.status).toBe(403);
      expect(fromAdmin.body.title).toBe("Not authorized to access this history");
      expect(model.doStream).toHaveBeenCalledTimes(1);
      expect((await loadHistory(historyId)).pendingAsk?.toolCallId).toBe("call_plan");
    });

    it("returns 404 for an unknown history", async () => {
      const model = createScriptedModel({steps: []});
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");

      const res = await postTurn(agent, "6710c2a1f1e2d3c4b5a69788", {prompt: "Hi"});

      expect(res.status).toBe(404);
      expect(model.doStream).not.toHaveBeenCalled();
    });

    it("returns 400 with fields for an askResponse that does not fit the ask", async () => {
      const model = createScriptedModel({steps: [toolCallStep(PLAN_ASK_CALL)]});
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await pauseOnPlanAsk(agent);

      const res = await postTurn(agent, historyId, {
        askResponse: {action: "accept", content: {selected: ["gold"]}, toolCallId: "call_plan"},
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        detail: "The answer does not match the ask. See fields.",
        meta: {
          fields: [
            {
              code: "OPTION_NOT_OFFERED",
              fix: "Use the id of one of the ask's options.",
              message: '"gold" is not one of the offered options.',
              path: "content.selected[0]",
            },
          ],
        },
        requestId: expect.any(String),
        status: 400,
        title: "Invalid askResponse",
      });
      expect(model.doStream).toHaveBeenCalledTimes(1);
    });

    const oneShape = "Send only one of prompt, askResponse, or toolCallId with buttonId.";

    it.each([
      {
        body: {},
        fields: {prompt: "Send one of prompt, askResponse, or toolCallId with buttonId."},
        name: "empty",
      },
      {
        body: {buttonId: "option:team", prompt: "Team"},
        fields: {buttonId: oneShape, prompt: oneShape},
        name: "two turn shapes",
      },
      {
        body: {buttonId: "option:team"},
        fields: {toolCallId: "Send toolCallId with buttonId."},
        name: "a buttonId without its toolCallId",
      },
      {
        body: {prompt: "Hi", surface: "watch"},
        fields: {surface: 'Invalid option: expected one of "full"|"compact"'},
        name: "an unknown surface",
      },
    ])("returns 400 with fields for a body that is $name", async ({body, fields}) => {
      const model = createScriptedModel({steps: []});
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await createHistory(agent);

      const res = await postTurn(agent, historyId, body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        code: "action-body-validation-failed",
        detail: "The request body did not match the action's schema",
        meta: {fields},
        requestId: expect.any(String),
        status: 400,
        title: "Validation failed",
      });
      expect(model.doStream).not.toHaveBeenCalled();
    });

    it("rejects a body with a key the turn does not define", async () => {
      const model = createScriptedModel({steps: []});
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await createHistory(agent);

      const res = await postTurn(agent, historyId, {buttonID: "option:team", prompt: "Hi"});

      expect(res.status).toBe(400);
      expect(res.body.title).toBe("Validation failed");
      expect(model.doStream).not.toHaveBeenCalled();
    });
  });

  describe("GET /gpt/histories/pendingAsks", () => {
    it("lists the caller's pending asks, newest first, without other users' or deleted conversations", async () => {
      const model = createScriptedModel({
        steps: [
          textStep("Hello."),
          toolCallStep(PLAN_ASK_CALL),
          toolCallStep(REGION_ASK_CALL),
          toolCallStep(PLAN_ASK_CALL),
          toolCallStep(PLAN_ASK_CALL),
          textStep("Hello."),
        ],
      });
      const app = buildApp({asks: true, model});
      const owner = await authAsUser(app, "notAdmin");
      const otherUser = await authAsUserWithCredentials(app, OTHER_USER);
      const empty = await owner.get("/gpt/histories/pendingAsks");
      const titled = await createHistory(owner);
      await postTurn(owner, titled, {prompt: "Hi"});
      await postTurn(owner, titled, {prompt: USER_PROMPT});
      const newest = await createHistory(owner);
      await postTurn(owner, newest, {prompt: "Where should my data live?"});
      await pauseOnPlanAsk(otherUser);
      const deleted = await pauseOnPlanAsk(owner);
      await GptHistory.updateOne({_id: deleted}, {deleted: true});
      const answered = await createHistory(owner);
      await postTurn(owner, answered, {prompt: "Hi"});

      const res = await owner.get("/gpt/histories/pendingAsks");

      expect(empty.status).toBe(200);
      expect(empty.body.data).toEqual([]);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        {
          created: expect.any(String),
          historyId: newest,
          kind: "choice",
          simple: REGION_SIMPLE_CARD,
          toolCallId: "call_region",
        },
        {
          created: expect.any(String),
          historyId: titled,
          kind: "choice",
          simple: PLAN_SIMPLE_CARD,
          title: "Workspace setup",
          toolCallId: "call_plan",
        },
      ]);
      expect(pendingAskListSchema.parse(res.body.data)).toEqual(res.body.data);
      const [newer, older] = res.body.data.map((item: {created: string}) =>
        DateTime.fromISO(item.created)
      );
      expect(newer > older).toBe(true);
      expect(newer.diffNow().as("minutes")).toBeGreaterThan(-1);
    });
  });

  describe("OpenAPI", () => {
    it("documents pendingAsks and turn with their request and response schemas", async () => {
      const agent = await authAsUser(
        buildApp({asks: true, model: createScriptedModel({steps: []})}),
        "notAdmin"
      );

      const res = await agent.get("/openapi.json");

      const pendingAsks = res.body.paths["/gpt/histories/pendingAsks"]?.get;
      const turn = res.body.paths["/gpt/histories/{id}/turn"]?.post;
      expect(pendingAsks).toMatchObject({
        operationId: "gpthistories_pendingAsks",
        summary: "List the caller's pending asks",
      });
      expect(turn).toMatchObject({
        operationId: "gpthistories_turn",
        summary: "Run a chat turn and return the reply as JSON",
      });
      const turnBody = turn.requestBody.content["application/json"].schema;
      expect(Object.keys(turnBody.properties).sort()).toEqual([
        "askResponse",
        "buttonId",
        "prompt",
        "surface",
        "toolCallId",
      ]);
      expect(turnBody.properties.surface).toMatchObject({enum: ["full", "compact"]});
      const turnData = turn.responses["200"].content["application/json"].schema.properties.data;
      expect(Object.keys(turnData.properties).sort()).toEqual([
        "error",
        "historyId",
        "pendingAsk",
        "text",
        "title",
      ]);
      const pendingAsksData =
        pendingAsks.responses["200"].content["application/json"].schema.properties.data;
      expect(pendingAsksData.type).toBe("array");
      expect(Object.keys(pendingAsksData.items.properties).sort()).toEqual([
        "created",
        "historyId",
        "kind",
        "simple",
        "title",
        "toolCallId",
      ]);
    });
  });

  describe("published JSON Schemas", () => {
    /** Rebuilds a published document as a validator, standing in for a native client's decoder. */
    const validatorFor = (fileName: string) => {
      const document = askJsonSchemas()[fileName];
      if (!document) {
        throw new Error(`@terreno/blocks publishes no ${fileName}.`);
      }
      return z.fromJSONSchema(document as Parameters<typeof z.fromJSONSchema>[0]);
    };

    it("describe the whole response bodies of turn and pendingAsks, requestId included", async () => {
      const model = createScriptedModel({
        steps: [toolCallStep(PLAN_ASK_CALL), textStep(TEAM_REPLY)],
      });
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");
      const historyId = await createHistory(agent);

      const asked = await postTurn(agent, historyId, {prompt: USER_PROMPT, surface: "compact"});
      const listed = await agent.get("/gpt/histories/pendingAsks");
      const answered = await postTurn(agent, historyId, {...TEAM_BUTTON, surface: "compact"});

      const turnResponse = validatorFor("turnResponse.schema.json");
      const pendingAsksResponse = validatorFor("pendingAsksResponse.schema.json");
      expect(listed.body.data).toHaveLength(1);
      for (const res of [asked, listed, answered]) {
        expect(res.body.requestId).toEqual(expect.any(String));
      }
      expect(turnResponse.safeParse(asked.body).error).toBeUndefined();
      expect(turnResponse.safeParse(answered.body).error).toBeUndefined();
      expect(pendingAsksResponse.safeParse(listed.body).error).toBeUndefined();
    });
  });

  describe("route options", () => {
    const historyApp = (validation?: ModelRouterOptions<GptHistoryDocument>["validation"]) =>
      new TerrenoApp({
        configureApp: (router, options) => {
          addGptHistoryRoutes(router, {...options, validation});
        },
        skipListen: true,
        userModel: UserModel,
      }).build();

    afterEach(() => {
      resetOpenApiValidatorConfig();
    });

    it("creates a history from an empty body when the host validates request bodies", async () => {
      configureOpenApiValidator();
      const agent = await authAsUser(historyApp(), "notAdmin");

      const created = await agent.post("/gpt/histories").send({});

      expect(created.status).toBe(201);
      const read = await agent.get(`/gpt/histories/${created.body.data._id}`);
      expect(read.status).toBe(200);
    });

    it("keeps the host's validation options", async () => {
      configureOpenApiValidator();
      const onAdditionalPropertiesRemoved = mock((_properties: string[]) => {});
      const agent = await authAsUser(historyApp({onAdditionalPropertiesRemoved}), "notAdmin");

      const created = await agent.post("/gpt/histories").send({extra: true});

      expect(created.status).toBe(201);
      expect(onAdditionalPropertiesRemoved).toHaveBeenCalledTimes(1);
      expect(onAdditionalPropertiesRemoved.mock.calls[0]?.[0]).toEqual(["extra"]);
    });

    it("keeps request validation off when the host turns it off", async () => {
      configureOpenApiValidator();
      const agent = await authAsUser(historyApp(false), "notAdmin");

      const created = await agent.post("/gpt/histories").send({extra: true});

      expect(created.status).toBe(400);
      expect(created.body.title).not.toBe("Request validation failed");
    });

    it("adds no headless actions without chat options", async () => {
      const app = new TerrenoApp({
        configureApp: (router, options) => {
          addGptHistoryRoutes(router, options);
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(app, "notAdmin");

      const res = await agent.get("/openapi.json");

      const historyPaths = Object.keys(res.body.paths).filter((path) =>
        path.startsWith("/gpt/histories")
      );
      expect(historyPaths.sort()).toEqual(["/gpt/histories/", "/gpt/histories/{id}"]);
    });

    it("adds no headless actions when the chat options leave asks off", async () => {
      const model = createScriptedModel({steps: [textStep("Hello.")]});
      const app = new TerrenoApp({
        configureApp: (router, options) => {
          addGptHistoryRoutes(router, {
            ...options,
            chat: {aiService: new AIService({model: model as unknown as LanguageModel})},
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(app, "notAdmin");
      const historyId = await createHistory(agent);

      const res = await agent.get("/openapi.json");
      const pendingAsks = await agent.get("/gpt/histories/pendingAsks");
      await postTurn(agent, historyId, {prompt: "Hi"});

      const historyPaths = Object.keys(res.body.paths).filter((path) =>
        path.startsWith("/gpt/histories")
      );
      expect(historyPaths.sort()).toEqual(["/gpt/histories/", "/gpt/histories/{id}"]);
      expect(pendingAsks.status).toBe(404);
      expect(model.doStream).not.toHaveBeenCalled();
    });

    it("keeps the host's collection and instance actions next to pendingAsks and turn", async () => {
      const model = createScriptedModel({steps: [textStep("Hello.")]});
      const app = new TerrenoApp({
        configureApp: (router, options) => {
          addGptHistoryRoutes(router, {
            ...options,
            chat: {
              aiService: new AIService({model: model as unknown as LanguageModel}),
              asks: true,
            },
            collectionActions: {
              count: {
                handler: async () => ({count: 7}),
                method: "GET",
                permissions: [Permissions.IsAuthenticated],
              },
            },
            instanceActions: {
              archive: {
                handler: async ({doc}) => ({archived: doc._id.toString()}),
                method: "POST",
                permissions: [Permissions.IsOwner],
              },
            },
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(app, "notAdmin");
      const historyId = await createHistory(agent);

      const count = await agent.get("/gpt/histories/count");
      const archive = await agent.post(`/gpt/histories/${historyId}/archive`);
      const pendingAsks = await agent.get("/gpt/histories/pendingAsks");
      const turn = await postTurn(agent, historyId, {prompt: "Hi"});

      expect(count.body.data).toEqual({count: 7});
      expect(archive.body.data).toEqual({archived: historyId});
      expect(pendingAsks.body.data).toEqual([]);
      expect(turn.body.data).toEqual({historyId, text: "Hello.", title: "Workspace setup"});
    });
  });
});
