import {afterEach, beforeAll, describe, expect, it, mock} from "bun:test";
import {jsonSchema, tool} from "ai";

import {AIRequest} from "../models/aiRequest";
import {GptHistory} from "../models/gptHistory";
import {
  type Agent,
  buildApp,
  conversationOf,
  createScriptedModel,
  loadHistory,
  type ModelPromptMessage,
  modelCall,
  ONE_ASK_AT_A_TIME,
  onlyHistoryId,
  PLAN_ASK_CALL,
  PLAN_ASK_ROW,
  pendingAskOf,
  rowsOf,
  type ScriptedModel,
  streamPrompt,
  TEAM_ANSWER,
  textStep,
  toolCallStep,
} from "../tests/chatHarness";
import {authAsUser, ensureTestUsers} from "../tests/helpers";
import type {GptRouteOptions} from "../types";

const DELETE_DESCRIPTION = "Delete the user's completed todos.";
const DELETE_INPUT = {scope: "completed"};
const DELETE_CALL = {
  input: DELETE_INPUT,
  toolCallId: "call_delete",
  toolName: "deleteCompletedTodos",
};
const ARCHIVE_CALL = {input: {}, toolCallId: "call_archive", toolName: "archiveTodos"};
const DELETED = {deleted: 2};
const USER_PROMPT = "Delete my completed todos";
const DELETED_REPLY = "Deleted 2 completed todos.";
const TITLE = "Workspace setup";

const DEFAULT_APPROVAL_INPUT = {
  confirmLabel: "Allow",
  denyLabel: "Deny",
  prompt: `Allow deleteCompletedTodos? ${DELETE_DESCRIPTION}`,
};

const DESTRUCTIVE_APPROVAL_INPUT = {
  confirmLabel: "Delete",
  denyLabel: "Keep them",
  destructive: true,
  prompt: "Delete all completed todos?",
  title: "Clean up todos",
};

const APPROVE = {action: "accept", content: {confirmed: true}};
const DENY = {action: "accept", content: {confirmed: false}};

interface HostTools {
  archive: ReturnType<typeof mock>;
  execute: ReturnType<typeof mock>;
  tools: GptRouteOptions["tools"];
}

const hostTools = (): HostTools => {
  const execute = mock(async () => DELETED);
  const archive = mock(async () => ({archived: 1}));
  return {
    archive,
    execute,
    tools: {
      archiveTodos: tool({
        description: "Archive the user's old todos.",
        execute: archive,
        inputSchema: jsonSchema<Record<string, never>>({properties: {}, type: "object"}),
        needsApproval: true,
      }),
      deleteCompletedTodos: tool({
        description: DELETE_DESCRIPTION,
        execute,
        inputSchema: jsonSchema<{scope: string}>({
          properties: {scope: {type: "string"}},
          type: "object",
        }),
        needsApproval: true,
      }),
    },
  };
};

interface PausedApproval {
  agent: Agent;
  approvalId: string;
  events: Record<string, unknown>[];
  historyId: string;
  host: HostTools;
  model: ScriptedModel;
}

const pauseOnApproval = async ({
  prompt = USER_PROMPT,
  steps = [toolCallStep(DELETE_CALL), textStep(DELETED_REPLY)],
  surface,
  ...routeOptions
}: {
  prompt?: string;
  steps?: ReturnType<typeof textStep>[];
  surface?: string;
} & Partial<GptRouteOptions>): Promise<PausedApproval> => {
  const host = hostTools();
  const model = createScriptedModel({steps});
  const agent = await authAsUser(
    buildApp({asks: true, model, tools: host.tools, ...routeOptions}),
    "notAdmin"
  );
  const {events} = await streamPrompt(agent, {prompt, ...(surface ? {surface} : {})});
  const askEvent = events.find((event) => "ask" in event) as
    | {ask: {toolCallId: string}}
    | undefined;
  if (!askEvent) {
    expect.unreachable(`The turn did not pause: ${JSON.stringify(events)}`);
  }
  return {
    agent,
    approvalId: askEvent.ask.toolCallId,
    events,
    historyId: await onlyHistoryId(),
    host,
    model,
  };
};

