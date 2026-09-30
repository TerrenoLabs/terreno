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

    it("should require prompt text when the prompt has no content parts", async () => {
      const userId = new mongoose.Types.ObjectId();
      await expect(
        GptHistory.create({prompts: [{text: "", type: "assistant"}], userId})
      ).rejects.toThrow();
    });

    it("should allow empty prompt text on an image-only response", async () => {
      const userId = new mongoose.Types.ObjectId();
      const history = await GptHistory.create({
        prompts: [
          {
            content: [
              {mimeType: "image/png", type: "image", url: "data:image/png;base64,aGVsbG8="},
            ],
            text: "",
            type: "assistant",
          },
        ],
        userId,
      });

      expect(history.prompts[0].text).toBe("");
      expect(history.prompts[0].content).toHaveLength(1);
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
