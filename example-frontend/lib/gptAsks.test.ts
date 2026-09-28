import {describe, expect, it} from "bun:test";
import type {AskSubmission, GPTChatMessage, SelectedFile} from "@terreno/ui";

import type {GptHistory} from "@/store/sdk";

import {
  answerHistoryId,
  askErrorsFromBody,
  askFromHistoryPrompt,
  askMessage,
  createAskFilesResolver,
  errorDetailFromBody,
  uploadedFileFromBody,
  withoutEmptyAssistant,
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

const HELLO_MESSAGE: GPTChatMessage = {content: "Hello", role: "user"};

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

describe("withoutEmptyAssistant", () => {
  it("drops an assistant row with no text and no attachments", () => {
    const messages: GPTChatMessage[] = [HELLO_MESSAGE, {content: "", role: "assistant"}];

    expect(withoutEmptyAssistant(messages)).toEqual([HELLO_MESSAGE]);
  });

  it("keeps an assistant row that holds only an image or a file", () => {
    const imageReply: GPTChatMessage = {
      content: "",
      contentParts: [{mimeType: "image/png", type: "image", url: "data:image/png;base64,AAAA"}],
      role: "assistant",
    };
    const fileReply: GPTChatMessage = {
      content: "",
      contentParts: [
        {filename: "plan.pdf", mimeType: "application/pdf", type: "file", url: "data:,"},
      ],
      role: "assistant",
    };

    expect(withoutEmptyAssistant([HELLO_MESSAGE, imageReply, fileReply])).toEqual([
      HELLO_MESSAGE,
      imageReply,
      fileReply,
    ]);
  });
});

describe("answerHistoryId", () => {
  it("answers in the conversation the ask's event named, before {done} opens it", () => {
    const askHistoryIds = new Map([["call_plan", "history-new"]]);

    expect(
      answerHistoryId({askHistoryIds, currentHistoryId: undefined, toolCallId: "call_plan"})
    ).toBe("history-new");
  });

  it("answers in the open conversation for an ask loaded from a saved history", () => {
    expect(
      answerHistoryId({
        askHistoryIds: new Map(),
        currentHistoryId: "history-open",
        toolCallId: "call_plan",
      })
    ).toBe("history-open");
  });
});

describe("errorDetailFromBody", () => {
  it("prefers the detail and falls back to the title", () => {
    expect(
      errorDetailFromBody({
        detail: "Tool call call_plan is not the ask this conversation is waiting on.",
        title: "This ask is no longer pending",
      })
    ).toBe("Tool call call_plan is not the ask this conversation is waiting on.");
    expect(errorDetailFromBody({title: "This ask is no longer pending"})).toBe(
      "This ask is no longer pending"
    );
    expect(errorDetailFromBody(undefined)).toBeUndefined();
  });
});

const RECEIPT: SelectedFile = {mimeType: "image/png", name: "receipt.png", uri: "blob:receipt"};
const ITEMS: SelectedFile = {
  mimeType: "text/csv; charset=utf-8",
  name: "items.csv",
  uri: "blob:items",
};

describe("createAskFilesResolver", () => {
  it("uploads each file and answers with file ids", async () => {
    const uploaded: string[] = [];
    const resolve = createAskFilesResolver({
      toDataUrlRefs: async () => expect.unreachable("a server with file routes needs no data URLs"),
      upload: async (file) => {
        uploaded.push(file.name);
        return {id: `id-${file.name}`, size: file.name.length};
      },
    });

    expect(await resolve([RECEIPT, ITEMS])).toEqual([
      {fileId: "id-receipt.png", filename: "receipt.png", mimeType: "image/png", size: 11},
      {fileId: "id-items.csv", filename: "items.csv", mimeType: "text/csv", size: 9},
    ]);
    expect(uploaded).toEqual(["receipt.png", "items.csv"]);
  });

  it("sends data URLs when the server has no file routes, and stops trying to upload", async () => {
    let uploads = 0;
    const dataUrlRef = {
      filename: "receipt.png",
      mimeType: "image/png",
      size: 4,
      url: "data:image/png;base64,iVBORw==",
    };
    const resolve = createAskFilesResolver({
      toDataUrlRefs: async (files) => files.map(() => dataUrlRef),
      upload: async () => {
        uploads += 1;
        return undefined;
      },
    });

    expect(await resolve([RECEIPT, ITEMS])).toEqual([dataUrlRef, dataUrlRef]);
    expect(await resolve([RECEIPT])).toEqual([dataUrlRef]);
    expect(uploads).toBe(1);
  });

  it("keeps the ask open when an upload fails", async () => {
    const resolve = createAskFilesResolver({
      upload: async () => {
        throw new Error("HTTP 500");
      },
    });

    await expect(resolve([RECEIPT])).rejects.toThrow("HTTP 500");
  });
});

describe("uploadedFileFromBody", () => {
  it("reads the id and size of an upload response", () => {
    expect(
      uploadedFileFromBody({
        data: {filename: "a.png", gcsKey: "k", id: "66f0c0ffee", mimeType: "image/png", size: 12},
      })
    ).toEqual({id: "66f0c0ffee", size: 12});
    expect(uploadedFileFromBody({data: {gcsKey: "k"}})).toBeUndefined();
    expect(uploadedFileFromBody(undefined)).toBeUndefined();
  });
});
