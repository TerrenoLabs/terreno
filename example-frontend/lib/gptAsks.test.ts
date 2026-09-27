import {describe, expect, it} from "bun:test";
import type {AskSubmission, GPTChatMessage} from "@terreno/ui";

import type {GptHistory} from "@/store/sdk";

import {
  askErrorsFromBody,
  askFromHistoryPrompt,
  askMessage,
  errorDetailFromBody,
  withResolvedAsk,
} from "./gptAsks";

const PLAN_INPUT = {
  default: ["team"],
  options: [
    {id: "starter", label: "Starter"},
    {id: "team", label: "Team"},
  ],
  prompt: "Which plan should I set up?",
  select: "one",
};

const PLAN_CARD = {
  buttons: [],
  handoff: false,
  kind: "choice",
  text: "Which plan should I set up?",
  toolCallId: "call_plan",
};

const TEAM_ANSWER: AskSubmission = {
  response: {action: "accept", content: {selected: ["team"]}},
  toolCallId: "call_plan",
};

const planAskRow = (
  status: "pending" | "answered" | "cancelled"
): GptHistory["prompts"][number] => ({
  args: PLAN_INPUT,
  ask: {kind: "choice", status},
  text: "Tool call: ask_choice",
  toolCallId: "call_plan",
  toolName: "ask_choice",
  type: "tool-call",
});

describe("askFromHistoryPrompt", () => {
  it("restores the conversation's pending ask with its stored card", () => {
    const ask = askFromHistoryPrompt({
      pendingAsk: {input: PLAN_INPUT, kind: "choice", simple: PLAN_CARD, toolCallId: "call_plan"},
      prompt: planAskRow("pending"),
    });

    expect(ask).toEqual({
      input: PLAN_INPUT,
      kind: "choice",
      simple: PLAN_CARD,
      status: "pending",
      toolCallId: "call_plan",
    } as unknown as typeof ask);
  });

  it("keeps an answered ask's status", () => {
    expect(askFromHistoryPrompt({prompt: planAskRow("answered")})).toMatchObject({
      status: "answered",
      toolCallId: "call_plan",
    });
  });

  it("shows a row marked pending as cancelled when it is not the pending ask", () => {
    expect(askFromHistoryPrompt({prompt: planAskRow("pending")})?.status).toBe("cancelled");
  });

  it("ignores rows that are not asks", () => {
    expect(askFromHistoryPrompt({prompt: {text: "Hi", type: "user"}})).toBeUndefined();
    expect(
      askFromHistoryPrompt({
        prompt: {
          args: {},
          text: "Tool call: lookupPlans",
          toolCallId: "call_lookup",
          toolName: "lookupPlans",
          type: "tool-call",
        },
      })
    ).toBeUndefined();
  });
});

describe("askMessage", () => {
  it("makes a tool-call message that holds the pending ask", () => {
    const message = askMessage({
      input: PLAN_INPUT,
      kind: "choice",
      simple: PLAN_CARD,
      toolCallId: "call_plan",
    });

    expect(message).toMatchObject({
      ask: {input: PLAN_INPUT, kind: "choice", simple: PLAN_CARD, status: "pending"},
      content: "Tool call: ask_choice",
      role: "tool-call",
      toolCall: {args: PLAN_INPUT, toolCallId: "call_plan", toolName: "ask_choice"},
    });
  });
});

describe("withResolvedAsk", () => {
  const userMessage: GPTChatMessage = {content: "Help me pick a plan", role: "user"};
  const pendingMessage = askMessage({input: PLAN_INPUT, kind: "choice", toolCallId: "call_plan"});

  it("marks the answered ask and adds its result row right after it", () => {
    const messages = withResolvedAsk({
      action: "accept",
      messages: [userMessage, pendingMessage],
      submitted: TEAM_ANSWER,
      toolCallId: "call_plan",
    });

    expect(messages.map((message) => message.role)).toEqual(["user", "tool-call", "tool-result"]);
    expect(messages[1]?.ask).toMatchObject({response: TEAM_ANSWER.response, status: "answered"});
    expect(messages[2]).toEqual({
      content: "Tool result: ask_choice",
      role: "tool-result",
      toolResult: {result: TEAM_ANSWER.response, toolCallId: "call_plan", toolName: "ask_choice"},
    });
  });

  it("records the cancel for a message sent instead, before that message", () => {
    const nextMessage: GPTChatMessage = {content: "Never mind", role: "user"};
    const cancel = {action: "cancel", reason: "user_sent_message"};

    const messages = withResolvedAsk({
      action: "cancel",
      messages: [userMessage, pendingMessage, nextMessage],
      toolCallId: "call_plan",
    });

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "tool-call",
      "tool-result",
      "user",
    ]);
    expect(messages[1]?.ask).toMatchObject({response: cancel, status: "cancelled"});
    expect(messages[2]?.toolResult?.result).toEqual(cancel);
    expect(messages[3]).toBe(nextMessage);
  });

  it("leaves the transcript alone when the ask is not in it", () => {
    const messages = [userMessage];

    expect(withResolvedAsk({action: "accept", messages, toolCallId: "call_other"})).toBe(messages);
  });
});

describe("askErrorsFromBody", () => {
  it("returns the fields of a 400 answer response", () => {
    const fields = [
      {
        code: "OPTION_NOT_OFFERED",
        fix: "Use the id of one of the ask's options.",
        message: '"gold" is not one of the offered options.',
        path: "content.selected.0",
      },
    ];

    expect(askErrorsFromBody({detail: "The answer does not match the ask.", fields})).toEqual(
      fields as unknown as ReturnType<typeof askErrorsFromBody>
    );
  });

  it("returns nothing for a body without fields", () => {
    expect(askErrorsFromBody({title: "Invalid askResponse"})).toBeUndefined();
    expect(askErrorsFromBody({fields: []})).toBeUndefined();
    expect(askErrorsFromBody("Bad request")).toBeUndefined();
  });
});

describe("errorDetailFromBody", () => {
  it("prefers the detail and falls back to the title", () => {
    expect(
      errorDetailFromBody({
        detail: "This conversation is finishing an answer; try again.",
        title: "This ask is no longer pending",
      })
    ).toBe("This conversation is finishing an answer; try again.");
    expect(errorDetailFromBody({title: "This ask is no longer pending"})).toBe(
      "This ask is no longer pending"
    );
    expect(errorDetailFromBody(undefined)).toBeUndefined();
  });
});
