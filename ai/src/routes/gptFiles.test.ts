import {afterEach, beforeAll, describe, expect, it, mock} from "bun:test";
import mongoose from "mongoose";

import {AIRequest} from "../models/aiRequest";
import {FileAttachment} from "../models/fileAttachment";
import {GptHistory} from "../models/gptHistory";
import {
  type Agent,
  buildApp,
  conversationOf,
  createScriptedModel,
  loadHistory,
  modelCall,
  onlyHistoryId,
  pendingAskOf,
  type ScriptedModel,
  streamPrompt,
  systemPromptOf,
  textStep,
  toolCallStep,
  toolNamesOf,
} from "../tests/chatHarness";
import {authAsUser, ensureTestUsers, UserModel} from "../tests/helpers";
import type {AskFileDownloader, GptRouteOptions} from "../types";

const RECEIPT_ASK_INPUT = {
  accept: ["image", "text", "csv"],
  maxFiles: 3,
  prompt: "Upload the receipt for this expense.",
  title: "Receipt",
};

const RECEIPT_ASK_CALL = {
  input: RECEIPT_ASK_INPUT,
  toolCallId: "call_receipt",
  toolName: "ask_files",
};

const RECEIPT_CARD = {
  buttons: [{id: "skip", label: "Skip", response: {action: "decline"}, style: "cancel"}],
  handoff: true,
  kind: "files",
  text: "Upload the receipt for this expense.",
  title: "Receipt",
  toolCallId: "call_receipt",
};

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const PNG_BASE64 = PNG_BYTES.toString("base64");
const RECEIPT_TEXT = "Coffee, 4.50\nBagel, 3.25\n";
const RECEIPT_TEXT_BASE64 = Buffer.from(RECEIPT_TEXT).toString("base64");

const dataUrl = (mimeType: string, bytes: Buffer): string =>
  `data:${mimeType};base64,${bytes.toString("base64")}`;

const fakeDownloader = (files: Record<string, Buffer>): AskFileDownloader & {calls: string[]} => {
  const calls: string[] = [];
  return {
    calls,
    download: mock(async (gcsKey: string) => {
      calls.push(gcsKey);
      const bytes = files[gcsKey];
      if (!bytes) {
        expect.unreachable(`No stored file at ${gcsKey}`);
      }
      return bytes;
    }),
  };
};

const userIdOf = async (email: string): Promise<mongoose.Types.ObjectId> => {
  const [user] = await UserModel.find({email});
  if (!user) {
    expect.unreachable(`No test user ${email}`);
  }
  return user._id as mongoose.Types.ObjectId;
};

const createUpload = async ({
  filename,
  gcsKey,
  mimeType,
  size,
  userId,
}: {
  filename: string;
  gcsKey: string;
  mimeType: string;
  size: number;
  userId: mongoose.Types.ObjectId;
}): Promise<string> => {
  const upload = await FileAttachment.create({
    filename,
    gcsKey,
    mimeType,
    size,
    url: `https://storage.googleapis.com/test-bucket/${gcsKey}`,
    userId,
  });
  return upload._id.toString();
};

const pauseOnReceiptAsk = async ({
  replyText = "Got your receipt.",
  ...routeOptions
}: {replyText?: string} & Partial<GptRouteOptions>): Promise<{
  agent: Agent;
  historyId: string;
  model: ScriptedModel;
}> => {
  const model = createScriptedModel({
    steps: [toolCallStep(RECEIPT_ASK_CALL), textStep(replyText), textStep("Anything else?")],
  });
  const agent = await authAsUser(buildApp({asks: true, model, ...routeOptions}), "notAdmin");
  const asked = await streamPrompt(agent, {prompt: "Log my lunch expense"});
  const historyId = await onlyHistoryId();
  expect(asked.events).toEqual([
    {
      ask: {
        input: RECEIPT_ASK_INPUT,
        kind: "files",
        simple: RECEIPT_CARD,
        toolCallId: "call_receipt",
      },
      historyId,
    },
    {done: true, historyId, pendingAsk: {toolCallId: "call_receipt"}},
  ]);
  return {agent, historyId, model};
};

