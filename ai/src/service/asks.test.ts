import {describe, expect, it} from "bun:test";
import type {AskKind} from "@terreno/blocks";
import {asSchema, jsonSchema, type ModelMessage, type Tool, tool} from "ai";

import {
  askKindFromToolName,
  askToolName,
  assertNoReservedToolNames,
  buildAsksSystemPrompt,
  completePausedTurn,
  createAskTools,
  parseAsk,
  resolveAskKinds,
  toStoredMessages,
  withoutReservedToolNames,
} from "./asks";
import {TERRENO_ASKS_SYSTEM_PROMPT} from "./prompts";

const PLAN_ASK_INPUT = {
  options: [
    {id: "starter", label: "Starter"},
    {id: "team", label: "Team"},
  ],
  prompt: "Which plan should I set up?",
  select: "one",
};

const TEAM_ANSWER = {action: "accept" as const, content: {selected: ["team"]}};

const hostTool = (): Tool =>
  tool({
    description: "Look up the plans",
    execute: async () => ({plans: 2}),
    inputSchema: jsonSchema<Record<string, never>>({properties: {}, type: "object"}),
  });

const askCall = (toolCallId: string, input: unknown = PLAN_ASK_INPUT) => ({
  input,
  toolCallId,
  toolName: "ask_choice",
  type: "tool-call" as const,
});

const lookupCall = {
  input: {},
  toolCallId: "call_lookup",
  toolName: "lookupPlans",
  type: "tool-call" as const,
};

const lookupResult = {
  output: {type: "json" as const, value: {plans: 2}},
  toolCallId: "call_lookup",
  toolName: "lookupPlans",
  type: "tool-result" as const,
};

const answerResult = (toolCallId: string, value: unknown) => ({
  output: {type: "json", value},
  toolCallId,
  toolName: "ask_choice",
  type: "tool-result",
});

