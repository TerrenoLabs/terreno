import {describe, expect, it, mock} from "bun:test";
import {assert} from "chai";

import {
  OBS_TEST_MULTI_STAGE_CALL_1_OUTPUT_SCHEMA,
  OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME,
  OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME,
  OBS_TEST_MULTI_STAGE_FINAL_SCHEMA_NAME,
} from "./testMultiStageSchemas";
import {runTestMultiStageWorkflow} from "./testMultiStageWorkflow";
import type {ObservabilityGenerateClient, TraceRecord} from "./types";

const call1 = {phrase: "alpha phrase"};
const call2 = {keywords: ["beta", "gamma"]};
const finalOutput = {
  keywords: ["beta", "gamma"],
  metrics: {
    call1: {charCount: 12, wordCount: 2},
    call2: {charCount: 11, wordCount: 2},
    combinedCharCount: 23,
  },
  phrase: "alpha phrase",
  sentence: "combined output",
};

const createClient = (behavior: {failOn?: string} = {}): ObservabilityGenerateClient => {
  return {
    generateJsonObject: mock(async ({schemaName}) => {
      if (behavior.failOn && schemaName === behavior.failOn) {
        throw new Error(`failed on ${behavior.failOn}`);
      }
      if (schemaName === OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME) {
        return call1 as never;
      }
      if (schemaName === OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME) {
        return call2 as never;
      }
      if (schemaName === OBS_TEST_MULTI_STAGE_FINAL_SCHEMA_NAME) {
        return finalOutput as never;
      }
      throw new Error(`unexpected schema ${schemaName}`);
    }),
    generateText: mock(async () => {
      throw new Error("multi-stage workflow must use generateJsonObject");
    }),
    modelId: "fake-observability-model",
  };
};

describe("runTestMultiStageWorkflow", () => {
  it("calls generateJsonObject with named output schemas and skipTrace", async () => {
    const aiService = createClient();
    const traces: TraceRecord[] = [];
    const result = await runTestMultiStageWorkflow({
      aiService,
      exportTrace: async (trace) => {
        traces.push(trace);
        return "trace-1";
      },
      input: "Terreno observability smoke input",
    });

    assert.equal(result.traceId, "trace-1");
    assert.deepEqual(result.output, finalOutput);
    const jsonCalls = (aiService.generateJsonObject as ReturnType<typeof mock>).mock.calls;
    assert.equal(jsonCalls.length, 3);
    assert.deepEqual(
      jsonCalls.map((call) => (call[0] as {schemaName?: string}).schemaName),
      [
        OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME,
        OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME,
        OBS_TEST_MULTI_STAGE_FINAL_SCHEMA_NAME,
      ]
    );
    for (const call of jsonCalls) {
      const args = call[0] as {skipTrace?: boolean; schema?: unknown};
      assert.equal(args.skipTrace, true);
      assert.isOk(args.schema);
    }
    assert.equal((aiService.generateText as ReturnType<typeof mock>).mock.calls.length, 0);

    const llmSpans = traces[0].spans.filter((span) => span.kind === "LLM");
    assert.equal(llmSpans.length, 3);
    const call1Input = llmSpans[0].input as {
      outputSchema?: Record<string, unknown>;
      schemaName?: string;
    };
    assert.equal(call1Input.schemaName, OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME);
    assert.deepEqual(call1Input.outputSchema, OBS_TEST_MULTI_STAGE_CALL_1_OUTPUT_SCHEMA);
    assert.deepEqual(llmSpans[0].output, call1);
    assert.deepEqual(traces[0].output, finalOutput);
  });

  it("exports an error trace when a schema-backed stage fails", async () => {
    const aiService = createClient({failOn: OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME});
    const traces: TraceRecord[] = [];
    await expect(
      runTestMultiStageWorkflow({
        aiService,
        exportTrace: async (trace) => {
          traces.push(trace);
          return "trace-error";
        },
        input: "fail second schema stage",
      })
    ).rejects.toThrow(`failed on ${OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME}`);

    assert.equal(traces[0].status, "error");
    const call2Span = traces[0].spans.find((span) => span.name === "call-2");
    assert.equal(call2Span?.status, "error");
    const call2Input = call2Span?.input as {schemaName?: string};
    assert.equal(call2Input.schemaName, OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME);
  });
});