const answerFiles = async (
  agent: Agent,
  historyId: string,
  files: Record<string, unknown>[]
): Promise<{body: Record<string, unknown>; status: number}> => {
  const res = await agent.post("/gpt/prompt").send({
    askResponse: {action: "accept", content: {files}, toolCallId: "call_receipt"},
    historyId,
  });
  return {body: res.body as Record<string, unknown>, status: res.status};
};

const fieldCodes = (body: Record<string, unknown>): {code: string; path: string}[] =>
  (body.fields as {code: string; path: string}[]).map(({code, path}) => ({code, path}));

/** The tool result the model saw on its `index`th call for the receipt ask. */
const receiptResultOf = (model: ScriptedModel, index: number): unknown => {
  const toolMessage = conversationOf(modelCall(model, index)).find(
    (message) =>
      message.role === "tool" &&
      Array.isArray(message.content) &&
      message.content.some((part) => (part as {toolCallId?: string}).toolCallId === "call_receipt")
  );
  if (!toolMessage) {
    expect.unreachable(`Model call ${index} has no result for the receipt ask`);
  }
  return (toolMessage.content as {output: unknown}[])[0].output;
};

const storedResultOf = async (historyId: string): Promise<unknown> => {
  const history = await loadHistory(historyId);
  const row = history.prompts.find(
    (prompt) => prompt.type === "tool-result" && prompt.toolCallId === "call_receipt"
  );
  return JSON.parse(JSON.stringify(row?.result));
};

