import {randomUUID} from "node:crypto";
import type {FlexibleSchema} from "ai";
import {DateTime} from "luxon";
import type mongoose from "mongoose";
import {
  OBS_TEST_MULTI_STAGE_CALL_1_SYSTEM,
  OBS_TEST_MULTI_STAGE_CALL_2_SYSTEM,
  OBS_TEST_MULTI_STAGE_FINAL_SYSTEM,
} from "../service/prompts";
import type {
  ObsTestMultiStageCall1Output,
  ObsTestMultiStageCall2Output,
  ObsTestMultiStageFinalOutput,
} from "../types";
import {
  OBS_TEST_MULTI_STAGE_CALL_1_OUTPUT_SCHEMA,
  OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME,
  OBS_TEST_MULTI_STAGE_CALL_2_OUTPUT_SCHEMA,
  OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME,
  OBS_TEST_MULTI_STAGE_FINAL_OUTPUT_SCHEMA,
  OBS_TEST_MULTI_STAGE_FINAL_SCHEMA_NAME,
  obsTestMultiStageCall1Schema,
  obsTestMultiStageCall2Schema,
  obsTestMultiStageFinalSchema,
} from "./testMultiStageSchemas";
import type {ObservabilityGenerateClient, SpanRecord, TraceRecord} from "./types";

export interface TestMultiStageStageSummary {
  name: string;
  output?: unknown;
  status: "error" | "ok";
}

export interface TestMultiStageWorkflowResult {
  output: ObsTestMultiStageFinalOutput;
  stages: TestMultiStageStageSummary[];
  traceId?: string;
}

export interface TestMultiStageWorkflowParams {
  aiService: ObservabilityGenerateClient;
  exportTrace: (trace: TraceRecord) => Promise<string | undefined>;
  input: string;
  userId?: mongoose.Types.ObjectId;
}

const toIsoUtc = (millis: number): string => {
  return DateTime.fromMillis(millis, {zone: "utc"}).toISO() ?? "";
};

const computeTextMetrics = (text: string): {charCount: number; wordCount: number} => {
  return {
    charCount: text.length,
    wordCount: text.split(/\s+/).filter((word) => word.length > 0).length,
  };
};

const buildChildSpan = (params: {
  endedAt: number;
  error?: string;
  input: unknown;
  kind: SpanRecord["kind"];
  name: string;
  output?: unknown;
  startedAt: number;
  status: "error" | "ok";
  traceStart: number;
}): SpanRecord => {
  return {
    durationMs: params.endedAt - params.startedAt,
    endedAt: toIsoUtc(params.endedAt),
    id: randomUUID(),
    input: params.input,
    kind: params.kind,
    name: params.name,
    output: params.output,
    startedAt: toIsoUtc(params.startedAt),
    startOffsetMs: params.startedAt - params.traceStart,
    status: params.status,
    ...(params.error ? {error: params.error} : {}),
  };
};

const buildTrace = (params: {
  childSpans: SpanRecord[];
  errorSummary?: string;
  input: string;
  output?: unknown;
  status: "error" | "ok";
  traceStart: number;
  userId?: mongoose.Types.ObjectId;
}): TraceRecord => {
  const endedAt = DateTime.now().toMillis();
  const rootId = randomUUID();
  const rootSpan: SpanRecord = {
    durationMs: endedAt - params.traceStart,
    endedAt: toIsoUtc(endedAt),
    id: rootId,
    input: params.input,
    kind: "CHAIN",
    name: "test-multi-stage",
    output: params.output,
    startedAt: toIsoUtc(params.traceStart),
    status: params.status,
    ...(params.errorSummary ? {error: params.errorSummary} : {}),
  };
  return {
    endedAt: toIsoUtc(endedAt),
    id: randomUUID(),
    input: params.input,
    name: "test-multi-stage",
    output: params.output,
    prompts: [],
    sensitive: false,
    spans: [
      rootSpan,
      ...params.childSpans.map((child) => {
        return {
          ...child,
          parentSpanId: rootId,
        };
      }),
    ],
    startedAt: toIsoUtc(params.traceStart),
    status: params.status,
    userId: params.userId?.toString(),
    ...(params.errorSummary ? {error: params.errorSummary} : {}),
  };
};