describe("asks", () => {
  describe("resolveAskKinds", () => {
    it.each([
      {asks: undefined, expected: [], label: "undefined"},
      {asks: false, expected: [], label: "false"},
      {asks: true, expected: ["choice"], label: "true"},
      {asks: {}, expected: ["choice"], label: "{}"},
      {asks: {kinds: []}, expected: [], label: "{kinds: []}"},
      {
        asks: {kinds: ["choice", "choice"] as AskKind[]},
        expected: ["choice"],
        label: '{kinds: ["choice", "choice"]}',
      },
    ])("resolves $label", ({asks, expected}) => {
      expect(resolveAskKinds(asks)).toEqual(expected);
    });

    it("throws on an unknown kind and names the known kinds", () => {
      expect(() => resolveAskKinds({kinds: ["choice", "form"] as AskKind[]})).toThrow(
        expect.objectContaining({
          detail: "Unknown ask kinds: form. Known kinds: choice.",
          message: "The asks option lists unknown ask kinds",
          status: 500,
        })
      );
    });
  });

  describe("tool names", () => {
    it("names a kind's tool ask_<kind>", () => {
      expect(askToolName("choice")).toBe("ask_choice");
    });

    it.each([
      {expected: "choice", kinds: undefined, toolName: "ask_choice"},
      {expected: undefined, kinds: undefined, toolName: "ask_form"},
      {expected: undefined, kinds: undefined, toolName: "lookupPlans"},
      {expected: undefined, kinds: [] as AskKind[], toolName: "ask_choice"},
    ])("maps $toolName with kinds $kinds to $expected", ({expected, kinds, toolName}) => {
      expect(askKindFromToolName(toolName, kinds)).toBe(expected as AskKind | undefined);
    });
  });

  describe("createAskTools", () => {
    it("creates one tool without execute per kind, with the kind's schemas", async () => {
      const tools = createAskTools({kinds: ["choice"]});

      expect(Object.keys(tools)).toEqual(["ask_choice"]);
      const askChoice = tools.ask_choice;
      expect(askChoice.execute).toBeUndefined();
      expect(askChoice.description).toBe(
        "Ask the user to pick one option from a list you provide. The chat shows the options as a " +
          "control and returns the user's answer as this tool's result. Use it instead of asking in " +
          "plain text when the user must choose between options you can list."
      );
      const inputSchema = asSchema(askChoice.inputSchema);
      expect(await inputSchema.validate?.(PLAN_ASK_INPUT)).toEqual({
        success: true,
        value: PLAN_ASK_INPUT,
      });
      expect(await inputSchema.validate?.({...PLAN_ASK_INPUT, url: "https://example.com"})).toEqual(
        {error: expect.any(Error), success: false}
      );
      const outputSchema = asSchema(askChoice.outputSchema);
      expect(await outputSchema.validate?.(TEAM_ANSWER)).toEqual({
        success: true,
        value: TEAM_ANSWER,
      });
    });

    it("creates no tools when no kinds are enabled", () => {
      expect(createAskTools({kinds: []})).toEqual({});
    });
  });

  describe("parseAsk", () => {
    it("types a valid ask input", () => {
      expect(parseAsk({input: PLAN_ASK_INPUT, kind: "choice"})).toEqual({
        input: PLAN_ASK_INPUT,
        kind: "choice",
      });
    });

    it("throws on an input the kind's schema rejects", () => {
      expect(() =>
        parseAsk({input: {...PLAN_ASK_INPUT, select: "many"}, kind: "choice"})
      ).toThrow();
    });
  });

  describe("reserved tool names", () => {
    it("accepts host tools without the ask_ prefix, and no tools at all", () => {
      expect(() => assertNoReservedToolNames({lookupPlans: hostTool()})).not.toThrow();
      expect(() => assertNoReservedToolNames(undefined)).not.toThrow();
    });

    it("throws and lists every host tool that uses the ask_ prefix", () => {
      expect(() =>
        assertNoReservedToolNames({
          ask_budget: hostTool(),
          ask_region: hostTool(),
          lookupPlans: hostTool(),
        })
      ).toThrow(
        expect.objectContaining({
          detail: 'Tool names starting with "ask_" are reserved for asks: ask_budget, ask_region.',
          message: "Host tool names use the prefix reserved for asks",
          status: 500,
        })
      );
    });

    it("drops per-request tools that use the ask_ prefix and keeps the rest", () => {
      const lookupPlans = hostTool();

      expect(withoutReservedToolNames({ask_choice: hostTool(), lookupPlans})).toEqual({
        lookupPlans,
      });
    });

    it("returns the same tools when none use the ask_ prefix", () => {
      const tools = {lookupPlans: hostTool()};

      expect(withoutReservedToolNames(tools)).toBe(tools);
    });
  });

  describe("buildAsksSystemPrompt", () => {
    it("appends the section for the enabled kinds to the asks prompt", () => {
      expect(buildAsksSystemPrompt(["choice"])).toBe(
        [
          TERRENO_ASKS_SYSTEM_PROMPT,
          "Ask tools you can call: ask_choice.",
          [
            "Rules for every ask:",
            "- prompt: required. Plain text with no markdown and no links, 1-500 characters.",
            "- title: optional, at most 80 characters.",
            "- submitLabel: optional, at most 24 characters.",
            "- allowDecline: optional, default true (the user sees Skip). Set it to false only when you cannot continue without an answer.",
          ].join("\n"),
          [
            "ask_choice: the user picks one option from a list you provide.",
            '- select: always "one".',
            "- options: 2-50 items, each {id, label, description?}.",
            '- id: 1-64 lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the ask.',
            "- label: at most 120 characters. description: optional, at most 280 characters.",
            "- default: optional list with at most one option id to preselect.",
            "- Prefer at most 3 options with labels of 20 characters or fewer; small screens show those as buttons.",
            '- An accepted answer looks like {"action": "accept", "content": {"selected": ["<id>"]}}.',
          ].join("\n"),
        ].join("\n\n")
      );
    });
  });

  describe("toStoredMessages", () => {
    it("drops undefined fields and keeps empty objects", () => {
      const messages: ModelMessage[] = [
        {
          content: [{...lookupCall, providerExecuted: undefined, providerOptions: undefined}],
          providerOptions: undefined,
          role: "assistant",
        },
      ];

      expect(toStoredMessages(messages)).toStrictEqual([
        {
          content: [
            {input: {}, toolCallId: "call_lookup", toolName: "lookupPlans", type: "tool-call"},
          ],
          role: "assistant",
        },
      ]);
    });
  });

  describe("completePausedTurn", () => {
    it("adds a tool message with the answer when the ask was the step's only call", () => {
      expect(
        completePausedTurn({
          answer: TEAM_ANSWER,
          responseMessages: [{content: [askCall("call_plan")], role: "assistant"}],
          toolCallId: "call_plan",
        })
      ).toEqual([
        {content: [askCall("call_plan")], role: "assistant"},
        {content: [answerResult("call_plan", TEAM_ANSWER)], role: "tool"},
      ]);
    });

    it("merges the answer into the step's tool message, in call order", () => {
      expect(
        completePausedTurn({
          answer: TEAM_ANSWER,
          responseMessages: [
            {content: [askCall("call_plan"), lookupCall], role: "assistant"},
            {content: [lookupResult], role: "tool"},
          ],
          toolCallId: "call_plan",
        })
      ).toEqual([
        {content: [askCall("call_plan"), lookupCall], role: "assistant"},
        {content: [answerResult("call_plan", TEAM_ANSWER), lookupResult], role: "tool"},
      ]);
    });

    it("answers a second ask in the step with cancel one_ask_at_a_time", () => {
      expect(
        completePausedTurn({
          answer: {action: "decline"},
          responseMessages: [
            {content: [askCall("call_plan"), askCall("call_region")], role: "assistant"},
          ],
          toolCallId: "call_plan",
        })
      ).toEqual([
        {content: [askCall("call_plan"), askCall("call_region")], role: "assistant"},
        {
          content: [
            answerResult("call_plan", {action: "decline"}),
            answerResult("call_region", {action: "cancel", reason: "one_ask_at_a_time"}),
          ],
          role: "tool",
        },
      ]);
    });

    it("gives another tool call that did not run an error result, and skips provider-run calls", () => {
      const pickFileCall = {
        input: {},
        toolCallId: "call_file",
        toolName: "pickFile",
        type: "tool-call" as const,
      };
      const searchCall = {
        input: {query: "plans"},
        providerExecuted: true,
        toolCallId: "call_search",
        toolName: "web_search",
        type: "tool-call" as const,
      };

      expect(
        completePausedTurn({
          answer: TEAM_ANSWER,
          responseMessages: [
            {content: [pickFileCall, searchCall, askCall("call_plan")], role: "assistant"},
          ],
          toolCallId: "call_plan",
        })
      ).toEqual([
        {content: [pickFileCall, searchCall, askCall("call_plan")], role: "assistant"},
        {
          content: [
            {
              output: {
                type: "error-text",
                value: "This tool call did not run, so it has no result.",
              },
              toolCallId: "call_file",
              toolName: "pickFile",
              type: "tool-result",
            },
            answerResult("call_plan", TEAM_ANSWER),
          ],
          role: "tool",
        },
      ]);
    });

    it("keeps parts other than tool results after the results", () => {
      const approval = {
        approvalId: "approval_1",
        approved: true,
        type: "tool-approval-response" as const,
      };

      expect(
        completePausedTurn({
          answer: TEAM_ANSWER,
          responseMessages: [
            {content: [lookupCall, askCall("call_plan")], role: "assistant"},
            {content: [approval, lookupResult], role: "tool"},
          ],
          toolCallId: "call_plan",
        })
      ).toEqual([
        {content: [lookupCall, askCall("call_plan")], role: "assistant"},
        {content: [lookupResult, answerResult("call_plan", TEAM_ANSWER), approval], role: "tool"},
      ]);
    });

    it("answers only the last step when an earlier ask in the turn was already answered", () => {
      const earlier: ModelMessage[] = [
        {content: [askCall("call_plan")], role: "assistant"},
        {content: [answerResult("call_plan", TEAM_ANSWER)], role: "tool"} as ModelMessage,
      ];

      expect(
        completePausedTurn({
          answer: {action: "decline"},
          responseMessages: [
            ...earlier,
            {content: "Got it.", role: "assistant"},
            {content: [askCall("call_region")], role: "assistant"},
          ],
          toolCallId: "call_region",
        })
      ).toEqual([
        ...earlier,
        {content: "Got it.", role: "assistant"},
        {content: [askCall("call_region")], role: "assistant"},
        {content: [answerResult("call_region", {action: "decline"})], role: "tool"},
      ]);
    });

    it("returns the messages unchanged when the last step has no call without a result", () => {
      const responseMessages: ModelMessage[] = [
        {content: "Be brief.", role: "system"},
        {content: [lookupCall], role: "assistant"},
        {content: [lookupResult], role: "tool"},
        {content: "There are 2 plans.", role: "assistant"},
      ];

      expect(
        completePausedTurn({answer: TEAM_ANSWER, responseMessages, toolCallId: "call_plan"})
      ).toBe(responseMessages);
    });
  });
});
