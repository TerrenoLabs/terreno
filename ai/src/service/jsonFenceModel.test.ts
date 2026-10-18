import {describe, expect, it} from "bun:test";
import type {LanguageModel} from "ai";

import {withStrippedJsonFencesModel} from "./jsonFenceModel";

interface GenerateResult {
  content?: Array<{text?: string; type: string}>;
}

const modelReturning = (result: GenerateResult | undefined) =>
  ({
    doGenerate: async () => result,
    modelId: "mock-model",
    provider: "mock",
  }) as unknown as LanguageModel;

const generate = (model: LanguageModel): Promise<GenerateResult | undefined> =>
  (model as unknown as {doGenerate: (options: unknown) => Promise<GenerateResult>}).doGenerate({});

describe("withStrippedJsonFencesModel", () => {
  it("strips code fences from text parts and leaves other parts alone", async () => {
    const toolCall = {input: "{}", toolCallId: "c1", toolName: "lookup", type: "tool-call"};
    const wrapped = withStrippedJsonFencesModel(
      modelReturning({content: [{text: '```json\n{"a": 1}\n```', type: "text"}, toolCall]})
    );
    expect(await generate(wrapped)).toEqual({
      content: [{text: '{"a":1}', type: "text"}, toolCall],
    });
    // Other properties pass through.
    expect((wrapped as unknown as {modelId: string}).modelId).toBe("mock-model");
  });

  it("returns a result without a content array unchanged", async () => {
    expect(await generate(withStrippedJsonFencesModel(modelReturning({})))).toEqual({});
    expect(await generate(withStrippedJsonFencesModel(modelReturning(undefined)))).toBeUndefined();
  });

  it("passes through string model ids and models without doGenerate", () => {
    expect(withStrippedJsonFencesModel("provider/model" as LanguageModel)).toBe(
      "provider/model" as LanguageModel
    );
    const noGenerate = {doGenerate: "not a function", modelId: "x"} as unknown as LanguageModel;
    expect(
      (withStrippedJsonFencesModel(noGenerate) as unknown as {doGenerate: string}).doGenerate
    ).toBe("not a function");
  });
});
