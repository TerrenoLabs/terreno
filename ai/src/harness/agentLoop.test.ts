import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setDefaultTimeout,
} from "bun:test";
import {z} from "@terreno/api";
import {APICallError, type LanguageModel} from "ai";
import mongoose from "mongoose";
import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import {generateToStream} from "../tests/generateStream";
import {harnessErrorMatching} from "../tests/harnessErrors";
import type {HarnessAgentDefinition, HarnessTaskDocument, HarnessTestHooks} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import type {ExecutionEnv} from "./executionEnv";
import {
  AGENT_TOOL_TASK_NAME,
  AGENT_TURN_TASK_NAME,
  defineAgent,
  defineTask,
  defineTool,
  Harness,
  HarnessConversationBusyError,
  type HarnessModelRef,
  InProcessRunner,
} from "./harness";
import {registerHarnessConversation} from "./models/harnessConversation";
import {registerHarnessMessage} from "./models/harnessMessage";
import {registerHarnessTask} from "./models/harnessTask";

interface ScriptedToolCall {
  id: string;
  input: Record<string, unknown>;
  name: string;
}

type ScriptStep = {error: unknown} | {text?: string; toolCalls?: ScriptedToolCall[]};

interface GenerateCall {
  prompt: Array<{content: unknown; role: string}>;
  tools?: Array<{name: string}>;
}

/** A LanguageModelV2 mock that answers each request with the next scripted step. */
const scriptedModel = (modelId: string, steps: ScriptStep[]) => {
  const calls: GenerateCall[] = [];
  const model = {
    doGenerate: mock(async (options: GenerateCall) => {
      calls.push(options);
      const step = steps.shift();
      if (!step) {
        throw new Error(`${modelId} script exhausted`);
      }
      if ("error" in step) {
        throw step.error;
      }
      const toolCalls = step.toolCalls ?? [];
      return {
        content: [
          ...(step.text ? [{text: step.text, type: "text" as const}] : []),
          ...toolCalls.map((call) => ({
            input: JSON.stringify(call.input),
            toolCallId: call.id,
            toolName: call.name,
            type: "tool-call" as const,
          })),
        ],
        finishReason: toolCalls.length > 0 ? ("tool-calls" as const) : ("stop" as const),
        usage: {inputTokens: 100, outputTokens: 20, totalTokens: 120},
        warnings: [],
      };
    }),
    doStream: mock(async (options: GenerateCall) =>
      generateToStream(await model.doGenerate(options))
    ),
    modelId,
    provider: "mock",
    specificationVersion: "v2" as const,
    supportedUrls: {},
  };
  return {calls, model};
};

const httpError = (statusCode: number): APICallError =>
  new APICallError({
    isRetryable: statusCode === 429 || statusCode >= 500,
    message: `HTTP ${statusCode}`,
    requestBodyValues: {},
    statusCode,
    url: "https://mock.invalid/v1/chat",
  });

/** Plain JSON copy; matchers must never walk mongoose documents (they recurse forever). */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const PRIMARY: HarnessModelRef = {modelId: "primary-model", provider: "mock"};
const FALLBACK: HarnessModelRef = {modelId: "fallback-model", provider: "mock"};

// Each test opens a harness and runs whole turns on a real replica set; the first one also
// pays for collection and index creation. A timed-out test makes Bun kill mongod.
setDefaultTimeout(20_000);

const TaskModel = registerHarnessTask();
const ConversationModel = registerHarnessConversation();
const MessageModel = registerHarnessMessage();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

const openHarnesses: Harness[] = [];

const openHarness = async ({
  beforeCommitEnd,
  env,
  models,
  registry,
}: {
  beforeCommitEnd?: HarnessTestHooks["beforeCommitEnd"];
  env?: ExecutionEnv;
  models: Record<string, ReturnType<typeof scriptedModel>["model"]>;
  registry: Parameters<typeof Harness.open>[0]["registry"];
}): Promise<Harness> => {
  const harness = await Harness.open({
    env,
    models: ({modelId}) => {
      const model = models[modelId];
      if (!model) {
        throw new Error(`No mock model ${modelId}`);
      }
      return model as unknown as LanguageModel;
    },
    priceMap: {"primary-model": {inputPerMTok: 3, outputPerMTok: 15}},
    registry,
    runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
    testHooks: {beforeCommitEnd, random: () => 0},
  });
  openHarnesses.push(harness);
  await harness.start();
  return harness;
};