const runLlmObjectStage = async <OBJECT>(params: {
  aiService: ObservabilityGenerateClient;
  childSpans: SpanRecord[];
  exportTrace: TestMultiStageWorkflowParams["exportTrace"];
  name: string;
  prompt: string;
  schema: FlexibleSchema<OBJECT>;
  schemaDescription: string;
  schemaName: string;
  stages: TestMultiStageStageSummary[];
  systemPrompt: string;
  outputSchema: Record<string, unknown>;
  traceStart: number;
  userId?: mongoose.Types.ObjectId;
  workflowInput: string;
}): Promise<OBJECT> => {
  const startedAt = DateTime.now().toMillis();
  const spanInput = {
    outputSchema: params.outputSchema,
    prompt: params.prompt,
    schemaName: params.schemaName,
  };
  try {
    const output = await params.aiService.generateJsonObject({
      prompt: params.prompt,
      schema: params.schema,
      schemaDescription: params.schemaDescription,
      schemaName: params.schemaName,
      skipTrace: true,
      systemPrompt: params.systemPrompt,
      userId: params.userId,
    });
    const endedAt = DateTime.now().toMillis();
    params.childSpans.push(
      buildChildSpan({
        endedAt,
        input: spanInput,
        kind: "LLM",
        name: params.name,
        output,
        startedAt,
        status: "ok",
        traceStart: params.traceStart,
      })
    );
    params.stages.push({name: params.name, output, status: "ok"});
    return output;
  } catch (error) {
    const endedAt = DateTime.now().toMillis();
    const message = error instanceof Error ? error.message : String(error);
    params.childSpans.push(
      buildChildSpan({
        endedAt,
        error: message,
        input: spanInput,
        kind: "LLM",
        name: params.name,
        output: undefined,
        startedAt,
        status: "error",
        traceStart: params.traceStart,
      })
    );
    params.stages.push({name: params.name, status: "error"});
    const trace = buildTrace({
      childSpans: params.childSpans,
      errorSummary: message,
      input: params.workflowInput,
      status: "error",
      traceStart: params.traceStart,
      userId: params.userId,
    });
    await params.exportTrace(trace);
    throw error;
  }
};

export const runTestMultiStageWorkflow = async (
  params: TestMultiStageWorkflowParams
): Promise<TestMultiStageWorkflowResult> => {
  const traceStart = DateTime.now().toMillis();
  const childSpans: SpanRecord[] = [];
  const stages: TestMultiStageStageSummary[] = [];

  const call1Output = await runLlmObjectStage<ObsTestMultiStageCall1Output>({
    aiService: params.aiService,
    childSpans,
    exportTrace: params.exportTrace,
    name: "call-1",
    outputSchema: OBS_TEST_MULTI_STAGE_CALL_1_OUTPUT_SCHEMA,
    prompt: params.input,
    schema: obsTestMultiStageCall1Schema,
    schemaDescription: "Short phrase summary of the user input",
    schemaName: OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME,
    stages,
    systemPrompt: OBS_TEST_MULTI_STAGE_CALL_1_SYSTEM,
    traceStart,
    userId: params.userId,
    workflowInput: params.input,
  });
  const call2Output = await runLlmObjectStage<ObsTestMultiStageCall2Output>({
    aiService: params.aiService,
    childSpans,
    exportTrace: params.exportTrace,
    name: "call-2",
    outputSchema: OBS_TEST_MULTI_STAGE_CALL_2_OUTPUT_SCHEMA,
    prompt: params.input,
    schema: obsTestMultiStageCall2Schema,
    schemaDescription: "Exactly two keywords from the user input",
    schemaName: OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME,
    stages,
    systemPrompt: OBS_TEST_MULTI_STAGE_CALL_2_SYSTEM,
    traceStart,
    userId: params.userId,
    workflowInput: params.input,
  });

  const call1Text = call1Output.phrase;
  const call2Text = call2Output.keywords.join(", ");
  const toolStartedAt = DateTime.now().toMillis();
  const toolOutput = {
    call1: computeTextMetrics(call1Text),
    call2: computeTextMetrics(call2Text),
    combinedCharCount: call1Text.length + call2Text.length,
  };
  const toolEndedAt = DateTime.now().toMillis();
  childSpans.push(
    buildChildSpan({
      endedAt: toolEndedAt,
      input: {call1: call1Output, call2: call2Output},
      kind: "TOOL",
      name: "text-metrics",
      output: toolOutput,
      startedAt: toolStartedAt,
      status: "ok",
      traceStart,
    })
  );
  stages.push({name: "text-metrics", output: toolOutput, status: "ok"});

  const finalPrompt =
    `Stage one phrase: ${call1Output.phrase}\n` +
    `Stage two keywords: ${JSON.stringify(call2Output.keywords)}\n` +
    `Text metrics: ${JSON.stringify(toolOutput)}`;
  const finalOutput = await runLlmObjectStage<ObsTestMultiStageFinalOutput>({
    aiService: params.aiService,
    childSpans,
    exportTrace: params.exportTrace,
    name: "final",
    outputSchema: OBS_TEST_MULTI_STAGE_FINAL_OUTPUT_SCHEMA,
    prompt: finalPrompt,
    schema: obsTestMultiStageFinalSchema,
    schemaDescription: "Combined sentence plus echoed phrase, keywords, and metrics",
    schemaName: OBS_TEST_MULTI_STAGE_FINAL_SCHEMA_NAME,
    stages,
    systemPrompt: OBS_TEST_MULTI_STAGE_FINAL_SYSTEM,
    traceStart,
    userId: params.userId,
    workflowInput: params.input,
  });

  const trace = buildTrace({
    childSpans,
    input: params.input,
    output: finalOutput,
    status: "ok",
    traceStart,
    userId: params.userId,
  });
  const traceId = await params.exportTrace(trace);

  return {
    output: finalOutput,
    stages,
    traceId,
  };
};