describe("/gpt/prompt files asks", () => {
  let userId: mongoose.Types.ObjectId;
  let otherUserId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    await ensureTestUsers();
    userId = await userIdOf("notAdmin@example.com");
    otherUserId = await userIdOf("admin@example.com");
  });

  afterEach(async () => {
    await AIRequest.deleteMany({});
    await FileAttachment.deleteMany({});
    await GptHistory.deleteMany({});
  });

  describe("with data URLs", () => {
    it("sends an image as image-data and a text file as text, and stores only their metadata", async () => {
      const {agent, historyId, model} = await pauseOnReceiptAsk({});

      const {events} = await streamPrompt(agent, {
        askResponse: {
          action: "accept",
          content: {
            files: [
              {
                filename: "receipt.png",
                mimeType: "image/png",
                size: PNG_BYTES.length,
                url: `data:image/png;base64,${PNG_BASE64}`,
              },
              {
                filename: "items.txt",
                mimeType: "text/plain",
                size: RECEIPT_TEXT.length,
                url: `data:text/plain;base64,${RECEIPT_TEXT_BASE64}`,
              },
            ],
          },
          toolCallId: "call_receipt",
        },
        historyId,
      });

      expect(events).toEqual([
        {askResolved: {action: "accept", toolCallId: "call_receipt"}},
        {text: "Got your receipt."},
        {done: true, historyId, title: "Workspace setup"},
      ]);
      const storedAnswer = {
        action: "accept",
        content: {
          files: [
            {filename: "receipt.png", mimeType: "image/png", size: PNG_BYTES.length},
            {filename: "items.txt", mimeType: "text/plain", size: RECEIPT_TEXT.length},
          ],
        },
      };
      expect(receiptResultOf(model, 1)).toEqual({
        type: "content",
        value: [
          {text: JSON.stringify(storedAnswer), type: "text"},
          {text: "File 1 of 2: receipt.png (image/png, 12 bytes)", type: "text"},
          {data: PNG_BASE64, mediaType: "image/png", type: "image-data"},
          {text: "File 2 of 2: items.txt (text/plain, 25 bytes)", type: "text"},
          {text: RECEIPT_TEXT, type: "text"},
        ],
      });
      expect(await storedResultOf(historyId)).toEqual(storedAnswer);
      const history = await loadHistory(historyId);
      expect(pendingAskOf(history)).toBeUndefined();
      expect(JSON.stringify(history.toObject())).not.toContain(PNG_BASE64);
      const [, logged] = await AIRequest.find({}).sort({created: 1});
      expect(logged.prompt).toBe(JSON.stringify(storedAnswer));
    });

    it("replays only the stored metadata on the next turn", async () => {
      const {agent, historyId, model} = await pauseOnReceiptAsk({});
      await answerFiles(agent, historyId, [
        {
          filename: "receipt.png",
          mimeType: "image/png",
          size: PNG_BYTES.length,
          url: `data:image/png;base64,${PNG_BASE64}`,
        },
      ]);

      await streamPrompt(agent, {historyId, prompt: "Thanks"});

      expect(receiptResultOf(model, 2)).toEqual({
        type: "json",
        value: {
          action: "accept",
          content: {files: [{filename: "receipt.png", mimeType: "image/png", size: 12}]},
        },
      });
    });

    it("cuts a text file to its first 100 KB and says so", async () => {
      const {agent, historyId, model} = await pauseOnReceiptAsk({});
      const longText = Buffer.from(`${"a".repeat(99_999)}é${"b".repeat(50)}`);

      await answerFiles(agent, historyId, [
        {
          filename: "ledger.csv",
          mimeType: "text/csv",
          size: longText.length,
          url: dataUrl("text/csv", longText),
        },
      ]);

      const output = receiptResultOf(model, 1) as {value: {text?: string}[]};
      expect(output.value.slice(1)).toEqual([
        {text: "File 1 of 1: ledger.csv (text/csv, 100051 bytes)", type: "text"},
        {text: "a".repeat(99_999), type: "text"},
        {text: "[The file is cut to its first 99999 of 100051 bytes.]", type: "text"},
      ]);
    });

    it("returns 400 MIME_MISMATCH when the bytes are not the declared type, and keeps the ask pending", async () => {
      const {agent, historyId, model} = await pauseOnReceiptAsk({});

      const {body, status} = await answerFiles(agent, historyId, [
        {
          filename: "receipt.png",
          mimeType: "image/png",
          size: RECEIPT_TEXT.length,
          url: `data:image/png;base64,${RECEIPT_TEXT_BASE64}`,
        },
      ]);

      expect(status).toBe(400);
      expect(body.title).toBe("Invalid askResponse");
      expect(body.fields).toEqual([
        {
          code: "MIME_MISMATCH",
          fix: "Send the file with its real type, or a file that is image/png.",
          message: "The file is declared as image/png, but its bytes are text.",
          path: "content.files[0].mimeType",
        },
      ]);
      expect(model.doStream).toHaveBeenCalledTimes(1);
      expect((await loadHistory(historyId)).pendingAsk?.toolCallId).toBe("call_receipt");
    });

    it("returns 400 FILE_TYPE_NOT_ACCEPTED and FILE_COUNT before loading any bytes", async () => {
      const {agent, historyId, model} = await pauseOnReceiptAsk({});
      const pdf = {
        filename: "receipt.pdf",
        mimeType: "application/pdf",
        size: 5,
        url: dataUrl("application/pdf", Buffer.from("%PDF-")),
      };

      const typed = await answerFiles(agent, historyId, [pdf]);
      const counted = await answerFiles(agent, historyId, []);

      expect(typed.status).toBe(400);
      expect(fieldCodes(typed.body)).toEqual([
        {code: "FILE_TYPE_NOT_ACCEPTED", path: "content.files[0].mimeType"},
      ]);
      expect(counted.status).toBe(400);
      expect(fieldCodes(counted.body)).toEqual([{code: "FILE_COUNT", path: "content.files"}]);
      expect(model.doStream).toHaveBeenCalledTimes(1);
    });

    it("returns 400 FILE_TOO_LARGE against asks.maxFileSizeBytes", async () => {
      const {agent, historyId} = await pauseOnReceiptAsk({asks: {maxFileSizeBytes: 16}});

      const {body, status} = await answerFiles(agent, historyId, [
        {
          filename: "items.txt",
          mimeType: "text/plain",
          size: RECEIPT_TEXT.length,
          url: `data:text/plain;base64,${RECEIPT_TEXT_BASE64}`,
        },
      ]);

      expect(status).toBe(400);
      expect(fieldCodes(body)).toEqual([{code: "FILE_TOO_LARGE", path: "content.files[0].size"}]);
    });

    it("returns 400 FILE_NOT_OWNED for a fileId when the host has no file storage", async () => {
      const {agent, historyId} = await pauseOnReceiptAsk({});
      const fileId = await createUpload({
        filename: "receipt.png",
        gcsKey: "uploads/receipt.png",
        mimeType: "image/png",
        size: PNG_BYTES.length,
        userId,
      });

      const {body, status} = await answerFiles(agent, historyId, [
        {fileId, filename: "receipt.png", mimeType: "image/png", size: PNG_BYTES.length},
      ]);

      expect(status).toBe(400);
      expect(fieldCodes(body)).toEqual([{code: "FILE_NOT_OWNED", path: "content.files[0].fileId"}]);
    });

    it("stores a declined answer as sent", async () => {
      const {agent, historyId, model} = await pauseOnReceiptAsk({replyText: "No receipt, noted."});

      const {events} = await streamPrompt(agent, {
        askResponse: {action: "decline", toolCallId: "call_receipt"},
        historyId,
      });

      expect(events[1]).toEqual({text: "No receipt, noted."});
      expect(receiptResultOf(model, 1)).toEqual({type: "json", value: {action: "decline"}});
      expect(await storedResultOf(historyId)).toEqual({action: "decline"});
    });
  });

  describe("with uploads", () => {
    it("loads the caller's uploads and sends them to the model, storing their ids", async () => {
      const downloader = fakeDownloader({
        "uploads/items.txt": Buffer.from(RECEIPT_TEXT),
        "uploads/receipt.png": PNG_BYTES,
      });
      const {agent, historyId, model} = await pauseOnReceiptAsk({fileStorageService: downloader});
      const imageId = await createUpload({
        filename: "receipt.png",
        gcsKey: "uploads/receipt.png",
        mimeType: "image/png",
        size: PNG_BYTES.length,
        userId,
      });
      const textId = await createUpload({
        filename: "items.txt",
        gcsKey: "uploads/items.txt",
        mimeType: "text/plain",
        size: RECEIPT_TEXT.length,
        userId,
      });

      const {events} = await streamPrompt(agent, {
        askResponse: {
          action: "accept",
          content: {
            files: [
              {fileId: imageId, filename: "receipt.png", mimeType: "image/png", size: 12},
              {fileId: textId, filename: "items.txt", mimeType: "text/plain", size: 25},
            ],
          },
          toolCallId: "call_receipt",
        },
        historyId,
      });

      expect(events[1]).toEqual({text: "Got your receipt."});
      expect(downloader.calls.sort()).toEqual(["uploads/items.txt", "uploads/receipt.png"]);
      const storedAnswer = {
        action: "accept",
        content: {
          files: [
            {fileId: imageId, filename: "receipt.png", mimeType: "image/png", size: 12},
            {fileId: textId, filename: "items.txt", mimeType: "text/plain", size: 25},
          ],
        },
      };
      expect(receiptResultOf(model, 1)).toEqual({
        type: "content",
        value: [
          {text: JSON.stringify(storedAnswer), type: "text"},
          {text: "File 1 of 2: receipt.png (image/png, 12 bytes)", type: "text"},
          {data: PNG_BASE64, mediaType: "image/png", type: "image-data"},
          {text: "File 2 of 2: items.txt (text/plain, 25 bytes)", type: "text"},
          {text: RECEIPT_TEXT, type: "text"},
        ],
      });
      expect(await storedResultOf(historyId)).toEqual(storedAnswer);
    });

    it("sends a PDF upload as file-data", async () => {
      const pdfBytes = Buffer.from("%PDF-1.7\n%âãÏÓ\n");
      const downloader = fakeDownloader({"uploads/receipt.pdf": pdfBytes});
      const {agent, historyId, model} = await pauseOnReceiptAsk({
        fileStorageService: downloader,
      });
      await GptHistory.updateOne({_id: historyId}, {$set: {"pendingAsk.input.accept": ["pdf"]}});
      const fileId = await createUpload({
        filename: "receipt.pdf",
        gcsKey: "uploads/receipt.pdf",
        mimeType: "application/pdf",
        size: pdfBytes.length,
        userId,
      });

      await answerFiles(agent, historyId, [
        {fileId, filename: "receipt.pdf", mimeType: "application/pdf", size: pdfBytes.length},
      ]);

      const output = receiptResultOf(model, 1) as {value: unknown[]};
      expect(output.value.at(-1)).toEqual({
        data: pdfBytes.toString("base64"),
        filename: "receipt.pdf",
        mediaType: "application/pdf",
        type: "file-data",
      });
    });

    it("returns 400 FILE_NOT_OWNED for another user's upload, a deleted upload, or an unknown id", async () => {
      const downloader = fakeDownloader({"uploads/theirs.png": PNG_BYTES});
      const {agent, historyId, model} = await pauseOnReceiptAsk({fileStorageService: downloader});
      const theirs = await createUpload({
        filename: "theirs.png",
        gcsKey: "uploads/theirs.png",
        mimeType: "image/png",
        size: PNG_BYTES.length,
        userId: otherUserId,
      });
      const deleted = await createUpload({
        filename: "deleted.png",
        gcsKey: "uploads/deleted.png",
        mimeType: "image/png",
        size: PNG_BYTES.length,
        userId,
      });
      await FileAttachment.updateOne({_id: deleted}, {$set: {deleted: true}});
      const ref = {filename: "receipt.png", mimeType: "image/png", size: 12};

      const {body, status} = await answerFiles(agent, historyId, [
        {...ref, fileId: theirs},
        {...ref, fileId: deleted},
        {...ref, fileId: new mongoose.Types.ObjectId().toString()},
      ]);

      expect(status).toBe(400);
      expect(body.fields).toEqual(
        [0, 1, 2].map((index) => ({
          code: "FILE_NOT_OWNED",
          fix: "Upload the file with POST /files/upload and send the id it returns, or send a data: URL.",
          message: "The file id does not name one of your uploads.",
          path: `content.files[${index}].fileId`,
        }))
      );
      expect(downloader.calls).toEqual([]);
      expect(model.doStream).toHaveBeenCalledTimes(1);
      expect((await loadHistory(historyId)).pendingAsk?.toolCallId).toBe("call_receipt");
    });

    it("returns 400 when an upload's bytes are larger than the cap or not its declared type", async () => {
      const downloader = fakeDownloader({
        "uploads/big.txt": Buffer.from("x".repeat(64)),
        "uploads/fake.png": Buffer.from(RECEIPT_TEXT),
      });
      const {agent, historyId} = await pauseOnReceiptAsk({
        asks: {maxFileSizeBytes: 32},
        fileStorageService: downloader,
      });
      const big = await createUpload({
        filename: "big.txt",
        gcsKey: "uploads/big.txt",
        mimeType: "text/plain",
        size: 8,
        userId,
      });
      const fake = await createUpload({
        filename: "fake.png",
        gcsKey: "uploads/fake.png",
        mimeType: "image/png",
        size: 12,
        userId,
      });

      const {body, status} = await answerFiles(agent, historyId, [
        {fileId: big, filename: "big.txt", mimeType: "text/plain", size: 8},
        {fileId: fake, filename: "fake.png", mimeType: "image/png", size: 12},
      ]);

      expect(status).toBe(400);
      expect(fieldCodes(body)).toEqual([
        {code: "FILE_TOO_LARGE", path: "content.files[0].size"},
        {code: "MIME_MISMATCH", path: "content.files[1].mimeType"},
      ]);
    });
  });

  describe("surfaces", () => {
    it("offers ask_files on the full surface and not on the compact surface", async () => {
      const model = createScriptedModel({steps: [textStep("Hello."), textStep("Hi.")]});
      const agent = await authAsUser(buildApp({asks: true, model}), "notAdmin");

      await streamPrompt(agent, {prompt: "Hi"});
      await streamPrompt(agent, {prompt: "Hi", surface: "compact"});

      expect(toolNamesOf(modelCall(model, 0))).toContain("ask_files");
      expect(toolNamesOf(modelCall(model, 1))).toEqual(["ask_choice", "ask_confirm"]);
      expect(systemPromptOf(modelCall(model, 1))).not.toContain("ask_files");
    });
  });
});