const lookupTool = defineTool({
  description: "Look up a patient's chart by id",
  execute: async ({patientId}: {patientId: string}, api) => {
    api.output(`fetching ${patientId}`);
    return {chart: `chart-${patientId}`, conversationId: api.conversationId};
  },
  name: "lookup",
  parameters: z.object({patientId: z.string()}),
});

const agentWith = (
  overrides: Partial<Parameters<typeof defineAgent>[0]> = {}
): HarnessAgentDefinition =>
  defineAgent({
    instructions: "Answer the clinician.",
    model: PRIMARY,
    modelRetry: {backoffMs: 1, maxBackoffMs: 2},
    name: "test.clinician",
    tools: [lookupTool],
    ...overrides,
  });

const messagesOf = async (
  conversationId: string
): Promise<Array<{parts: unknown; role: string; seq: number; status?: string}>> => {
  const rows = await MessageModel.find({conversationId}).sort({seq: 1});
  return rows.map(({parts, role, seq, status}) => ({parts, role, seq, status}));
};

const spansOf = (task: HarnessTaskDocument) =>
  SpanModel.find({traceId: task.traceId}).sort({_id: 1, startedAt: 1});

describe("Agent turns", () => {
  beforeAll(async () => {
    // The shared preload's beforeEach imports this lazily under a 5 s hook timeout; a
    // cold first import can exceed it, so load it here first.
    await import("../langfuseClient");
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
  });

  beforeEach(async () => {
    await Promise.all([
      TaskModel.deleteMany({}),
      ConversationModel.deleteMany({}),
      MessageModel.deleteMany({}),
      SpanModel.deleteMany({}),
      TraceModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
  });

  it("answers a single text turn and records the transcript and an LLM span with cost", async () => {
    const primary = scriptedModel("primary-model", [{text: "The chart looks normal."}]);
    const agent = agentWith({tools: []});
    const harness = await openHarness({
      models: {"primary-model": primary.model},
      registry: [agent],
    });
    const userId = new mongoose.Types.ObjectId();

    const conversation = await harness.createConversation({agent, userId});
    expect(plain(conversation.document.agent)).toMatchObject({
      instructions: "Answer the clinician.",
      maxSteps: 10,
      model: PRIMARY,
      name: "test.clinician",
      tools: [],
    });
    const turn = await conversation.submit({content: "How is the chart?", requestId: "r1"});
    expect(turn.name).toBe(AGENT_TURN_TASK_NAME);
    expect(plain(turn.ownership)).toEqual({id: conversation.id, kind: "conversation"});
    expect(String(turn.userId)).toBe(String(userId));

    const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});
    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toEqual({
      finishReason: "stop",
      steps: 1,
      text: "The chart looks normal.",
    });
    expect(await messagesOf(conversation.id)).toEqual([
      {parts: [{text: "How is the chart?", type: "text"}], role: "user", seq: 1, status: undefined},
      {
        parts: [{text: "The chart looks normal.", type: "text"}],
        role: "assistant",
        seq: 2,
        status: undefined,
      },
    ]);
    // The model saw the system prompt and the user's message.
    expect(primary.calls[0]?.prompt).toEqual([
      {content: "Answer the clinician.", role: "system"},
      {content: [{text: "How is the chart?", type: "text"}], role: "user"},
    ]);

    const reloaded = await harness.conversation(conversation.id);
    expect(reloaded.document.status).toBe("idle");
    expect(reloaded.document.activeTurnTaskId).toBeUndefined();
    expect(reloaded.document.seq).toBe(2);

    const llm = await SpanModel.findExactlyOne({kind: "LLM", traceId: done.traceId});
    expect(llm.name).toBe("mock/primary-model");
    expect(String(llm.parentSpanId)).toBe(String(done.rootSpanId));
    expect(llm.status).toBe("ok");
    expect(llm.usage).toEqual({
      costUsd: (3 * 100 + 15 * 20) / 1_000_000,
      inputTokens: 100,
      model: "primary-model",
      outputTokens: 20,
    });
    expect(llm.output).toMatchObject({
      attempts: [{attempt: 1, modelId: "primary-model", provider: "mock"}],
      finishReason: "stop",
      text: "The chart looks normal.",
      toolCalls: [],
    });
    const trace = await TraceModel.findExactlyOne({_id: done.traceId});
    expect(trace.endedAt).toBeDefined();
    expect(trace.status).toBe("ok");
  });

  it("runs a tool call as a child task, feeds its result back, and finishes with the answer", async () => {
    const primary = scriptedModel("primary-model", [
      {toolCalls: [{id: "call-1", input: {patientId: "p7"}, name: "lookup"}]},
      {text: "Chart p7 is fine."},
    ]);
    const env: ExecutionEnv = {
      exec: async () => ({exitCode: 0, stderr: "", stdout: ""}),
      read: async () => "",
      write: async () => {},
    };
    const seen: Array<{args: unknown; envMatches: boolean; hasSignal: boolean; taskId: string}> =
      [];
    const spyTool = defineTool({
      description: "Look up a patient's chart by id",
      execute: async (args: {patientId: string}, api) => {
        seen.push({
          args,
          envMatches: api.env === env,
          hasSignal: api.signal instanceof AbortSignal,
          taskId: api.taskId,
        });
        return lookupTool.execute(args, api);
      },
      name: "lookup",
      parameters: z.object({patientId: z.string()}),
    });
    const agent = agentWith({tools: [spyTool]});
    const harness = await openHarness({
      env,
      models: {"primary-model": primary.model},
      registry: [agent],
    });
    const conversation = await harness.createConversation({agent});
    const turn = await conversation.submit({content: "Check p7", requestId: "r1"});
    const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});

    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toEqual({
      finishReason: "stop",
      steps: 2,
      text: "Chart p7 is fine.",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.args).toEqual({patientId: "p7"});
    expect(seen[0]?.envMatches).toBe(true);
    expect(seen[0]?.hasSignal).toBe(true);

    const toolTask = await TaskModel.findExactlyOne({name: AGENT_TOOL_TASK_NAME});
    expect(String(toolTask._id)).toBe(seen[0]?.taskId);
    expect(plain(toolTask.ownership)).toEqual({id: String(done._id), kind: "task"});
    expect(toolTask.status).toBe("completed");

    expect(await messagesOf(conversation.id)).toEqual([
      {parts: [{text: "Check p7", type: "text"}], role: "user", seq: 1, status: undefined},
      {
        parts: [
          {input: {patientId: "p7"}, toolCallId: "call-1", toolName: "lookup", type: "tool-call"},
        ],
        role: "assistant",
        seq: 2,
        status: undefined,
      },
      {
        parts: [
          {
            isError: false,
            output: {chart: "chart-p7", conversationId: conversation.id},
            toolCallId: "call-1",
            toolName: "lookup",
            type: "tool-result",
          },
        ],
        role: "tool",
        seq: 3,
        status: "ok",
      },
      {
        parts: [{text: "Chart p7 is fine.", type: "text"}],
        role: "assistant",
        seq: 4,
        status: undefined,
      },
    ]);
    // The second request carried the tool result back to the model.
    expect(primary.calls[1]?.prompt.at(-1)).toMatchObject({
      content: [
        {
          output: {type: "json", value: {chart: "chart-p7", conversationId: conversation.id}},
          toolCallId: "call-1",
          toolName: "lookup",
          type: "tool-result",
        },
      ],
      role: "tool",
    });
    expect(primary.calls[0]?.tools?.map(({name}) => name)).toEqual(["lookup"]);

    // Span tree: CHAIN(turn) -> LLM, TOOL (-> its phase CHAIN), LLM.
    const spans = await spansOf(done);
    const root = spans.find(({_id}) => String(_id) === String(done.rootSpanId));
    expect(root?.kind).toBe("CHAIN");
    expect(root?.name).toBe(`${AGENT_TURN_TASK_NAME}@1`);
    const underRoot = spans.filter(({parentSpanId}) => String(parentSpanId) === String(root?._id));
    expect(underRoot.filter(({kind}) => kind === "LLM")).toHaveLength(2);
    const toolSpan = spans.find(({kind}) => kind === "TOOL");
    expect(toolSpan?.name).toBe("lookup");
    expect(String(toolSpan?.parentSpanId)).toBe(String(root?._id));
    expect(String(toolSpan?._id)).toBe(String(toolTask.rootSpanId));
    expect(toolSpan?.status).toBe("ok");
    expect(toolSpan?.endedAt).toBeDefined();
    expect(toolSpan?.output).toEqual({
      streamedOutput: "fetching p7",
      value: {chart: "chart-p7", conversationId: conversation.id},
    });
    const toolPhase = spans.find(
      ({parentSpanId}) => String(parentSpanId) === String(toolSpan?._id)
    );
    expect(toolPhase?.kind).toBe("CHAIN");
    expect(toolPhase?.name).toBe("execute");
    expect(underRoot.filter(({kind, name}) => kind === "CHAIN" && name === "request")).toHaveLength(
      2
    );
  });

  it("stops after maxSteps model requests, answering the last tool calls first", async () => {
    // The same toolCallId in every step: child keys are scoped to the phase visit.
    const call = (patientId: string): ScriptStep => ({
      toolCalls: [{id: "same-id", input: {patientId}, name: "lookup"}],
    });
    const primary = scriptedModel("primary-model", [call("a"), call("b"), call("c")]);
    const agent = agentWith({maxSteps: 2});
    const harness = await openHarness({
      models: {"primary-model": primary.model},
      registry: [agent],
    });
    const conversation = await harness.createConversation({agent});
    const turn = await conversation.submit({content: "Loop", requestId: "r1"});
    const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});

    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toEqual({finishReason: "max-steps", steps: 2, text: ""});
    expect(primary.model.doGenerate).toHaveBeenCalledTimes(2);
    const roles = (await messagesOf(conversation.id)).map(({role}) => role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant", "tool"]);
    expect(await TaskModel.countDocuments({name: AGENT_TOOL_TASK_NAME})).toBe(2);
    const outputs = (await messagesOf(conversation.id))
      .filter(({role}) => role === "tool")
      .map(({parts}) => (parts as Array<{output: {chart: string}}>)[0]?.output.chart);
    expect(outputs).toEqual(["chart-a", "chart-b"]);
    expect((await harness.conversation(conversation.id)).document.status).toBe("idle");
  });

  it("reports failing, invalid, and unknown tool calls to the model as error results", async () => {
    const failing = defineTool({
      description: "Always fails",
      execute: async () => {
        throw new Error("EHR unavailable");
      },
      name: "failing",
      parameters: z.object({}),
    });
    const primary = scriptedModel("primary-model", [
      {
        toolCalls: [
          {id: "c1", input: {}, name: "failing"},
          {id: "c2", input: {patientId: 42}, name: "lookup"},
          {id: "c3", input: {}, name: "missing"},
        ],
      },
      {text: "I could not reach the EHR."},
    ]);
    const agent = agentWith({tools: [lookupTool, failing]});
    const harness = await openHarness({
      models: {"primary-model": primary.model},
      registry: [agent],
    });
    const conversation = await harness.createConversation({agent});
    const turn = await conversation.submit({content: "Try", requestId: "r1"});
    const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});

    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toMatchObject({text: "I could not reach the EHR."});
    const tools = (await messagesOf(conversation.id)).filter(({role}) => role === "tool");
    expect(tools.map(({status}) => status)).toEqual(["error", "error", "error"]);
    const outputs = tools.map(({parts}) => (parts as Array<{output: string}>)[0]?.output);
    expect(outputs[0]).toBe('Tool "failing" failed: EHR unavailable');
    expect(outputs[1]).toStartWith('Invalid arguments for tool "lookup":');
    expect(outputs[2]).toBe('Unknown tool "missing"');
    expect(primary.calls[1]?.prompt.at(-1)).toMatchObject({
      content: [
        {output: {type: "error-text", value: 'Tool "failing" failed: EHR unavailable'}},
        {output: {type: "error-text"}},
        {output: {type: "error-text", value: 'Unknown tool "missing"'}},
      ],
      role: "tool",
    });
    const toolSpans = await SpanModel.find({kind: "TOOL", traceId: done.traceId});
    expect(toolSpans.map(({status}) => status)).toEqual(["error", "error", "error"]);
  });

  it("parses structured output when the agent declares an output schema", async () => {
    const primary = scriptedModel("primary-model", [
      {text: '```json\n{"summary": "stable", "risk": 2}\n```'},
      {text: "not json at all"},
    ]);
    const agent = agentWith({
      name: "test.structured",
      output: z.object({risk: z.number(), summary: z.string()}),
      tools: [],
    });
    const harness = await openHarness({
      models: {"primary-model": primary.model},
      registry: [agent],
    });
    const conversation = await harness.createConversation({agent});
    const first = await harness.waitForTask(
      (await conversation.submit({content: "Summarize", requestId: "r1"}))._id,
      {timeout: {seconds: 10}}
    );
    expect(first.outcome?.result).toMatchObject({output: {risk: 2, summary: "stable"}});

    const second = await harness.waitForTask(
      (await conversation.submit({content: "Again", requestId: "r2"}))._id,
      {timeout: {seconds: 10}}
    );
    expect(second.status).toBe("failed");
    expect(second.outcome?.error).toStartWith('Agent "test.structured" output is not JSON');
    // The answer and its LLM span are still recorded.
    expect((await messagesOf(conversation.id)).map(({role}) => role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(await SpanModel.countDocuments({kind: "LLM", traceId: second.traceId})).toBe(1);
    expect((await harness.conversation(conversation.id)).document.status).toBe("idle");
  });

  describe("model-call resilience", () => {
    it("retries a 503 twice and succeeds on the third attempt (AC4)", async () => {
      const primary = scriptedModel("primary-model", [
        {error: httpError(503)},
        {error: httpError(503)},
        {text: "Recovered."},
      ]);
      const agent = agentWith({tools: []});
      const harness = await openHarness({
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const turn = await conversation.submit({content: "Hi", requestId: "r1"});
      const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});

      expect(done.status).toBe("completed");
      expect(done.outcome?.result).toMatchObject({text: "Recovered."});
      expect(primary.model.doGenerate).toHaveBeenCalledTimes(3);
      const llm = await SpanModel.findExactlyOne({kind: "LLM", traceId: done.traceId});
      expect(llm.name).toBe("mock/primary-model");
      expect((llm.output as {attempts: unknown[]}).attempts).toEqual([
        {
          attempt: 1,
          error: "HTTP 503",
          modelId: "primary-model",
          provider: "mock",
          retryable: true,
          statusCode: 503,
        },
        {
          attempt: 2,
          error: "HTTP 503",
          modelId: "primary-model",
          provider: "mock",
          retryable: true,
          statusCode: 503,
        },
        {attempt: 3, modelId: "primary-model", provider: "mock"},
      ]);
    });

    it("falls back to the next model after three 503s (AC4)", async () => {
      const primary = scriptedModel("primary-model", [
        {error: httpError(503)},
        {error: httpError(503)},
        {error: httpError(503)},
      ]);
      const fallback = scriptedModel("fallback-model", [{text: "From the fallback."}]);
      const agent = agentWith({fallbackModels: [FALLBACK], tools: []});
      const harness = await openHarness({
        models: {"fallback-model": fallback.model, "primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const turn = await conversation.submit({content: "Hi", requestId: "r1"});
      const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});

      expect(done.status).toBe("completed");
      expect(done.outcome?.result).toMatchObject({text: "From the fallback."});
      expect(primary.model.doGenerate).toHaveBeenCalledTimes(3);
      expect(fallback.model.doGenerate).toHaveBeenCalledTimes(1);
      const llm = await SpanModel.findExactlyOne({kind: "LLM", traceId: done.traceId});
      expect(llm.name).toBe("mock/fallback-model");
      // No price for the fallback model, so no cost.
      expect(llm.usage).toEqual({inputTokens: 100, model: "fallback-model", outputTokens: 20});
      expect(
        (llm.output as {attempts: Array<{modelId: string}>}).attempts.map(({modelId}) => modelId)
      ).toEqual(["primary-model", "primary-model", "primary-model", "fallback-model"]);
    });

    it("fails the turn at once on a 400 without retrying or falling back (AC4)", async () => {
      const primary = scriptedModel("primary-model", [{error: httpError(400)}]);
      const fallback = scriptedModel("fallback-model", [{text: "never"}]);
      const agent = agentWith({fallbackModels: [FALLBACK], tools: []});
      const harness = await openHarness({
        models: {"fallback-model": fallback.model, "primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const turn = await conversation.submit({content: "Hi", requestId: "r1"});
      const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});

      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe(
        "Model mock/primary-model failed with a non-retryable error: HTTP 400"
      );
      expect(primary.model.doGenerate).toHaveBeenCalledTimes(1);
      expect(fallback.model.doGenerate).toHaveBeenCalledTimes(0);
      // The failed attempt is still audited, on an error LLM span.
      const llm = await SpanModel.findExactlyOne({kind: "LLM", traceId: done.traceId});
      expect(llm.status).toBe("error");
      expect(llm.name).toBe("mock/primary-model");
      expect(llm.error).toBe(done.outcome?.error);
      expect((llm.output as {attempts: Array<{statusCode: number}>}).attempts).toMatchObject([
        {retryable: false, statusCode: 400},
      ]);
      expect((await harness.conversation(conversation.id)).document.status).toBe("idle");
      expect((await messagesOf(conversation.id)).map(({role}) => role)).toEqual(["user"]);
    });

    it("retries a dropped connection like a 5xx", async () => {
      const primary = scriptedModel("primary-model", [
        {error: new TypeError("fetch failed")},
        {error: Object.assign(new Error("socket hang up"), {code: "ECONNRESET"})},
        {text: "Back online."},
      ]);
      const agent = agentWith({tools: []});
      const harness = await openHarness({
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const turn = await conversation.submit({content: "Hi", requestId: "r1"});
      const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("completed");
      expect(primary.model.doGenerate).toHaveBeenCalledTimes(3);
      const llm = await SpanModel.findExactlyOne({kind: "LLM", traceId: done.traceId});
      expect(
        (llm.output as {attempts: Array<{retryable?: boolean}>}).attempts.map(
          ({retryable}) => retryable
        )
      ).toEqual([true, true, undefined]);
    });

    it("fails the turn once every model exhausts its retries", async () => {
      const primary = scriptedModel("primary-model", [
        {error: httpError(429)},
        {error: httpError(500)},
      ]);
      const agent = agentWith({modelRetry: {backoffMs: 0, maxAttempts: 2}, tools: []});
      const harness = await openHarness({
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const turn = await conversation.submit({content: "Hi", requestId: "r1"});
      const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});

      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe(
        "Model call failed after 2 attempts across mock/primary-model: HTTP 500"
      );
      const llm = await SpanModel.findExactlyOne({kind: "LLM", traceId: done.traceId});
      expect(
        (llm.output as {attempts: Array<{statusCode: number}>}).attempts.map(
          ({statusCode}) => statusCode
        )
      ).toEqual([429, 500]);
      expect((await harness.conversation(conversation.id)).document.status).toBe("idle");
    });

    it("fails without calling anything when the models resolver throws", async () => {
      const agent = agentWith({tools: []});
      const harness = await openHarness({models: {}, registry: [agent]});
      const conversation = await harness.createConversation({agent});
      const turn = await conversation.submit({content: "Hi", requestId: "r1"});
      const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe(
        "Model mock/primary-model could not be resolved: No mock model primary-model"
      );
    });
  });

  describe("conversations", () => {
    it("is idempotent on requestId, rejects a submit while busy, and keeps seq increasing", async () => {
      let releaseTool: () => void = () => {};
      const toolGate = new Promise<void>((resolve) => {
        releaseTool = resolve;
      });
      let toolStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        toolStarted = resolve;
      });
      const slow = defineTool({
        description: "Waits for the test",
        execute: async () => {
          toolStarted();
          await toolGate;
          return "done";
        },
        name: "slow",
        parameters: z.object({}),
        replay: "safe",
      });
      const primary = scriptedModel("primary-model", [
        {toolCalls: [{id: "s1", input: {}, name: "slow"}]},
        {text: "First answer."},
        {text: "Second answer."},
      ]);
      const agent = agentWith({tools: [slow]});
      const harness = await openHarness({
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});

      const first = await conversation.submit({content: "One", requestId: "r1"});
      const repeated = await conversation.submit({content: "One", requestId: "r1"});
      expect(String(repeated._id)).toBe(String(first._id));
      await started;

      const busy = await conversation
        .submit({content: "Two", requestId: "r2"})
        .catch((error: unknown) => error);
      expect(busy).toBeInstanceOf(HarnessConversationBusyError);
      expect((busy as HarnessConversationBusyError).activeTurnTaskId).toBe(String(first._id));
      expect((await harness.conversation(conversation.id)).document.status).toBe("busy");

      releaseTool();
      await harness.waitForTask(first._id, {timeout: {seconds: 10}});
      const second = await conversation.submit({content: "Two", requestId: "r2"});
      const done = await harness.waitForTask(second._id, {timeout: {seconds: 10}});
      expect(done.outcome?.result).toMatchObject({text: "Second answer."});

      const messages = await messagesOf(conversation.id);
      expect(messages.map(({seq}) => seq)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(messages.map(({role}) => role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
        "assistant",
      ]);
      // The second turn's request carried the whole transcript.
      expect(primary.calls[2]?.prompt.map(({role}) => role)).toEqual([
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
      ]);
    });

    it("rejects a racing submit with the running turn's id while that turn is open", async () => {
      let releaseModel: () => void = () => {};
      const modelGate = new Promise<void>((resolve) => {
        releaseModel = resolve;
      });
      const primary = scriptedModel("primary-model", [{text: "held"}]);
      const answer = primary.model.doGenerate.getMockImplementation();
      primary.model.doGenerate.mockImplementation(async (options: GenerateCall) => {
        await modelGate;
        return (answer as (options: GenerateCall) => ReturnType<typeof primary.model.doGenerate>)(
          options
        );
      });
      const agent = agentWith({tools: []});
      const harness = await openHarness({
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const settled = await Promise.allSettled([
        conversation.submit({content: "One", requestId: "r1"}),
        conversation.submit({content: "Two", requestId: "r2"}),
      ]);
      const won = settled.filter((result) => result.status === "fulfilled");
      const lost = settled.filter((result) => result.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      const winner = (won[0] as PromiseFulfilledResult<HarnessTaskDocument>).value;
      const error = (lost[0] as PromiseRejectedResult).reason;
      expect(error).toBeInstanceOf(HarnessConversationBusyError);
      expect((error as HarnessConversationBusyError).activeTurnTaskId).toBe(String(winner._id));

      releaseModel();
      await harness.waitForTask(winner._id, {timeout: {seconds: 10}});
      expect((await messagesOf(conversation.id)).map(({role}) => role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(await TaskModel.countDocuments({name: AGENT_TURN_TASK_NAME})).toBe(1);
    });

    it("lets a racing submit proceed once the winning turn has already finished", async () => {
      // An instant model: the loser may find the conversation busy (and must name the
      // running turn) or idle again (and must start its own turn). Repeat to hit both.
      for (let round = 0; round < 5; round++) {
        const primary = scriptedModel("primary-model", [{text: "a"}, {text: "b"}]);
        const agent = agentWith({name: `test.race${round}`, tools: []});
        const harness = await openHarness({
          models: {"primary-model": primary.model},
          registry: [agent],
        });
        const conversation = await harness.createConversation({agent});
        const settled = await Promise.allSettled([
          conversation.submit({content: "One", requestId: "r1"}),
          conversation.submit({content: "Two", requestId: "r2"}),
        ]);
        const turns = settled
          .filter((result) => result.status === "fulfilled")
          .map((result) => (result as PromiseFulfilledResult<HarnessTaskDocument>).value);
        for (const result of settled) {
          if (result.status === "rejected") {
            expect(result.reason).toBeInstanceOf(HarnessConversationBusyError);
            expect((result.reason as HarnessConversationBusyError).activeTurnTaskId).toBe(
              String(turns[0]?._id)
            );
          }
        }
        for (const turn of turns) {
          expect((await harness.waitForTask(turn._id, {timeout: {seconds: 10}})).status).toBe(
            "completed"
          );
        }
        const messages = await messagesOf(conversation.id);
        expect(messages.map(({seq}) => seq)).toEqual(
          Array.from({length: turns.length * 2}, (_value, index) => index + 1)
        );
        expect(messages.map(({role}) => role)).toEqual(turns.flatMap(() => ["user", "assistant"]));
        await harness.stop();
        await Promise.all([TaskModel.deleteMany({}), MessageModel.deleteMany({})]);
      }
    });

    it("returns the same turn to two concurrent submits with one requestId", async () => {
      const primary = scriptedModel("primary-model", [{text: "only once"}]);
      const agent = agentWith({tools: []});
      const harness = await openHarness({
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const [first, second] = await Promise.all([
        conversation.submit({content: "One", requestId: "r1"}),
        conversation.submit({content: "One", requestId: "r1"}),
      ]);
      expect(String(second._id)).toBe(String(first._id));
      await harness.waitForTask(first._id, {timeout: {seconds: 10}});
      expect((await messagesOf(conversation.id)).map(({seq}) => seq)).toEqual([1, 2]);
    });

    it("writes the transcript, LLM span, and checkpoint atomically", async () => {
      const primary = scriptedModel("primary-model", [{text: "never stored"}]);
      const agent = agentWith({tools: []});
      let failedCommits = 0;
      const harness = await openHarness({
        beforeCommitEnd: ({phase}) => {
          if (phase === "request") {
            failedCommits += 1;
            throw new Error("injected commit failure");
          }
        },
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const turn = await conversation.submit({content: "Hi", requestId: "r1"});
      for (let i = 0; i < 300 && failedCommits === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await harness.stop();
      expect(failedCommits).toBeGreaterThan(0);

      const row = await TaskModel.findExactlyOne({_id: turn._id});
      expect(row.status).toBe("running");
      expect(row.phase).toBe("request");
      expect((await messagesOf(conversation.id)).map(({role}) => role)).toEqual(["user"]);
      expect((await harness.conversation(conversation.id)).document.seq).toBe(1);
      expect(await SpanModel.countDocuments({kind: "LLM", traceId: turn.traceId})).toBe(0);
    });

    it("frees a conversation whose turn finished without releasing it", async () => {
      const primary = scriptedModel("primary-model", [{text: "a"}, {text: "b"}]);
      const agent = agentWith({tools: []});
      const harness = await openHarness({
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const first = await conversation.submit({content: "One", requestId: "r1"});
      await harness.waitForTask(first._id, {timeout: {seconds: 10}});
      // As if the process died between the turn's terminal commit and the release.
      await ConversationModel.updateOne(
        {_id: conversation.document._id},
        {$set: {activeTurnTaskId: first._id, status: "busy"}}
      );
      const second = await conversation.submit({content: "Two", requestId: "r2"});
      expect((await harness.waitForTask(second._id, {timeout: {seconds: 10}})).status).toBe(
        "completed"
      );
    });

    it("aborting a turn aborts its running tool and frees the conversation", async () => {
      let toolStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        toolStarted = resolve;
      });
      const hanging = defineTool({
        description: "Never finishes on its own",
        execute: async (_args, api) => {
          toolStarted();
          await new Promise((_resolve, reject) => {
            api.signal.addEventListener("abort", () => reject(api.signal.reason));
          });
        },
        name: "hanging",
        parameters: z.object({}),
      });
      const primary = scriptedModel("primary-model", [
        {toolCalls: [{id: "h1", input: {}, name: "hanging"}]},
      ]);
      const agent = agentWith({tools: [hanging]});
      const harness = await openHarness({
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});
      const turn = await conversation.submit({content: "Go", requestId: "r1"});
      await started;

      const aborted = await harness.abort(turn._id, {reason: "Clinician cancelled"});
      expect(aborted.status).toBe("aborted");
      const tool = await TaskModel.findExactlyOne({name: AGENT_TOOL_TASK_NAME});
      expect(tool.status).toBe("aborted");
      const freed = await harness.conversation(conversation.id);
      expect(freed.document.status).toBe("idle");
      expect(freed.document.activeTurnTaskId).toBeUndefined();
      // An aborted tool writes no result.
      expect((await messagesOf(conversation.id)).map(({role}) => role)).toEqual([
        "user",
        "assistant",
      ]);
    });

    it("validates submit input and conversation lookups", async () => {
      const primary = scriptedModel("primary-model", []);
      const agent = agentWith({tools: []});
      const stranger = agentWith({name: "test.stranger"});
      const harness = await openHarness({
        models: {"primary-model": primary.model},
        registry: [agent],
      });
      const conversation = await harness.createConversation({agent});

      await expect(conversation.submit({content: " ", requestId: "r1"})).rejects.toThrow(
        harnessErrorMatching("invalidRequest", "submit requires non-empty content")
      );
      await expect(conversation.submit({content: "Hi", requestId: ""})).rejects.toThrow(
        harnessErrorMatching("invalidRequest", "submit requires a requestId")
      );
      await expect(harness.createConversation({agent: stranger})).rejects.toThrow(
        harnessErrorMatching(
          "notRegistered",
          'Agent "test.stranger" is not in this harness registry'
        )
      );
      await expect(harness.conversation(new mongoose.Types.ObjectId())).rejects.toMatchObject({
        status: 404,
      });
      expect(await conversation.messages()).toEqual([]);
    });
  });

  describe("Harness.open", () => {
    it("requires a models resolver when the registry lists agents", async () => {
      await expect(Harness.open({registry: [agentWith()]})).rejects.toThrow(
        harnessErrorMatching(
          "configInvalid",
          "Harness.open: the registry lists agents; pass `models` to resolve them"
        )
      );
    });

    it("rejects an agent name listed twice", async () => {
      await expect(
        Harness.open({
          models: () => {
            throw new Error("unused");
          },
          registry: [agentWith(), agentWith()],
        })
      ).rejects.toThrow(
        harnessErrorMatching(
          "configInvalid",
          'Harness registry lists agent "test.clinician" more than once'
        )
      );
    });

    it("hands the execution env to task phases as rt.env", async () => {
      const env: ExecutionEnv = {
        exec: async () => ({exitCode: 0, stderr: "", stdout: "ok"}),
        read: async (path) => `contents of ${path}`,
        write: async () => {},
      };
      const reader = defineTask<unknown, unknown, string>({
        initial: () => ({phase: "read"}),
        name: "test.envReader",
        phases: {
          read: {
            run: async (_task, rt) => {
              const text = (await rt.env?.read("notes.txt")) ?? "no env";
              await rt.commit({terminal: {result: text, status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness({env, models: {}, registry: [reader]});
      const task = await harness.createTask(reader, {});
      const done = await harness.waitForTask(task._id, {timeout: {seconds: 10}});
      expect(done.outcome?.result).toBe("contents of notes.txt");
    });
  });
});
