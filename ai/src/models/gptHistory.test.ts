import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {GptHistory} from "./gptHistory";

describe("GptHistory Model", () => {
  beforeEach(async () => {
    await GptHistory.deleteMany({});
  });

  afterEach(async () => {
    await GptHistory.deleteMany({});
  });

  describe("schema", () => {
    it("should create a history with required fields", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = await GptHistory.create({
        prompts: [],
        userId,
      });

      expect(history.userId.toString()).toBe(userId.toString());
      expect(history.prompts).toEqual([]);
      expect(history.created).toBeDefined();
      expect(history.updated).toBeDefined();
      expect(history.deleted).toBe(false);
    });

    it("should create a history with prompts", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = await GptHistory.create({
        prompts: [
          {text: "Hello", type: "user"},
          {model: "gpt-4", text: "Hi there!", type: "assistant"},
        ],
        userId,
      });

      expect(history.prompts.length).toBe(2);
      expect(history.prompts[0].text).toBe("Hello");
      expect(history.prompts[0].type).toBe("user");
      expect(history.prompts[1].text).toBe("Hi there!");
      expect(history.prompts[1].type).toBe("assistant");
      expect(history.prompts[1].model).toBe("gpt-4");
    });

    it("should require userId", async () => {
      await expect(GptHistory.create({prompts: []})).rejects.toThrow();
    });
  });

  describe("title", () => {
    it("should not auto-generate title on save", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = new GptHistory({
        prompts: [
          {text: "What is AI?", type: "user"},
          {
            text: "Artificial Intelligence is a branch of computer science that aims to create intelligent machines.",
            type: "assistant",
          },
        ],
        userId,
      });

      await history.save();

      expect(history.title).toBeUndefined();
    });

    it("should preserve title when explicitly set", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = new GptHistory({
        prompts: [{text: "Some response", type: "assistant"}],
        title: "Custom Title",
        userId,
      });

      await history.save();

      expect(history.title).toBe("Custom Title");
    });
  });

  describe("multi-modal content", () => {
    it("should store content parts on a prompt", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = await GptHistory.create({
        prompts: [
          {
            content: [
              {text: "What is in this image?", type: "text"},
              {mimeType: "image/jpeg", type: "image", url: "https://example.com/img.jpg"},
            ],
            text: "What is in this image?",
            type: "user",
          },
        ],
        userId,
      });

      expect(history.prompts[0].content).toBeDefined();
      expect(history.prompts[0].content?.length).toBe(2);
      expect(history.prompts[0].content?.[0].type).toBe("text");
      expect(history.prompts[0].content?.[1].type).toBe("image");
      const imagePart = history.prompts[0].content?.[1] as {type: string; url: string};
      expect(imagePart.url).toBe("https://example.com/img.jpg");
    });

    it("should store file content parts", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = await GptHistory.create({
        prompts: [
          {
            content: [
              {text: "Summarize this PDF", type: "text"},
              {
                filename: "report.pdf",
                mimeType: "application/pdf",
                type: "file",
                url: "https://example.com/report.pdf",
              },
            ],
            text: "Summarize this PDF",
            type: "user",
          },
        ],
        userId,
      });

      expect(history.prompts[0].content?.[1].type).toBe("file");
      const filePart = history.prompts[0].content?.[1] as {
        type: string;
        filename: string;
        mimeType: string;
      };
      expect(filePart.filename).toBe("report.pdf");
      expect(filePart.mimeType).toBe("application/pdf");
    });
  });

  describe("tool call prompts", () => {
    it("should store tool-call type prompts", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = await GptHistory.create({
        prompts: [
          {text: "What time is it?", type: "user"},
          {
            args: {timezone: "UTC"},
            text: "Tool call: get_time",
            toolCallId: "call-123",
            toolName: "get_time",
            type: "tool-call",
          },
        ],
        userId,
      });

      expect(history.prompts[1].type).toBe("tool-call");
      expect(history.prompts[1].toolName).toBe("get_time");
      expect(history.prompts[1].toolCallId).toBe("call-123");
      expect(history.prompts[1].args).toEqual({timezone: "UTC"});
    });

    it("should store tool-result type prompts", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = await GptHistory.create({
        prompts: [
          {
            result: {time: "2024-01-01T00:00:00Z"},
            text: "Tool result: get_time",
            toolCallId: "call-123",
            toolName: "get_time",
            type: "tool-result",
          },
        ],
        userId,
      });

      expect(history.prompts[0].type).toBe("tool-result");
      expect(history.prompts[0].toolName).toBe("get_time");
      expect(history.prompts[0].result).toEqual({time: "2024-01-01T00:00:00Z"});
    });
  });

  describe("asks", () => {
    const planAsk = {
      options: [
        {id: "starter", label: "Starter"},
        {id: "team", label: "Team"},
      ],
      prompt: "Which plan should I set up?",
      select: "one",
    };
    const pendingAsk = {
      created: new Date("2026-09-27T12:00:00.000Z"),
      input: planAsk,
      kind: "choice",
      promptIndex: 1,
      responseMessages: [
        {
          content: [
            {input: {}, toolCallId: "call_lookup", toolName: "lookupPlans", type: "tool-call"},
            {input: planAsk, toolCallId: "call_plan", toolName: "ask_choice", type: "tool-call"},
          ],
          role: "assistant",
        },
      ],
      simple: {
        buttons: [
          {
            id: "option:starter",
            label: "Starter",
            response: {action: "accept", content: {selected: ["starter"]}},
            style: "default",
          },
          {
            id: "option:team",
            label: "Team",
            response: {action: "accept", content: {selected: ["team"]}},
            style: "default",
          },
          {id: "skip", label: "Skip", response: {action: "decline"}, style: "cancel"},
        ],
        handoff: false,
        kind: "choice",
        text: "Which plan should I set up?",
        toolCallId: "call_plan",
      },
      toolCallId: "call_plan",
    };
    const askRow = {
      args: planAsk,
      ask: {kind: "choice", status: "pending"},
      text: "Tool call: ask_choice",
      toolCallId: "call_plan",
      toolName: "ask_choice",
      type: "tool-call",
    };

    it("loads a history saved before asks existed", async () => {
      const userId = new mongoose.Types.ObjectId();
      const {insertedId} = await GptHistory.collection.insertOne({
        created: new Date("2026-01-05T09:00:00.000Z"),
        deleted: false,
        prompts: [
          {text: "What time is it?", type: "user"},
          {
            args: {},
            text: "Tool call: get_time",
            toolCallId: "c1",
            toolName: "get_time",
            type: "tool-call",
          },
        ],
        updated: new Date("2026-01-05T09:00:00.000Z"),
        userId,
      });

      const history = await GptHistory.findById(insertedId);

      expect(history?.pendingAsk).toBeUndefined();
      expect(history?.prompts[1].ask).toBeUndefined();
      expect(history?.prompts[1].toolName).toBe("get_time");
    });

    it("stores a pending ask and its row, keeping empty objects in responseMessages", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = await GptHistory.create({
        pendingAsk,
        prompts: [{text: "Set up my workspace", type: "user"}, askRow],
        userId,
      });

      const stored = await GptHistory.collection.findOne({_id: history._id});

      expect(stored?.pendingAsk).toEqual(pendingAsk);
      expect(stored?.prompts[1].ask).toEqual({kind: "choice", status: "pending"});
    });

    it("keeps empty objects in responseMessages when a pending ask replaces another", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = await GptHistory.create({prompts: [], userId});

      history.pendingAsk = pendingAsk as unknown as NonNullable<typeof history.pendingAsk>;
      await history.save();

      const stored = await GptHistory.collection.findOne({_id: history._id});
      expect(stored?.pendingAsk.responseMessages[0].content[0]).toEqual({
        input: {},
        toolCallId: "call_lookup",
        toolName: "lookupPlans",
        type: "tool-call",
      });
    });

    it.each([
      {
        expected: 'at path "pendingAsk" because of "StrictModeError"',
        field: "pendingAsk",
        history: {pendingAsk: {...pendingAsk, note: "extra"}},
      },
      {
        expected: 'at path "ask" because of "StrictModeError"',
        field: "prompts.ask",
        history: {prompts: [{...askRow, ask: {kind: "choice", note: "extra", status: "pending"}}]},
      },
    ])("rejects an unknown key in $field", async ({expected, history}) => {
      await expect(
        GptHistory.create({...history, userId: new mongoose.Types.ObjectId()})
      ).rejects.toThrow(expected);
    });

    it.each([
      {
        expected: "`form` is not a valid enum value for path `kind`",
        history: {pendingAsk: {...pendingAsk, kind: "form"}},
        label: "an unknown pending ask kind",
      },
      {
        expected: "`form` is not a valid enum value for path `kind`",
        history: {prompts: [{...askRow, ask: {kind: "form", status: "pending"}}]},
        label: "an unknown row ask kind",
      },
      {
        expected: "`done` is not a valid enum value for path `status`",
        history: {prompts: [{...askRow, ask: {kind: "choice", status: "done"}}]},
        label: "an unknown row ask status",
      },
      {
        expected: "Path `toolCallId` is required.",
        history: {pendingAsk: {...pendingAsk, toolCallId: undefined}},
        label: "a pending ask without a toolCallId",
      },
    ])("rejects $label", async ({expected, history}) => {
      await expect(
        GptHistory.create({...history, userId: new mongoose.Types.ObjectId()})
      ).rejects.toThrow(expected);
    });
  });

  describe("soft delete", () => {
    it("should filter out deleted records by default", async () => {
      const userId = new mongoose.Types.ObjectId();
      await GptHistory.create({deleted: true, prompts: [], userId});
      await GptHistory.create({prompts: [], userId});

      const results = await GptHistory.find({});
      expect(results.length).toBe(1);
    });
  });
});
