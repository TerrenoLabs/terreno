import {describe, expect, it} from "bun:test";
import {pendingAskListItemSchema, turnRequestSchema, turnResultSchema} from "./headless";
import {toSimpleCard} from "./simpleCard";

const SHAPES = "prompt, askResponse, or toolCallId with buttonId";

const requestIssues = (body: unknown): {code: string; message: string; path: string}[] => {
  const result = turnRequestSchema.safeParse(body);
  if (result.success) {
    return [];
  }
  return result.error.issues.map(({code, message, path}) => ({
    code,
    message,
    path: path.join("."),
  }));
};

const CARD = toSimpleCard({
  input: {
    options: [
      {id: "yes", label: "Yes"},
      {id: "no", label: "No"},
    ],
    prompt: "Ship it?",
    select: "one",
  },
  kind: "choice",
  toolCallId: "call_1",
});

describe("turnRequestSchema", () => {
  it("accepts each request shape, with or without a surface", () => {
    const bodies = [
      {prompt: "Help me pick a plan"},
      {prompt: "Help me pick a plan", surface: "compact"},
      {
        askResponse: {action: "accept", content: {selected: ["team"]}, toolCallId: "call_1"},
        surface: "full",
      },
      {askResponse: {action: "decline", toolCallId: "call_1"}},
      {askResponse: {action: "cancel", reason: "Changed my mind", toolCallId: "call_1"}},
      {buttonId: "option:team", surface: "compact", toolCallId: "call_1"},
    ];
    for (const body of bodies) {
      expect(requestIssues(body)).toEqual([]);
    }
  });

  it("asks for one shape when the body has none", () => {
    const expected = [{code: "custom", message: `Send one of ${SHAPES}.`, path: "prompt"}];
    expect(requestIssues({})).toEqual(expected);
    expect(requestIssues({surface: "compact"})).toEqual(expected);
  });

  it("names every field of a body that mixes shapes", () => {
    const message = `Send only one of ${SHAPES}.`;
    expect(requestIssues({buttonId: "yes", prompt: "Hi", toolCallId: "call_1"})).toEqual([
      {code: "custom", message, path: "buttonId"},
      {code: "custom", message, path: "prompt"},
      {code: "custom", message, path: "toolCallId"},
    ]);
    expect(
      requestIssues({askResponse: {action: "decline", toolCallId: "call_1"}, prompt: "Hi"})
    ).toEqual([
      {code: "custom", message, path: "askResponse"},
      {code: "custom", message, path: "prompt"},
    ]);
  });

  it("asks for the missing half of a button press", () => {
    expect(requestIssues({buttonId: "option:yes"})).toEqual([
      {code: "custom", message: "Send toolCallId with buttonId.", path: "toolCallId"},
    ]);
    expect(requestIssues({toolCallId: "call_1"})).toEqual([
      {code: "custom", message: "Send buttonId with toolCallId.", path: "buttonId"},
    ]);
  });

  it("rejects unknown fields, an unknown surface, empty strings, and an answer without toolCallId", () => {
    expect(requestIssues({historyId: "abc", prompt: "Hi"}).map(({code}) => code)).toEqual([
      "unrecognized_keys",
    ]);
    expect(requestIssues({prompt: "Hi", surface: "watch"}).map(({path}) => path)).toEqual([
      "surface",
    ]);
    expect(requestIssues({prompt: ""}).map(({path}) => path)).toEqual(["prompt"]);
    expect(requestIssues({buttonId: "", toolCallId: "call_1"}).map(({path}) => path)).toEqual([
      "buttonId",
    ]);
    expect(requestIssues({askResponse: {action: "decline"}}).map(({path}) => path)).toEqual([
      "askResponse.toolCallId",
    ]);
  });
});

describe("turnResultSchema", () => {
  it("accepts a finished turn and a turn that paused on an ask", () => {
    expect(turnResultSchema.safeParse({historyId: "h1", text: "Done."}).success).toBe(true);
    expect(
      turnResultSchema.safeParse({
        historyId: "h1",
        pendingAsk: {kind: "choice", simple: CARD, toolCallId: "call_1"},
        text: "",
        title: "Shipping",
      }).success
    ).toBe(true);
  });

  it("accepts a turn that failed after it started", () => {
    expect(
      turnResultSchema.safeParse({error: "The model is unavailable.", historyId: "h1", text: ""})
        .success
    ).toBe(true);
  });

  it("requires historyId and text", () => {
    expect(turnResultSchema.safeParse({text: "Done."}).success).toBe(false);
    expect(turnResultSchema.safeParse({historyId: "h1"}).success).toBe(false);
  });
});

describe("pendingAskListItemSchema", () => {
  const item = {
    created: "2026-09-27T12:00:00.000Z",
    historyId: "h1",
    kind: "choice",
    simple: CARD,
    title: "Shipping",
    toolCallId: "call_1",
  };

  it("accepts a pending ask with its card", () => {
    expect(pendingAskListItemSchema.safeParse(item).success).toBe(true);
  });

  it("requires created to be an ISO 8601 UTC timestamp", () => {
    expect(pendingAskListItemSchema.safeParse({...item, created: "yesterday"}).success).toBe(false);
  });

  it("rejects a card that is not a simple card", () => {
    expect(
      pendingAskListItemSchema.safeParse({...item, simple: {...CARD, buttons: "none"}}).success
    ).toBe(false);
  });
});
