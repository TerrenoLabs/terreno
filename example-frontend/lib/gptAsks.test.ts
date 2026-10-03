import {describe, expect, it} from "bun:test";
import type {AskSubmission, GPTChatMessage, SelectedFile} from "@terreno/ui";

import type {GptHistory} from "@/store/sdk";

import {
  answerHistoryId,
  askErrorsFromBody,
  askFromHistoryPrompt,
  askMessage,
  createAskFilesResolver,
  createAskFileUploader,
  errorDetailFromBody,
  withoutEmptyAssistant,
  withResolvedAsk,
  withToolResult,
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

const PLAN_PENDING_ASK: GptHistory["pendingAsk"] = {
  created: "2026-09-28T12:00:00.000Z",
  input: PLAN_INPUT,
  kind: "choice",
  simple: PLAN_CARD,
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
      pendingAsk: PLAN_PENDING_ASK,
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

  it("takes a pending ask's input from the conversation when its row holds no args", () => {
    const {args: _args, ...rowWithoutArgs} = planAskRow("pending");

    const ask = askFromHistoryPrompt({
      pendingAsk: PLAN_PENDING_ASK,
      prompt: rowWithoutArgs,
    });

    expect(ask?.input).toEqual(PLAN_INPUT as unknown as NonNullable<typeof ask>["input"]);
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

describe("withToolResult", () => {
  const DELETE_RESULT = {
    result: {deleted: 2, titles: ["Buy milk", "File taxes"]},
    toolCallId: "call_delete",
    toolName: "deleteCompletedTodos",
  };
  const DELETE_RESULT_MESSAGE: GPTChatMessage = {
    content: "Tool result: deleteCompletedTodos",
    role: "tool-result",
    toolResult: DELETE_RESULT,
  };
  const DELETE_CALL_MESSAGE: GPTChatMessage = {
    content: "Tool call: deleteCompletedTodos",
    role: "tool-call",
    toolCall: {args: {}, toolCallId: "call_delete", toolName: "deleteCompletedTodos"},
  };

  it("puts the result before the empty reply its tool call opened", () => {
    const messages: GPTChatMessage[] = [
      HELLO_MESSAGE,
      DELETE_CALL_MESSAGE,
      {content: "", role: "assistant"},
    ];

    expect(withToolResult({messages, toolResult: DELETE_RESULT})).toEqual([
      HELLO_MESSAGE,
      DELETE_CALL_MESSAGE,
      DELETE_RESULT_MESSAGE,
      {content: "", role: "assistant"},
    ]);
  });

  it("adds the result of a tool an answered approval ran, which streams no tool call", () => {
    const approvalAsk = askMessage({
      input: {prompt: "Delete all of your completed todos?"},
      kind: "confirm",
      toolCallId: "call_approval",
    });
    const messages = withResolvedAsk({
      action: "accept",
      messages: [HELLO_MESSAGE, approvalAsk],
      toolCallId: "call_approval",
    });

    expect(withToolResult({messages, toolResult: DELETE_RESULT})).toEqual([
      ...messages,
      DELETE_RESULT_MESSAGE,
    ]);
  });

  it("adds the result after a reply that already has text", () => {
    const reply: GPTChatMessage = {content: "Deleting them now.", role: "assistant"};

    expect(withToolResult({messages: [HELLO_MESSAGE, reply], toolResult: DELETE_RESULT})).toEqual([
      HELLO_MESSAGE,
      reply,
      DELETE_RESULT_MESSAGE,
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

  it("answers with the extension's type for a CSV the picker reports as application/vnd.ms-excel", async () => {
    const resolve = createAskFilesResolver({
      upload: async (file) => ({id: `id-${file.name}`, size: 9}),
    });

    expect(
      await resolve([{mimeType: "application/vnd.ms-excel", name: "items.csv", uri: "blob:items"}])
    ).toEqual([{fileId: "id-items.csv", filename: "items.csv", mimeType: "text/csv", size: 9}]);
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

describe("createAskFileUploader", () => {
  it("sends the file and returns the uploaded file's id and size", async () => {
    const sent: SelectedFile[] = [];
    const upload = createAskFileUploader({
      send: async (file) => {
        sent.push(file);
        return {data: {gcsKey: "uploads/u/1-receipt.png", id: "66f0c0ffee", size: 12}};
      },
    });

    expect(await upload(RECEIPT)).toEqual({id: "66f0c0ffee", size: 12});
    expect(sent).toEqual([RECEIPT]);
  });

  it("keeps the ask open with the server's detail when the user is signed out", async () => {
    const upload = createAskFileUploader({
      send: async () => ({error: {data: {title: "Unauthorized"}, status: 401}}),
    });

    await expect(upload(RECEIPT)).rejects.toThrow("Unauthorized");
  });

  it("returns nothing when the server has no file routes", async () => {
    const upload = createAskFileUploader({
      send: async () => ({error: {data: {title: "Not found"}, status: 404}}),
    });

    expect(await upload(RECEIPT)).toBeUndefined();
  });

  it("returns nothing when the server's 404 is not JSON", async () => {
    const upload = createAskFileUploader({
      send: async () => ({
        error: {data: "Cannot POST /files/upload", originalStatus: 404, status: "PARSING_ERROR"},
      }),
    });

    expect(await upload(RECEIPT)).toBeUndefined();
  });

  it("fails with the server's detail when the upload is rejected", async () => {
    const upload = createAskFileUploader({
      send: async () => ({error: {data: {title: "File too large"}, status: 413}}),
    });

    await expect(upload(RECEIPT)).rejects.toThrow("File too large");
  });

  it("fails with the status when the error has no detail", async () => {
    const upload = createAskFileUploader({
      send: async () => ({error: {error: "TypeError: Failed to fetch", status: "FETCH_ERROR"}}),
    });

    await expect(upload(RECEIPT)).rejects.toThrow("FETCH_ERROR");
  });

  it("fails when a successful response names no upload id or size", async () => {
    const upload = createAskFileUploader({
      send: async () => ({data: {gcsKey: "k"}}),
    });

    await expect(upload(RECEIPT)).rejects.toThrow("The upload returned no file id or size.");
  });
});
