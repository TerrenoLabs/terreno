import {describe, expect, it} from "bun:test";

import {
  createMockLanguageModel,
  type MockLanguageModelStreamPart,
  mockLanguageModelStreamParts,
} from "./aiSdk";

const readParts = async (
  stream: ReadableStream<MockLanguageModelStreamPart>
): Promise<MockLanguageModelStreamPart[]> => {
  const parts: MockLanguageModelStreamPart[] = [];
  const reader = stream.getReader();
  while (true) {
    const {done, value} = await reader.read();
    if (done) {
      return parts;
    }
    parts.push(value);
  }
};

describe("createMockLanguageModel", () => {
  it("defaults to a v2 model that answers with a fixed text", async (): Promise<void> => {
    const model = createMockLanguageModel();

    expect(model.specificationVersion).toBe("v2");
    expect(model.modelId).toBe("mock-model");
    expect(model.provider).toBe("mock-provider");
    expect(model.supportedUrls).toEqual({});

    const result = await model.doGenerate({prompt: []});
    expect(result).toEqual({
      content: [{text: "Mock response", type: "text"}],
      finishReason: "stop",
      usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2},
      warnings: [],
    });
    expect(model.doGenerate).toHaveBeenCalledWith({prompt: []});
  });

  it("scripts text, tool-call, and repeated turns across generate and stream", async (): Promise<void> => {
    const model = createMockLanguageModel({
      modelId: "scripted",
      provider: "test",
      responses: [
        {
          toolCalls: [
            {input: {city: "SF"}, toolName: "weather"},
            {input: undefined, toolCallId: "x", toolName: "noop"},
          ],
        },
        {chunks: ["Sun", "ny"], usage: {inputTokens: 3, outputTokens: 2, totalTokens: 5}},
      ],
    });

    const first = await model.doGenerate({});
    expect(first.content).toEqual([
      {input: '{"city":"SF"}', toolCallId: "call_1", toolName: "weather", type: "tool-call"},
      {input: "{}", toolCallId: "x", toolName: "noop", type: "tool-call"},
    ]);
    expect(first.finishReason).toBe("tool-calls");

    const {stream} = await model.doStream({});
    expect(await readParts(stream)).toEqual([
      {type: "stream-start", warnings: []},
      {id: "text-1", type: "text-start"},
      {delta: "Sun", id: "text-1", type: "text-delta"},
      {delta: "ny", id: "text-1", type: "text-delta"},
      {id: "text-1", type: "text-end"},
      {
        finishReason: "stop",
        type: "finish",
        usage: {inputTokens: 3, outputTokens: 2, totalTokens: 5},
      },
    ]);

    const repeated = await model.doGenerate({});
    expect(repeated.content).toEqual([{text: "Sunny", type: "text"}]);
    expect(model.modelId).toBe("scripted");
  });

  it("fails generate calls and errors streams after the text", async (): Promise<void> => {
    const model = createMockLanguageModel({responses: [{error: "provider down", text: "partial"}]});

    await expect(model.doGenerate({})).rejects.toThrow("provider down");

    const {stream} = await model.doStream({});
    const reader = stream.getReader();
    expect((await reader.read()).value?.type).toBe("stream-start");
    expect((await reader.read()).value?.type).toBe("text-start");
    expect((await reader.read()).value).toEqual({
      delta: "partial",
      id: "text-1",
      type: "text-delta",
    });
    expect((await reader.read()).value?.type).toBe("text-end");
    await expect(reader.read()).rejects.toThrow("provider down");
  });

  it("reset clears calls, overrides, and restarts the script", async (): Promise<void> => {
    const model = createMockLanguageModel({responses: [{text: "one"}, {text: "two"}]});
    await model.doGenerate({});
    model.doGenerate.mockRejectedValueOnce(new Error("override"));
    await expect(model.doGenerate({})).rejects.toThrow("override");

    model.reset();

    expect(model.doGenerate).toHaveBeenCalledTimes(0);
    expect((await model.doGenerate({})).content).toEqual([{text: "one", type: "text"}]);
  });
});

describe("mockLanguageModelStreamParts", () => {
  it("honors an explicit finish reason and omits text parts without text", (): void => {
    expect(mockLanguageModelStreamParts({finishReason: "length"})).toEqual([
      {type: "stream-start", warnings: []},
      {
        finishReason: "length",
        type: "finish",
        usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2},
      },
    ]);
  });
});