const answer = (
  {agent, approvalId, historyId}: Pick<PausedApproval, "agent" | "approvalId" | "historyId">,
  response: Record<string, unknown>
) => streamPrompt(agent, {askResponse: {...response, toolCallId: approvalId}, historyId});

const toolMessagesOf = (conversation: ModelPromptMessage[]): unknown[] =>
  conversation.filter((message) => message.role === "tool").flatMap((message) => message.content);

const toolResultFor = (model: ScriptedModel, index: number, toolCallId: string): unknown => {
  const part = toolMessagesOf(conversationOf(modelCall(model, index))).find(
    (candidate) => (candidate as {toolCallId?: string}).toolCallId === toolCallId
  ) as {output?: unknown} | undefined;
  if (!part) {
    expect.unreachable(`Model call ${index} has no result for ${toolCallId}`);
  }
  return part.output;
};

const eventKeys = (events: Record<string, unknown>[]): string[] =>
  events.map((event) => Object.keys(event)[0]);

describe("host tools that need approval", () => {
  beforeAll(async () => {
    await ensureTestUsers();
  });

  afterEach(async () => {
    await AIRequest.deleteMany({});
    await GptHistory.deleteMany({});
  });

  describe("pause", () => {
    it("pauses on a server-made confirm and does not run the tool", async () => {
      const {approvalId, events, historyId, host, model} = await pauseOnApproval({});

      expect(approvalId).not.toBe("call_delete");
      expect(host.execute).not.toHaveBeenCalled();
      expect(model.doStream).toHaveBeenCalledTimes(1);
      expect(events).toEqual([
        {
          toolCall: {
            args: DELETE_INPUT,
            toolCallId: "call_delete",
            toolName: "deleteCompletedTodos",
          },
        },
        {
          ask: {
            input: DEFAULT_APPROVAL_INPUT,
            kind: "confirm",
            origin: "approval",
            simple: {
              buttons: [
                {
                  id: "approve",
                  label: "Allow",
                  response: APPROVE,
                  style: "primary",
                },
                {id: "deny", label: "Deny", response: DENY, style: "cancel"},
              ],
              handoff: false,
              kind: "confirm",
              text: DEFAULT_APPROVAL_INPUT.prompt,
              toolCallId: approvalId,
            },
            toolCallId: approvalId,
            toolName: "deleteCompletedTodos",
          },
          historyId,
        },
        {done: true, historyId, pendingAsk: {toolCallId: approvalId}},
      ]);

      const history = await loadHistory(historyId);
      expect(rowsOf(history)).toEqual([
        {text: USER_PROMPT, type: "user"},
        {
          args: DELETE_INPUT,
          text: "Tool call: deleteCompletedTodos",
          toolCallId: "call_delete",
          toolName: "deleteCompletedTodos",
          type: "tool-call",
        },
        {
          args: DEFAULT_APPROVAL_INPUT,
          ask: {kind: "confirm", origin: "approval", status: "pending"},
          text: "Tool call: deleteCompletedTodos",
          toolCallId: approvalId,
          toolName: "deleteCompletedTodos",
          type: "tool-call",
        },
      ]);
      expect(pendingAskOf(history)).toMatchObject({
        approvalId,
        input: DEFAULT_APPROVAL_INPUT,
        kind: "confirm",
        origin: "approval",
        promptIndex: 1,
        toolCallId: approvalId,
        toolName: "deleteCompletedTodos",
      });

      const [request] = await AIRequest.find({});
      expect(request?.metadata).toEqual({
        ask: {
          kind: "confirm",
          origin: "approval",
          phase: "asked",
          toolCallId: approvalId,
          toolName: "deleteCompletedTodos",
        },
      });
    });

    it("asks with the host's approval input, with a destructive approve first", async () => {
      const approval = mock(() => DESTRUCTIVE_APPROVAL_INPUT);
      const {approvalId, events} = await pauseOnApproval({
        asks: {approvals: {deleteCompletedTodos: approval}},
      });

      expect(approval).toHaveBeenCalledWith(DELETE_INPUT);
      const {ask} = events.find((event) => "ask" in event) as {ask: Record<string, unknown>};
      expect(ask.input).toEqual(DESTRUCTIVE_APPROVAL_INPUT);
      expect(ask.simple).toMatchObject({
        buttons: [
          {id: "approve", label: "Delete", style: "destructive"},
          {id: "deny", label: "Keep them", style: "cancel"},
        ],
        title: "Clean up todos",
        toolCallId: approvalId,
      });
    });

    it.each([
      [
        "returns an invalid input",
        () => ({confirmLabel: "Same", denyLabel: "Same", prompt: "Go?"}),
      ],
      [
        "throws",
        () => {
          throw new Error("approval prompt failed");
        },
      ],
    ])("falls back to the default approval when asks.approvals %s", async (_case, approval) => {
      const {events, host} = await pauseOnApproval({
        asks: {approvals: {deleteCompletedTodos: approval}},
      });

      const {ask} = events.find((event) => "ask" in event) as {ask: Record<string, unknown>};
      expect(ask.input).toEqual(DEFAULT_APPROVAL_INPUT);
      expect(host.execute).not.toHaveBeenCalled();
    });

    it("pauses on the compact surface with the same confirm card", async () => {
      const {events, historyId} = await pauseOnApproval({surface: "compact"});

      const {ask} = events.find((event) => "ask" in event) as {ask: Record<string, unknown>};
      expect(ask).toMatchObject({
        input: DEFAULT_APPROVAL_INPUT,
        kind: "confirm",
        origin: "approval",
      });
      expect(pendingAskOf(await loadHistory(historyId))).toMatchObject({origin: "approval"});
    });

    it("never runs the tool when asks are off, because nothing can approve it", async () => {
      const host = hostTools();
      const model = createScriptedModel({steps: [toolCallStep(DELETE_CALL)]});
      const agent = await authAsUser(buildApp({model, tools: host.tools}), "notAdmin");

      const {events} = await streamPrompt(agent, {prompt: USER_PROMPT});

      expect(eventKeys(events)).toEqual(["toolCall", "done"]);
      expect(host.execute).not.toHaveBeenCalled();
      expect((await loadHistory(await onlyHistoryId())).pendingAsk).toBeUndefined();
    });
  });

  describe("answer", () => {
    it("approving runs the tool once and the model sees its result", async () => {
      const paused = await pauseOnApproval({});
      const {approvalId, historyId, host, model} = paused;

      const {events} = await answer(paused, APPROVE);

      expect(host.execute).toHaveBeenCalledTimes(1);
      expect(host.execute.mock.calls[0]?.[0]).toEqual(DELETE_INPUT);
      expect(events).toEqual([
        {askResolved: {action: "accept", toolCallId: approvalId}},
        {
          toolResult: {
            result: DELETED,
            toolCallId: "call_delete",
            toolName: "deleteCompletedTodos",
          },
        },
        {text: DELETED_REPLY},
        {done: true, historyId, title: TITLE},
      ]);
      expect(toolResultFor(model, 1, "call_delete")).toEqual({type: "json", value: DELETED});

      const history = await loadHistory(historyId);
      expect(history.pendingAsk).toBeUndefined();
      expect(rowsOf(history).slice(2)).toEqual([
        {
          args: DEFAULT_APPROVAL_INPUT,
          ask: {kind: "confirm", origin: "approval", status: "answered"},
          text: "Tool call: deleteCompletedTodos",
          toolCallId: approvalId,
          toolName: "deleteCompletedTodos",
          type: "tool-call",
        },
        {
          result: APPROVE,
          text: "Tool result: deleteCompletedTodos",
          toolCallId: approvalId,
          toolName: "deleteCompletedTodos",
          type: "tool-result",
        },
        {
          result: DELETED,
          text: "Tool result: deleteCompletedTodos",
          toolCallId: "call_delete",
          toolName: "deleteCompletedTodos",
          type: "tool-result",
        },
        {model: "scripted-model", text: DELETED_REPLY, type: "assistant"},
      ]);

      const answered = await AIRequest.findOne({prompt: JSON.stringify(APPROVE)});
      expect(answered?.metadata).toEqual({
        ask: {
          action: "accept",
          kind: "confirm",
          origin: "approval",
          phase: "answered",
          toolCallId: approvalId,
          toolName: "deleteCompletedTodos",
        },
      });
    });

    it.each([
      ["denying", DENY, {}, "user_denied"],
      ["declining", {action: "decline"}, {allowDecline: true}, "user_declined"],
      ["cancelling", {action: "cancel", reason: "closed_the_card"}, {}, "closed_the_card"],
    ])(
      "%s never runs the tool and the model sees the denial",
      async (_case, response, extraInput, reason) => {
        const paused = await pauseOnApproval({
          asks: {
            approvals: {deleteCompletedTodos: () => ({...DEFAULT_APPROVAL_INPUT, ...extraInput})},
          },
          steps: [toolCallStep(DELETE_CALL), textStep("Okay, I left them.")],
        });

        const {events} = await answer(paused, response);

        expect(paused.host.execute).not.toHaveBeenCalled();
        expect(eventKeys(events)).toEqual(["askResolved", "toolResult", "text", "done"]);
        expect(events[1]).toEqual({
          toolResult: {
            result: {approved: false, reason},
            toolCallId: "call_delete",
            toolName: "deleteCompletedTodos",
          },
        });
        expect(toolResultFor(paused.model, 1, "call_delete")).toMatchObject({reason});
        expect(JSON.stringify(toolResultFor(paused.model, 1, "call_delete"))).not.toContain(
          "deleted"
        );
      }
    );

    it("a new message cancels the pending approval and the tool never runs", async () => {
      const paused = await pauseOnApproval({
        steps: [toolCallStep(DELETE_CALL), textStep("Sure, what next?")],
      });

      const {events} = await streamPrompt(paused.agent, {
        historyId: paused.historyId,
        prompt: "Never mind",
      });

      expect(paused.host.execute).not.toHaveBeenCalled();
      expect(events[0]).toEqual({askResolved: {action: "cancel", toolCallId: paused.approvalId}});
      const history = await loadHistory(paused.historyId);
      expect(history.pendingAsk).toBeUndefined();
      expect(rowsOf(history).slice(2, 4)).toEqual([
        {
          args: DEFAULT_APPROVAL_INPUT,
          ask: {kind: "confirm", origin: "approval", status: "cancelled"},
          text: "Tool call: deleteCompletedTodos",
          toolCallId: paused.approvalId,
          toolName: "deleteCompletedTodos",
          type: "tool-call",
        },
        {
          result: {action: "cancel", reason: "user_sent_message"},
          text: "Tool result: deleteCompletedTodos",
          toolCallId: paused.approvalId,
          toolName: "deleteCompletedTodos",
          type: "tool-result",
        },
      ]);
      // Approval rows are display-only, so the next turn replays only the user's messages.
      expect(conversationOf(modelCall(paused.model, 1)).map((message) => message.role)).toEqual([
        "user",
        "user",
      ]);
    });

    it("pauses again when the resumed turn asks for another approval", async () => {
      const paused = await pauseOnApproval({
        steps: [toolCallStep(DELETE_CALL), toolCallStep(ARCHIVE_CALL), textStep("All tidy.")],
      });

      const first = await answer(paused, APPROVE);
      const next = first.events.find((event) => "ask" in event) as {
        ask: {toolCallId: string; toolName: string};
      };
      expect(next.ask).toMatchObject({origin: "approval", toolName: "archiveTodos"});
      const resumed = await AIRequest.findOne({prompt: JSON.stringify(APPROVE)});
      expect(resumed?.metadata?.nextAsk).toEqual({
        kind: "confirm",
        origin: "approval",
        phase: "asked",
        toolCallId: next.ask.toolCallId,
        toolName: "archiveTodos",
      });

      const second = await answer({...paused, approvalId: next.ask.toolCallId}, APPROVE);

      expect(eventKeys(second.events)).toEqual(["askResolved", "toolResult", "text", "done"]);
      expect(paused.host.execute).toHaveBeenCalledTimes(1);
      expect(paused.host.archive).toHaveBeenCalledTimes(1);
      expect(toolResultFor(paused.model, 2, "call_archive")).toEqual({
        type: "json",
        value: {archived: 1},
      });
    });

    it("later turns do not replay the approval as a tool call", async () => {
      const paused = await pauseOnApproval({
        steps: [toolCallStep(DELETE_CALL), textStep(DELETED_REPLY), textStep("You're welcome.")],
      });
      await answer(paused, APPROVE);

      await streamPrompt(paused.agent, {historyId: paused.historyId, prompt: "Thanks"});

      expect(conversationOf(modelCall(paused.model, 2)).map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
      ]);
      expect(paused.host.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("one pending ask at a time", () => {
    it("denies every extra approval in the step with one_ask_at_a_time", async () => {
      const paused = await pauseOnApproval({
        steps: [toolCallStep(DELETE_CALL, ARCHIVE_CALL), textStep(DELETED_REPLY)],
      });
      const {historyId, host, model} = paused;
      expect(pendingAskOf(await loadHistory(historyId))).toMatchObject({
        toolName: "deleteCompletedTodos",
      });

      const {events} = await answer(paused, APPROVE);

      expect(host.execute).toHaveBeenCalledTimes(1);
      expect(host.archive).not.toHaveBeenCalled();
      expect(toolResultFor(model, 1, "call_delete")).toEqual({type: "json", value: DELETED});
      expect(toolResultFor(model, 1, "call_archive")).toMatchObject({
        reason: "one_ask_at_a_time",
      });
      expect(events).toContainEqual({
        toolResult: {
          result: {approved: false, reason: "one_ask_at_a_time"},
          toolCallId: "call_archive",
          toolName: "archiveTodos",
        },
      });
    });

    it("denies the approval when an ask comes first in the step", async () => {
      const paused = await (async () => {
        const host = hostTools();
        const model = createScriptedModel({
          steps: [toolCallStep(PLAN_ASK_CALL, DELETE_CALL), textStep("Team it is.")],
        });
        const agent = await authAsUser(
          buildApp({asks: true, model, tools: host.tools}),
          "notAdmin"
        );
        const {events} = await streamPrompt(agent, {prompt: USER_PROMPT});
        return {agent, events, historyId: await onlyHistoryId(), host, model};
      })();
      expect(paused.events.find((event) => "ask" in event)).toMatchObject({
        ask: {kind: "choice", toolCallId: "call_plan"},
      });
      expect(pendingAskOf(await loadHistory(paused.historyId))).not.toHaveProperty("origin");

      await streamPrompt(paused.agent, {
        askResponse: {...TEAM_ANSWER, toolCallId: "call_plan"},
        historyId: paused.historyId,
      });

      expect(paused.host.execute).not.toHaveBeenCalled();
      expect(toolResultFor(paused.model, 1, "call_plan")).toEqual({
        type: "json",
        value: TEAM_ANSWER,
      });
      expect(toolResultFor(paused.model, 1, "call_delete")).toMatchObject({
        reason: "one_ask_at_a_time",
      });
    });

    it("cancels the ask when an approval comes first in the step", async () => {
      const paused = await pauseOnApproval({
        steps: [toolCallStep(DELETE_CALL, PLAN_ASK_CALL), textStep(DELETED_REPLY)],
      });
      const rows = rowsOf(await loadHistory(paused.historyId));
      expect(rows).toContainEqual({...PLAN_ASK_ROW, ask: {kind: "choice", status: "cancelled"}});
      expect(rows).toContainEqual({
        result: ONE_ASK_AT_A_TIME,
        text: "Tool result: ask_choice",
        toolCallId: "call_plan",
        toolName: "ask_choice",
        type: "tool-result",
      });

      await answer(paused, APPROVE);

      expect(paused.host.execute).toHaveBeenCalledTimes(1);
      expect(toolResultFor(paused.model, 1, "call_plan")).toEqual({
        type: "json",
        value: ONE_ASK_AT_A_TIME,
      });
      expect(toolResultFor(paused.model, 1, "call_delete")).toEqual({type: "json", value: DELETED});
    });
  });

  describe("headless turn", () => {
    it("the approve button runs the tool once", async () => {
      const host = hostTools();
      const model = createScriptedModel({
        steps: [toolCallStep(DELETE_CALL), textStep(DELETED_REPLY)],
      });
      const agent = await authAsUser(buildApp({asks: true, model, tools: host.tools}), "notAdmin");
      const created = await agent.post("/gpt/histories").send({});
      const historyId = created.body.data._id as string;

      const asked = await agent
        .post(`/gpt/histories/${historyId}/turn`)
        .send({prompt: USER_PROMPT});
      expect(asked.status).toBe(200);
      const {pendingAsk} = asked.body.data;
      expect(pendingAsk).toMatchObject({kind: "confirm", simple: {kind: "confirm"}});
      expect(host.execute).not.toHaveBeenCalled();

      const listed = await agent.get("/gpt/histories/pendingAsks");
      expect(listed.body.data).toMatchObject([
        {historyId, kind: "confirm", toolCallId: pendingAsk.toolCallId},
      ]);

      const approved = await agent
        .post(`/gpt/histories/${historyId}/turn`)
        .send({buttonId: "approve", toolCallId: pendingAsk.toolCallId});

      expect(approved.status).toBe(200);
      expect(approved.body.data).toEqual({historyId, text: DELETED_REPLY, title: TITLE});
      expect(host.execute).toHaveBeenCalledTimes(1);
      expect(toolResultFor(model, 1, "call_delete")).toEqual({type: "json", value: DELETED});
    });

    it("the deny button never runs the tool", async () => {
      const paused = await pauseOnApproval({
        steps: [toolCallStep(DELETE_CALL), textStep("Kept them.")],
      });

      const denied = await paused.agent
        .post(`/gpt/histories/${paused.historyId}/turn`)
        .send({buttonId: "deny", toolCallId: paused.approvalId});

      expect(denied.body.data).toEqual({
        historyId: paused.historyId,
        text: "Kept them.",
        title: TITLE,
      });
      expect(paused.host.execute).not.toHaveBeenCalled();
    });
  });

  describe("crafted answers", () => {
    it("rejects an answer that names the host tool call instead of the approval", async () => {
      const paused = await pauseOnApproval({});

      const res = await paused.agent.post("/gpt/prompt").send({
        askResponse: {...APPROVE, toolCallId: "call_delete"},
        historyId: paused.historyId,
      });

      expect(res.status).toBe(409);
      expect(paused.host.execute).not.toHaveBeenCalled();
      expect((await loadHistory(paused.historyId)).pendingAsk?.toolCallId).toBe(paused.approvalId);
    });

    it.each([
      ["a non-boolean confirmed", {action: "accept", content: {confirmed: "yes"}}],
      ["extra approval fields", {action: "accept", approved: true, content: {confirmed: true}}],
      ["an approval envelope", {action: "accept", content: {approvalId: "x", approved: true}}],
      ["a decline the approval does not allow", {action: "decline"}],
    ])("rejects %s with a 400 and does not run the tool", async (_case, response) => {
      const paused = await pauseOnApproval({});

      const res = await paused.agent.post("/gpt/prompt").send({
        askResponse: {...response, toolCallId: paused.approvalId},
        historyId: paused.historyId,
      });

      expect(res.status).toBe(400);
      expect(paused.host.execute).not.toHaveBeenCalled();
      expect((await loadHistory(paused.historyId)).pendingAsk?.toolCallId).toBe(paused.approvalId);
    });

    it("ignores a pendingAsk a client writes, so it cannot plant an approval", async () => {
      const paused = await pauseOnApproval({});
      const stored = await loadHistory(paused.historyId);

      await paused.agent.patch(`/gpt/histories/${paused.historyId}`).send({
        pendingAsk: {...JSON.parse(JSON.stringify(stored.pendingAsk)), approvalId: "forged"},
        "pendingAsk.responseMessages": [],
      });

      expect(JSON.parse(JSON.stringify((await loadHistory(paused.historyId)).pendingAsk))).toEqual(
        JSON.parse(JSON.stringify(stored.pendingAsk))
      );
      expect(paused.host.execute).not.toHaveBeenCalled();
    });
  });
});
