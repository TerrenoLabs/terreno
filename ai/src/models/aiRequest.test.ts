import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {AIRequest} from "./aiRequest";

describe("AIRequest Model", () => {
  beforeEach(async () => {
    await AIRequest.deleteMany({});
  });

  afterEach(async () => {
    await AIRequest.deleteMany({});
  });

  describe("schema", () => {
    it("should create an AI request with required fields", async () => {
      const request = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "Hello",
        requestType: "general",
      });

      expect(request.aiModel).toBe("gpt-4");
      expect(request.prompt).toBe("Hello");
      expect(request.requestType).toBe("general");
      expect(request.created).toBeDefined();
      expect(request.updated).toBeDefined();
      expect(request.deleted).toBe(false);
    });

    it("should create a request with all fields", async () => {
      const userId = new mongoose.Types.ObjectId();
      const request = await AIRequest.create({
        aiModel: "gemini-3.8-flash",
        error: undefined,
        metadata: {key: "value"},
        prompt: "Translate this",
        requestType: "translation",
        response: "Translated text",
        responseTime: 1500,
        tokensUsed: 100,
        userId,
      });

      expect(request.aiModel).toBe("gemini-3.8-flash");
      expect(request.requestType).toBe("translation");
      expect(request.response).toBe("Translated text");
      expect(request.responseTime).toBe(1500);
      expect(request.tokensUsed).toBe(100);
      expect(request.userId?.toString()).toBe(userId.toString());
      expect(request.metadata).toEqual({key: "value"});
    });

    it("should accept custom request types", async () => {
      const request = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "test",
        requestType: "custom-type",
      });

      expect(request.requestType).toBe("custom-type");
    });
  });

  describe("logRequest static", () => {
    it("should create a request via logRequest", async () => {
      const request = await AIRequest.logRequest({
        aiModel: "gpt-4",
        prompt: "test prompt",
        requestType: "general",
        response: "test response",
        responseTime: 500,
        tokensUsed: 50,
      });

      expect(request._id).toBeDefined();
      expect(request.prompt).toBe("test prompt");
      expect(request.response).toBe("test response");
    });
  });

  describe("logMultiAgentRequest static", () => {
    it("should create a parent request with sub-request references", async () => {
      const sub1 = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "sub task 1",
        requestType: "general",
        response: "result 1",
        responseTime: 100,
        tokensUsed: 10,
      });
      const sub2 = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "sub task 2",
        requestType: "general",
        response: "result 2",
        responseTime: 200,
        tokensUsed: 20,
      });

      const parent = await AIRequest.logMultiAgentRequest({
        aiModel: "gpt-4",
        requestType: "multi-agent",
        subRequestIds: [sub1._id, sub2._id],
        totalResponseTime: 300,
        totalTokensUsed: 30,
      });

      expect(parent._id).toBeDefined();
      expect(parent.prompt).toBe("[multi-agent parent request]");
      expect(parent.requestType).toBe("multi-agent");
      expect(parent.totalResponseTime).toBe(300);
      expect(parent.totalTokensUsed).toBe(30);
      expect(parent.subRequestIds).toHaveLength(2);

      // Verify sub-requests were updated with parentRequestId
      const updatedSub1 = await AIRequest.findById(sub1._id);
      const updatedSub2 = await AIRequest.findById(sub2._id);
      expect(updatedSub1?.parentRequestId?.toString()).toBe(parent._id.toString());
      expect(updatedSub2?.parentRequestId?.toString()).toBe(parent._id.toString());
    });

    it("should create a parent request with metadata", async () => {
      const sub = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "sub",
        requestType: "general",
      });

      const parent = await AIRequest.logMultiAgentRequest({
        aiModel: "gpt-4",
        metadata: {workflow: "test"},
        requestType: "multi-agent",
        subRequestIds: [sub._id],
        totalResponseTime: 100,
        totalTokensUsed: 10,
      });

      expect(parent.metadata).toEqual({workflow: "test"});
    });

    it("should create a parent request with userId", async () => {
      const userId = new mongoose.Types.ObjectId();
      const sub = await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "sub",
        requestType: "general",
      });

      const parent = await AIRequest.logMultiAgentRequest({
        aiModel: "gpt-4",
        requestType: "multi-agent",
        subRequestIds: [sub._id],
        totalResponseTime: 50,
        totalTokensUsed: 5,
        userId,
      });

      expect(parent.userId?.toString()).toBe(userId.toString());
    });
  });

  describe("soft delete", () => {
    it("should filter out deleted records by default", async () => {
      await AIRequest.create({
        aiModel: "gpt-4",
        deleted: true,
        prompt: "deleted",
        requestType: "general",
      });
      await AIRequest.create({
        aiModel: "gpt-4",
        prompt: "active",
        requestType: "general",
      });

      const results = await AIRequest.find({});
      expect(results.length).toBe(1);
      expect(results[0].prompt).toBe("active");
    });
  });
});
