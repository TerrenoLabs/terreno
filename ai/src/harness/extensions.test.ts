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
import type {LanguageModel} from "ai";
import {DateTime, Duration} from "luxon";
import type mongoose from "mongoose";
import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import {generateToStream} from "../tests/generateStream";
import {harnessErrorMatching} from "../tests/harnessErrors";
import type {
  AnyHarnessToolDefinition,
  HarnessAgentDefinition,
  HarnessTaskDocument,
} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import type {HarnessModels} from "./commit";
import {errorMessage} from "./errors";
import {
  AGENT_TOOL_TASK_NAME,
  AGENT_TURN_TASK_NAME,
  defineAgent,
  defineExtension,
  defineTask,
  defineTool,
  Harness,
  HarnessCommitConflictError,
  type HarnessModelRef,
  type HarnessRegistryEntry,
  hook,
  InProcessRunner,
  section,
  wrapTool,
} from "./harness";
import {createMemo} from "./memo";
import {registerHarnessConversation} from "./models/harnessConversation";
import {registerHarnessMemo} from "./models/harnessMemo";
import {registerHarnessMessage} from "./models/harnessMessage";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";

interface ScriptedToolCall {
  id: string;
  input: Record<string, unknown>;
  name: string;
}

interface ScriptStep {
  text?: string;
  toolCalls?: ScriptedToolCall[];
}

interface GenerateCall {
  prompt: Array<{content: unknown; role: string}>;
  tools?: Array<{name: string}>;
}

/** A LanguageModelV2 mock that answers each request with the next scripted step. */
const scriptedModel = (steps: ScriptStep[]) => {
  const calls: GenerateCall[] = [];
  const model = {
    doGenerate: mock(async (options: GenerateCall) => {
      calls.push(JSON.parse(JSON.stringify(options)));
      const step = steps.shift();
      if (!step) {
        throw new Error("script exhausted");
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
        usage: {inputTokens: 10, outputTokens: 2, totalTokens: 12},
        warnings: [],
      };
    }),
    doStream: mock(async (options: GenerateCall) =>
      generateToStream(await model.doGenerate(options))
    ),
    modelId: "mock-model",
    provider: "mock",
    specificationVersion: "v2" as const,
    supportedUrls: {},
  };
  return {calls, model};
};

/** Plain JSON copy; matchers must never walk mongoose documents (they recurse forever). */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const MODEL: HarnessModelRef = {modelId: "mock-model", provider: "mock"};

// Whole turns on a real replica set; the first test also pays for index creation.
setDefaultTimeout(20_000);

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
const ConversationModel = registerHarnessConversation();
const MessageModel = registerHarnessMessage();
const MemoModel = registerHarnessMemo();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

const openHarnesses: Harness[] = [];

const openHarness = async ({
  model,
  registry,
}: {
  model?: ReturnType<typeof scriptedModel>["model"];
  registry: ReadonlyArray<HarnessRegistryEntry>;
}): Promise<Harness> => {
  const harness = await Harness.open({
    models: () => model as unknown as LanguageModel,
    registry,
    runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
    testHooks: {random: () => 0},
  });
  openHarnesses.push(harness);
  await harness.start();
  return harness;
};

const lookupTool = defineTool({
  description: "Look up a patient's chart by id",
  execute: async ({patientId}: {patientId: string}) => ({chart: `chart-${patientId}`}),
  name: "lookup",
  parameters: z.object({patientId: z.string()}),
});

const agentWith = (
  overrides: Partial<Parameters<typeof defineAgent>[0]> = {}
): HarnessAgentDefinition =>
  defineAgent({
    instructions: "Answer the clinician.",
    model: MODEL,
    modelRetry: {backoffMs: 1, maxBackoffMs: 2},
    name: "test.clinician",
    tools: [lookupTool],
    ...overrides,
  });

/** Run one turn of `agent` (with `extensions` registered) and return everything it wrote. */
const runTurn = async ({
  agent,
  extensions,
  steps,
}: {
  agent: HarnessAgentDefinition;
  extensions: ReadonlyArray<HarnessRegistryEntry>;
  steps: ScriptStep[];
}) => {
  const scripted = scriptedModel(steps);
  const harness = await openHarness({model: scripted.model, registry: [agent, ...extensions]});
  const conversation = await harness.createConversation({agent});
  const turn = await conversation.submit({content: "Check patient p7", requestId: "r1"});
  const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});
  const messages = await MessageModel.find({conversationId: conversation.id}).sort({seq: 1});
  return {calls: scripted.calls, conversation, done, harness, messages};
};

const toolResultOf = (
  messages: ReadonlyArray<{parts: unknown[]; role: string; status?: string}>
): {output: unknown; status?: string} => {
  const tool = messages.find(({role}) => role === "tool");
  return {
    output: (tool?.parts[0] as {output?: unknown} | undefined)?.output,
    status: tool?.status,
  };
};

/** The tool result the model was sent on its second request. */
const toolResultSeen = (calls: GenerateCall[]): unknown =>
  calls[1]?.prompt.find(({role}) => role === "tool")?.content;

const lookupCall: ScriptStep = {
  toolCalls: [{id: "call-1", input: {patientId: "p7"}, name: "lookup"}],
};

const llmSpans = (task: HarnessTaskDocument) =>
  SpanModel.find({kind: "LLM", traceId: task.traceId}).sort({_id: 1});

describe("Extensions, hooks, wraps, and memos", () => {
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
      OwnerModel.deleteMany({}),
      ConversationModel.deleteMany({}),
      MessageModel.deleteMany({}),
      MemoModel.deleteMany({}),
      SpanModel.deleteMany({}),
      TraceModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
  });

  describe("definitions", () => {
    it("validates extensions, sections, hooks, and wraps", () => {
      expect(() => defineExtension({name: " "})).toThrow(
        harnessErrorMatching("definitionInvalid", "defineExtension: name is required")
      );
      expect(() => section("", () => "x")).toThrow(
        harnessErrorMatching("definitionInvalid", "section: name is required")
      );
      expect(() => section("s", "x" as never)).toThrow(
        harnessErrorMatching("definitionInvalid", "section(s): build must be a function")
      );
      expect(() => hook("onEverything" as never, () => undefined)).toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          'hook: kind must be one of afterTool, beforeModelRequest, beforeTool, not "onEverything"'
        )
      );
      expect(() => hook("beforeTool", 3 as never)).toThrow(
        harnessErrorMatching("definitionInvalid", "hook(beforeTool): handler must be a function")
      );
      expect(() => wrapTool("", (tool) => tool)).toThrow(
        harnessErrorMatching("definitionInvalid", "wrapTool: a tool or tool name is required")
      );
      expect(() => wrapTool("lookup", null as never)).toThrow(
        harnessErrorMatching("definitionInvalid", "wrapTool(lookup): wrap must be a function")
      );
      expect(wrapTool(lookupTool, (tool) => tool).toolName).toBe("lookup");
      expect(() =>
        defineExtension({name: "x", sections: [section("a", () => ""), section("a", () => "")]})
      ).toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          'defineExtension(x): section "a" is listed more than once'
        )
      );
      expect(() => defineExtension({name: "x", sections: [{} as never]})).toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          "defineExtension(x): every section must come from section()"
        )
      );
      expect(() => defineExtension({name: "x", tools: [lookupTool, lookupTool]})).toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          'defineExtension(x): tool "lookup" is listed more than once'
        )
      );
      expect(() => defineExtension({name: "x", tools: [{} as never]})).toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          "defineExtension(x): every tool must come from defineTool"
        )
      );
      expect(() => defineExtension({hooks: [{} as never], name: "x"})).toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          "defineExtension(x): every hook must come from hook()"
        )
      );
      expect(() => defineExtension({name: "x", wraps: [{} as never]})).toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          "defineExtension(x): every wrap must come from wrapTool()"
        )
      );
      const extension = defineExtension({name: "clinic"});
      expect(Object.isFrozen(extension)).toBe(true);
      expect(agentWith({extensions: [extension, "audit"]}).extensions).toEqual(["clinic", "audit"]);
      expect(() => agentWith({extensions: ["clinic", extension]})).toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          "defineAgent(test.clinician): an extension is listed more than once"
        )
      );
      expect(() => agentWith({extensions: [{} as never]})).toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          "defineAgent(test.clinician): every extension must be a defineExtension result or its name"
        )
      );
    });

    it("rejects duplicate extension names and agents that use unregistered extensions", async () => {
      const clinic = defineExtension({name: "clinic"});
      await expect(
        Harness.open({registry: [clinic, defineExtension({name: "clinic"})]})
      ).rejects.toThrow(
        harnessErrorMatching(
          "configInvalid",
          'Harness registry lists extension "clinic" more than once'
        )
      );
      await expect(
        Harness.open({
          models: () => ({}) as LanguageModel,
          registry: [agentWith({extensions: ["clinic"]})],
        })
      ).rejects.toThrow(
        harnessErrorMatching(
          "configInvalid",
          'Agent "test.clinician" uses extension "clinic", which is not in this harness registry'
        )
      );
    });
  });

  describe("beforeTool", () => {
    it("blocks a call: the tool never runs and the model gets the reason as an error result (AC6)", async () => {
      const execute = mock(async () => ({chart: "should not run"}));
      const guarded = defineTool({...lookupTool, execute});
      const policy = defineExtension({
        hooks: [
          hook("beforeTool", (call) =>
            call.toolName === "lookup" ? {block: "Chart lookups need sign-off"} : undefined
          ),
        ],
        name: "policy",
      });
      const {calls, done, messages} = await runTurn({
        agent: agentWith({extensions: [policy], tools: [guarded]}),
        extensions: [policy],
        steps: [lookupCall, {text: "I cannot look that up."}],
      });

      expect(done.status).toBe("completed");
      expect(execute).not.toHaveBeenCalled();
      expect(toolResultOf(messages)).toEqual({
        output: "Chart lookups need sign-off",
        status: "error",
      });
      expect(toolResultSeen(calls)).toEqual([
        {
          output: {type: "error-text", value: "Chart lookups need sign-off"},
          toolCallId: "call-1",
          toolName: "lookup",
          type: "tool-result",
        },
      ]);
      const toolTask = await TaskModel.findExactlyOne({name: AGENT_TOOL_TASK_NAME});
      expect(plain(toolTask.outcome)).toEqual({
        error: "Chart lookups need sign-off",
        status: "failed",
      });
    });

    it("rewrites arguments in extension order, and re-validates them", async () => {
      const seen: unknown[] = [];
      const recorder = defineTool({
        ...lookupTool,
        execute: async (args: {patientId: string}) => {
          seen.push(args);
          return {chart: `chart-${args.patientId}`};
        },
      });
      const first = defineExtension({
        hooks: [
          hook("beforeTool", (call) => ({
            args: {patientId: `${(call.args as {patientId: string}).patientId}-a`},
          })),
        ],
        name: "first",
      });
      const second = defineExtension({
        hooks: [
          hook("beforeTool", () => undefined),
          hook("beforeTool", (call) => ({
            args: {patientId: `${(call.args as {patientId: string}).patientId}-b`},
          })),
        ],
        name: "second",
      });
      const {messages} = await runTurn({
        agent: agentWith({extensions: [first, second], tools: [recorder]}),
        extensions: [first, second],
        steps: [lookupCall, {text: "done"}],
      });
      expect(seen).toEqual([{patientId: "p7-a-b"}]);
      expect(toolResultOf(messages)).toEqual({output: {chart: "chart-p7-a-b"}, status: "ok"});
    });

    it("reports rewritten arguments that fail the tool's schema as an error result", async () => {
      const breaker = defineExtension({
        hooks: [hook("beforeTool", () => ({args: {patientId: 7}}))],
        name: "breaker",
      });
      const {messages} = await runTurn({
        agent: agentWith({extensions: [breaker]}),
        extensions: [breaker],
        steps: [lookupCall, {text: "done"}],
      });
      const result = toolResultOf(messages);
      expect(result.status).toBe("error");
      expect(String(result.output)).toStartWith(
        'Invalid arguments for tool "lookup" after beforeTool hooks:'
      );
    });

    it("turns a throwing tool hook into an error result naming the extension", async () => {
      const broken = defineExtension({
        hooks: [
          hook("beforeTool", () => {
            throw new Error("policy store down");
          }),
        ],
        name: "broken",
      });
      const {done, messages} = await runTurn({
        agent: agentWith({extensions: [broken]}),
        extensions: [broken],
        steps: [lookupCall, {text: "done"}],
      });
      expect(done.status).toBe("completed");
      expect(toolResultOf(messages)).toEqual({
        output: 'Extension "broken" beforeTool hook failed: policy store down',
        status: "error",
      });
    });

    it("rejects a hook that returns something other than undefined, {block}, or {args}", async () => {
      const odd = defineExtension({
        hooks: [hook("beforeTool", () => ({allow: true}) as never)],
        name: "odd",
      });
      const {messages} = await runTurn({
        agent: agentWith({extensions: [odd]}),
        extensions: [odd],
        steps: [lookupCall, {text: "done"}],
      });
      expect(toolResultOf(messages)).toEqual({
        output:
          'Tool "lookup" failed: Extension "odd" beforeTool hook must return undefined, {block}, or {args}',
        status: "error",
      });
    });
  });

  describe("afterTool", () => {
    it("rewrites the result the model sees, in extension order", async () => {
      const redact = defineExtension({
        hooks: [
          hook("afterTool", (call, result) => ({
            ...(result as Record<string, unknown>),
            redactedBy: call.toolName,
          })),
          hook("afterTool", () => undefined),
        ],
        name: "redact",
      });
      const stamp = defineExtension({
        hooks: [
          hook("afterTool", (_call, result) => ({
            ...(result as Record<string, unknown>),
            stamped: true,
          })),
        ],
        name: "stamp",
      });
      const {calls, messages} = await runTurn({
        agent: agentWith({extensions: [redact, stamp]}),
        extensions: [redact, stamp],
        steps: [lookupCall, {text: "done"}],
      });
      const rewritten = {chart: "chart-p7", redactedBy: "lookup", stamped: true};
      expect(toolResultOf(messages)).toEqual({output: rewritten, status: "ok"});
      expect(toolResultSeen(calls)).toEqual([
        {
          output: {type: "json", value: rewritten},
          toolCallId: "call-1",
          toolName: "lookup",
          type: "tool-result",
        },
      ]);
    });

    it("does not run when the tool throws, and a throwing afterTool fails the call", async () => {
      const afterTool = mock(() => undefined);
      const failing = defineTool({
        ...lookupTool,
        execute: async () => {
          throw new Error("EHR timeout");
        },
      });
      const watcher = defineExtension({hooks: [hook("afterTool", afterTool)], name: "watcher"});
      const first = await runTurn({
        agent: agentWith({extensions: [watcher], tools: [failing]}),
        extensions: [watcher],
        steps: [lookupCall, {text: "done"}],
      });
      expect(afterTool).not.toHaveBeenCalled();
      expect(toolResultOf(first.messages)).toEqual({
        output: 'Tool "lookup" failed: EHR timeout',
        status: "error",
      });
    });

    it("reports a throwing afterTool hook as the call's error", async () => {
      const broken = defineExtension({
        hooks: [
          hook("afterTool", () => {
            throw new Error("redactor crashed");
          }),
        ],
        name: "broken",
      });
      const {messages} = await runTurn({
        agent: agentWith({extensions: [broken]}),
        extensions: [broken],
        steps: [lookupCall, {text: "done"}],
      });
      expect(toolResultOf(messages)).toEqual({
        output: 'Extension "broken" afterTool hook failed: redactor crashed',
        status: "error",
      });
    });
  });

  describe("beforeModelRequest and sections", () => {
    it("sends the rewritten request and records which extensions rewrote it", async () => {
      const seenSystems: string[] = [];
      const seenApis: Array<{taskId: string; turnTaskId: string}> = [];
      const rewrite = defineExtension({
        hooks: [
          hook("beforeModelRequest", (request, api) => {
            seenSystems.push(request.system);
            seenApis.push({taskId: api.taskId, turnTaskId: api.turnTaskId});
            return {
              messages: [...request.messages, {content: "Be terse.", role: "user"}],
              system: `${request.system}\n\nRespond in English.`,
            };
          }),
        ],
        name: "rewrite",
      });
      const passive = defineExtension({
        hooks: [hook("beforeModelRequest", () => undefined)],
        name: "passive",
      });
      const {calls, done, messages} = await runTurn({
        agent: agentWith({extensions: [rewrite, passive], tools: []}),
        extensions: [rewrite, passive],
        steps: [{text: "ok"}],
      });
      expect(done.status).toBe("completed");
      expect(seenSystems).toEqual(["Answer the clinician."]);
      expect(seenApis).toEqual([{taskId: String(done._id), turnTaskId: String(done._id)}]);
      expect(calls[0]?.prompt).toEqual([
        {content: "Answer the clinician.\n\nRespond in English.", role: "system"},
        {content: [{text: "Check patient p7", type: "text"}], role: "user"},
        {content: [{text: "Be terse.", type: "text"}], role: "user"},
      ]);
      const [llm] = await llmSpans(done);
      expect(plain(llm?.input)).toMatchObject({rewrittenBy: ["rewrite"]});
      // Rewritten messages are named by hash, since the transcript slice is no longer what was sent.
      expect((plain(llm?.input) as {messages: {hash?: string}}).messages.hash).toMatch(
        /^[0-9a-f]{64}$/
      );
      // The rewritten system prompt differs from the instructions, so it is in the transcript.
      const prompt = messages.find(({role}) => role === "system");
      expect(plain(prompt?.parts)).toMatchObject([
        {sections: [], text: "Answer the clinician.\n\nRespond in English.", type: "system-prompt"},
      ]);
    });

    it("fails the turn when beforeModelRequest throws or returns a malformed request", async () => {
      const broken = defineExtension({
        hooks: [
          hook("beforeModelRequest", () => {
            throw new Error("quota service down");
          }),
        ],
        name: "broken",
      });
      const first = await runTurn({
        agent: agentWith({extensions: [broken]}),
        extensions: [broken],
        steps: [{text: "never sent"}],
      });
      expect(first.done.status).toBe("failed");
      expect(first.done.outcome?.error).toBe(
        'Extension "broken" beforeModelRequest hook failed: quota service down'
      );
      expect(first.calls).toHaveLength(0);
      const reloaded = await first.harness.conversation(first.conversation.id);
      expect(reloaded.document.status).toBe("idle");

      await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
      const malformed = defineExtension({
        hooks: [hook("beforeModelRequest", () => ({system: "only"}) as never)],
        name: "malformed",
      });
      const second = await runTurn({
        agent: agentWith({extensions: [malformed], name: "test.other"}),
        extensions: [malformed],
        steps: [{text: "never sent"}],
      });
      expect(second.done.outcome?.error).toBe(
        'Extension "malformed" beforeModelRequest hook must return {system, messages} or undefined'
      );
    });

    it("rebuilds sections before every request and records each changed prompt (AC6)", async () => {
      let build = 0;
      const inputs: Array<{agentName: string; messageCount: number; step: number}> = [];
      const clinic = defineExtension({
        name: "clinic",
        sections: [
          section("vitals", (input) => {
            build += 1;
            inputs.push({
              agentName: input.agentName,
              messageCount: input.messages.length,
              step: input.step,
            });
            return build === 1 ? "Vitals: pending" : "Vitals: BP 120/80";
          }),
          section("empty", () => undefined),
        ],
      });
      const policy = defineExtension({
        name: "policy",
        sections: [section("rules", async () => "Never prescribe.")],
      });
      const {calls, done, messages} = await runTurn({
        agent: agentWith({extensions: [clinic, policy]}),
        extensions: [clinic, policy],
        steps: [lookupCall, lookupCall, {text: "BP is fine."}],
      });
      expect(done.status).toBe("completed");
      expect(inputs).toEqual([
        {agentName: "test.clinician", messageCount: 1, step: 1},
        {agentName: "test.clinician", messageCount: 3, step: 2},
        {agentName: "test.clinician", messageCount: 5, step: 3},
      ]);
      const systems = calls.map((call) => call.prompt[0]);
      expect(systems).toEqual([
        {content: "Answer the clinician.\n\nVitals: pending\n\nNever prescribe.", role: "system"},
        {content: "Answer the clinician.\n\nVitals: BP 120/80\n\nNever prescribe.", role: "system"},
        {content: "Answer the clinician.\n\nVitals: BP 120/80\n\nNever prescribe.", role: "system"},
      ]);
      // Recorded prompts are never replayed to the model as messages.
      for (const call of calls) {
        expect(call.prompt.filter(({role}) => role === "system")).toHaveLength(1);
      }

      // Two distinct prompts: two records, each just before the answer it produced.
      expect(messages.map(({role}) => role)).toEqual([
        "user",
        "system",
        "assistant",
        "tool",
        "system",
        "assistant",
        "tool",
        "assistant",
      ]);
      const records = messages
        .filter(({role}) => role === "system")
        .map(({parts, seq}) => ({part: plain(parts[0]) as Record<string, unknown>, seq}));
      expect(records.map(({part}) => part.text)).toEqual([
        "Answer the clinician.\n\nVitals: pending\n\nNever prescribe.",
        "Answer the clinician.\n\nVitals: BP 120/80\n\nNever prescribe.",
      ]);
      expect(records[0]?.part.sections).toEqual([
        {extension: "clinic", name: "vitals"},
        {extension: "policy", name: "rules"},
      ]);

      // Each LLM span names the prompt it sent by hash and transcript seq.
      const spans = (await llmSpans(done)).map(
        (span) => (span.input as {system: {hash: string; messageSeq?: number}}).system
      );
      expect(spans.map(({messageSeq}) => messageSeq)).toEqual([
        records[0]?.seq,
        records[1]?.seq,
        records[1]?.seq,
      ]);
      expect(spans[0]?.hash).toBe(records[0]?.part.hash as string);
      expect(spans[1]?.hash).toBe(records[1]?.part.hash as string);
      expect(spans[2]?.hash).toBe(spans[1]?.hash as string);
    });

    it("records nothing when the prompt is just the agent's instructions", async () => {
      const silent = defineExtension({name: "silent", sections: [section("none", () => "  ")]});
      const {done, messages} = await runTurn({
        agent: agentWith({extensions: [silent], tools: []}),
        extensions: [silent],
        steps: [{text: "ok"}],
      });
      expect(messages.map(({role}) => role)).toEqual(["user", "assistant"]);
      const [llm] = await llmSpans(done);
      const input = plain(llm?.input) as {system: {messageSeq?: number; sections: unknown[]}};
      expect(input.system.sections).toEqual([]);
      expect(input.system.messageSeq).toBeUndefined();
    });

    it("fails the turn when a section throws", async () => {
      const broken = defineExtension({
        name: "broken",
        sections: [
          section("vitals", () => {
            throw new Error("monitor offline");
          }),
        ],
      });
      const {calls, done} = await runTurn({
        agent: agentWith({extensions: [broken]}),
        extensions: [broken],
        steps: [{text: "never sent"}],
      });
      expect(done.outcome?.error).toBe(
        'Extension "broken" section "vitals" failed: monitor offline'
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe("tools and wraps", () => {
    it("lets a later extension override a tool and wraps whichever tool wins (AC6)", async () => {
      const ran: string[] = [];
      const fromAgent = defineTool({
        ...lookupTool,
        execute: async () => {
          ran.push("agent");
          return "agent";
        },
      });
      const fromClinic = defineTool({
        ...lookupTool,
        execute: async () => {
          ran.push("clinic");
          return "clinic";
        },
      });
      const fromOverride = defineTool({
        ...lookupTool,
        execute: async () => {
          ran.push("override");
          return "override";
        },
      });
      const extra = defineTool({
        description: "Page the on-call nurse",
        execute: async () => "paged",
        name: "page",
        parameters: z.object({}),
      });
      const clinic = defineExtension({name: "clinic", tools: [fromClinic, extra]});
      const audited = (tag: string) => (tool: AnyHarnessToolDefinition) =>
        defineTool({
          ...tool,
          execute: async (args, api) => {
            ran.push(`${tag}:before`);
            return {[tag]: await tool.execute(args, api)};
          },
        });
      // The wrapping extension comes before the overriding one, yet wraps its tool.
      const audit = defineExtension({
        name: "audit",
        wraps: [wrapTool("lookup", audited("audit")), wrapTool("missing", audited("never"))],
      });
      const override = defineExtension({
        name: "override",
        tools: [fromOverride],
        wraps: [wrapTool(lookupTool, audited("outer"))],
      });
      const {calls, conversation, messages} = await runTurn({
        agent: agentWith({extensions: [clinic, audit, override], tools: [fromAgent]}),
        extensions: [clinic, audit, override],
        steps: [
          {
            toolCalls: [
              {id: "call-1", input: {patientId: "p7"}, name: "lookup"},
              {id: "call-2", input: {}, name: "page"},
            ],
          },
          {text: "done"},
        ],
      });
      expect(plain(conversation.document.agent.tools)).toEqual(["lookup", "page"]);
      expect(plain(conversation.document.agent.extensions)).toEqual([
        "clinic",
        "audit",
        "override",
      ]);
      expect(calls[0]?.tools?.map(({name}) => name)).toEqual(["lookup", "page"]);
      // The first extension's wrap is innermost.
      expect(ran).toEqual(["outer:before", "audit:before", "override"]);
      expect(toolResultOf(messages)).toEqual({
        output: {outer: {audit: "override"}},
        status: "ok",
      });
      // A tool only an extension provides is callable too.
      expect(toolResultOf(messages.filter(({role}) => role === "tool").slice(1))).toEqual({
        output: "paged",
        status: "ok",
      });
    });

    it("refuses a conversation whose wrap does not return a tool of the same name", async () => {
      const bad = defineExtension({
        name: "bad",
        wraps: [wrapTool("lookup", (tool) => ({...tool, name: "renamed"}))],
      });
      const throwing = defineExtension({
        name: "throwing",
        wraps: [
          wrapTool("lookup", () => {
            throw new Error("no audit sink");
          }),
        ],
      });
      const agent = agentWith({extensions: [bad]});
      const harness = await openHarness({
        model: scriptedModel([]).model,
        registry: [agent, bad, throwing],
      });
      // Snapshotting the conversation resolves its tools, so a bad wrap fails there.
      await expect(harness.createConversation({agent})).rejects.toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          'Extension "bad" wrap of tool "lookup" must return a defineTool tool named "lookup"'
        )
      );
      await expect(harness.createConversation({agent, extensions: ["throwing"]})).rejects.toThrow(
        'Extension "throwing" wrap of tool "lookup" failed: no audit sink'
      );
    });

    it("reports a wrap that fails while the tool call resolves its tool as the call's error", async () => {
      let resolutions = 0;
      const flaky = defineExtension({
        name: "flaky",
        wraps: [
          wrapTool("lookup", (tool) => {
            resolutions += 1;
            // Resolutions: snapshot, request, tool fan-out, the tool call, next request. Fail the
            // fan-out and the call so the call itself reports the wrap's error.
            if (resolutions === 3 || resolutions === 4) {
              throw new Error("audit sink blipped");
            }
            return tool;
          }),
        ],
      });
      const {done, messages} = await runTurn({
        agent: agentWith({extensions: [flaky]}),
        extensions: [flaky],
        steps: [lookupCall, {text: "done"}],
      });
      expect(done.status).toBe("completed");
      expect(toolResultOf(messages)).toEqual({
        output: 'Extension "flaky" wrap of tool "lookup" failed: audit sink blipped',
        status: "error",
      });
    });

    it("fails a turn whose conversation names an extension this process does not register", async () => {
      const clinic = defineExtension({name: "clinic"});
      const agent = agentWith({tools: []});
      const before = await openHarness({model: scriptedModel([]).model, registry: [agent, clinic]});
      const conversation = await before.createConversation({agent, extensions: ["clinic"]});
      await before.stop();
      openHarnesses.splice(0);

      const scripted = scriptedModel([{text: "never sent"}]);
      const after = await openHarness({model: scripted.model, registry: [agent]});
      const turn = await (await after.conversation(conversation.id)).submit({
        content: "hi",
        requestId: "r1",
      });
      const done = await after.waitForTask(turn._id, {timeout: {seconds: 10}});
      expect(done.outcome?.error).toBe('Extension "clinic" is not in this harness registry');
      expect(scripted.calls).toHaveLength(0);
    });

    it("uses a conversation's own extension list and refuses unregistered names", async () => {
      const clinic = defineExtension({name: "clinic", sections: [section("s", () => "Clinic.")]});
      const scripted = scriptedModel([{text: "ok"}]);
      const agent = agentWith({tools: []});
      const harness = await openHarness({model: scripted.model, registry: [agent, clinic]});
      await expect(harness.createConversation({agent, extensions: ["ghost"]})).rejects.toThrow(
        harnessErrorMatching("notRegistered", 'Extension "ghost" is not in this harness registry')
      );
      await expect(harness.createConversation({agent, extensions: [3 as never]})).rejects.toThrow(
        harnessErrorMatching(
          "definitionInvalid",
          "createConversation: every extension must be a defineExtension result or its name"
        )
      );
      await expect(
        harness.createConversation({agent, extensions: [clinic, "clinic"]})
      ).rejects.toThrow(
        harnessErrorMatching(
          "invalidRequest",
          "createConversation: an extension is listed more than once"
        )
      );
      const conversation = await harness.createConversation({agent, extensions: [clinic]});
      expect(plain(conversation.document.agent.extensions)).toEqual(["clinic"]);
      const turn = await conversation.submit({content: "hi", requestId: "r1"});
      await harness.waitForTask(turn._id, {timeout: {seconds: 10}});
      expect(scripted.calls[0]?.prompt[0]).toEqual({
        content: "Answer the clinician.\n\nClinic.",
        role: "system",
      });
    });
  });

  describe("memos", () => {
    it("scopes tool-hook memos to the turn task so a decision is made once per call", async () => {
      const decide = mock(() => "approved");
      const seenApis: Array<{taskId: string; turnTaskId: string}> = [];
      const gatekeeper = defineExtension({
        hooks: [
          hook("beforeTool", async (call, api) => {
            seenApis.push({taskId: api.taskId, turnTaskId: api.turnTaskId});
            const key = `decision:${call.toolCallId}`;
            const existing = await api.memo<string>(key);
            const decision = existing ?? (await api.memo(key, decide()));
            return decision === "approved" ? undefined : {block: "denied"};
          }),
        ],
        name: "gatekeeper",
      });
      const {done, messages} = await runTurn({
        agent: agentWith({extensions: [gatekeeper]}),
        extensions: [gatekeeper],
        steps: [lookupCall, {text: "done"}],
      });
      expect(toolResultOf(messages).status).toBe("ok");
      expect(decide).toHaveBeenCalledTimes(1);
      const rows = await MemoModel.find({});
      expect(rows.map(({key, taskId, value}) => ({key, taskId: String(taskId), value}))).toEqual([
        {key: "decision:call-1", taskId: String(done._id), value: "approved"},
      ]);
      expect(done.name).toBe(AGENT_TURN_TASK_NAME);
      const toolTask = await TaskModel.findExactlyOne({name: AGENT_TOOL_TASK_NAME});
      expect(seenApis).toEqual([{taskId: String(toolTask._id), turnTaskId: String(done._id)}]);
    });

    it("keeps the first write under concurrent writers, and reads it back", async () => {
      const results: unknown[] = [];
      const task = defineTask<Record<string, never>, unknown, unknown>({
        initial: () => ({phase: "decide"}),
        name: "test.memoRace",
        phases: {
          decide: {
            run: async (_task, rt) => {
              expect(await rt.memo("choice")).toBeUndefined();
              const writes = await Promise.all(
                ["a", "b", "c", "d", "e"].map((value) => rt.memo("choice", {value}))
              );
              results.push(...writes);
              results.push(await rt.memo("choice"));
              expect(await rt.memo("nothing", null)).toBeNull();
              await rt.commit({terminal: {result: writes[0], status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness({registry: [task]});
      const created = await harness.createTask(task, {});
      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("completed");
      expect(new Set(results.map((value) => JSON.stringify(value))).size).toBe(1);
      expect(await MemoModel.countDocuments({key: "choice", taskId: created._id})).toBe(1);
      const row = await MemoModel.findExactlyOne({key: "choice", taskId: created._id});
      expect(plain(row.value)).toEqual(plain(done.outcome?.result));
    });

    it("rejects blank keys, non-JSON values, and writes after the phase committed", async () => {
      const errors: string[] = [];
      const lateRead: unknown[] = [];
      const capture = async (work: () => Promise<unknown>): Promise<void> => {
        try {
          await work();
        } catch (error: unknown) {
          errors.push(errorMessage(error));
        }
      };
      const task = defineTask<Record<string, never>, unknown, unknown>({
        initial: () => ({phase: "decide"}),
        name: "test.memoMisuse",
        phases: {
          decide: {
            run: async (_task, rt) => {
              await capture(() => rt.memo(" "));
              await capture(() => rt.memo("big", 10n));
              await capture(() => rt.memo("fn", () => 1));
              await rt.commit({terminal: {status: "completed"}});
              await capture(() => rt.memo("late", 1));
              lateRead.push(await rt.memo("late"));
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness({registry: [task]});
      const created = await harness.createTask(task, {});
      await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(errors).toEqual([
        "memo requires a non-empty key",
        'memo "big": value is not JSON-serializable (JSON.stringify cannot serialize BigInt.)',
        'memo "fn": value is not JSON-serializable',
        'test.memoMisuse@1: rt.memo called after the phase "decide" committed or started waiting',
      ]);
      expect(lateRead).toEqual([undefined]);
    });

    describe("fenced writers", () => {
      /** Start `count` tasks whose phase hangs, and return their running rows. */
      const hangTasks = async (count: number) => {
        let release: () => void = () => {};
        const hung = new Promise<void>((resolve) => {
          release = resolve;
        });
        const task = defineTask<{n: number}, unknown, unknown>({
          initial: () => ({phase: "hold"}),
          name: "test.memoHold",
          phases: {
            hold: {
              run: async (_task, rt) => {
                await hung;
                await rt.commit({terminal: {status: "completed"}});
              },
            },
          },
          version: 1,
        });
        const harness = await openHarness({registry: [task]});
        const ids = [];
        for (let n = 0; n < count; n++) {
          ids.push((await harness.createTask(task, {n}))._id);
        }
        // The in-process runner runs one task at a time: wait for the first to hold its
        // lease, then give the others a running lease of their own, as another runner would.
        for (let i = 0; i < 300; i++) {
          if ((await TaskModel.countDocuments({_id: ids[0], status: "running"})) > 0) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        for (const [n, id] of ids.slice(1).entries()) {
          await TaskModel.updateOne(
            {_id: id, status: "pending"},
            {
              $set: {
                lease: {
                  acquiredAt: new Date(),
                  expiresAt: DateTime.now().plus({minutes: 5}).toJSDate(),
                  owner: "other-runner",
                  token: `other-${n}`,
                },
                status: "running",
              },
            }
          );
        }
        const rows = await TaskModel.find({_id: {$in: ids}, status: "running"}).sort({created: 1});
        expect(rows).toHaveLength(count);
        return {release, rows};
      };

      const memoFor = (
        row: HarnessTaskDocument,
        scopeTaskId: mongoose.Types.ObjectId,
        token = row.lease?.token
      ) =>
        createMemo({
          assertWritable: () => {},
          fence: {phase: row.phase, taskId: row._id, token},
          lease: {
            duration: Duration.fromObject({seconds: 30}),
            heartbeat: Duration.fromObject({seconds: 1}),
            owner: "test",
          },
          models: {memo: MemoModel, task: TaskModel} as unknown as HarnessModels,
          scopeTaskId,
        });

      it("lets exactly one of two independent runs win a key (first write wins)", async () => {
        const {release, rows} = await hangTasks(2);
        try {
          const [first, second] = rows as [HarnessTaskDocument, HarnessTaskDocument];
          // Two runs fencing different task rows race on one shared key, so neither queues
          // behind the other's lease write and the unique index decides.
          const scope = first._id;
          const results = await Promise.all([
            memoFor(first, scope)("route", {by: "first"}),
            memoFor(second, scope)("route", {by: "second"}),
          ]);
          expect(plain(results[0])).toEqual(plain(results[1]));
          expect(await MemoModel.countDocuments({key: "route", taskId: scope})).toBe(1);
          expect(plain(await memoFor(second, scope)("route", {by: "later"}))).toEqual(
            plain(results[0])
          );
          expect(plain(await memoFor(first, scope)("empty", {}))).toEqual({});
        } finally {
          release();
        }
      });

      it("refuses a write from a run whose lease token is stale", async () => {
        const {release, rows} = await hangTasks(1);
        try {
          const [row] = rows as [HarnessTaskDocument];
          const stale = memoFor(row, row._id, "stale-token")("choice", "a");
          await expect(stale).rejects.toBeInstanceOf(HarnessCommitConflictError);
          await expect(stale).rejects.toThrow(
            harnessErrorMatching("commitConflict", `Harness commit for task ${row._id}`)
          );
          expect(await MemoModel.countDocuments({})).toBe(0);
          expect(await memoFor(row, row._id)("choice", "b")).toBe("b");
        } finally {
          release();
        }
      });
    });
  });

  describe("memos across a crash", () => {
    it("returns the first process's decision to the process that resumes the phase (AC6)", async () => {
      let release: () => void = () => {};
      const hung = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started: () => void = () => {};
      const isStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const decisions: unknown[] = [];
      let runs = 0;
      const task = defineTask<Record<string, never>, unknown, unknown>({
        initial: () => ({phase: "decide"}),
        name: "test.memoCrash",
        phases: {
          decide: {
            replay: "safe",
            run: async (_task, rt) => {
              runs += 1;
              const decision = await rt.memo("route", {choice: `run-${runs}`});
              decisions.push(decision);
              if (runs === 1) {
                started();
                await hung;
              }
              await rt.commit({terminal: {result: decision, status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const processes: Array<{die: () => void; harness: Harness}> = [];
      const openProcess = async (ownerId: string) => {
        let isDead = false;
        const harness = await Harness.open({
          registry: [task],
          runner: new InProcessRunner({
            heartbeatInterval: {milliseconds: 50},
            leaseDuration: {milliseconds: 300},
            ownerId,
            pollInterval: {milliseconds: 20},
          }),
          testHooks: {isHeartbeatSuspended: () => isDead},
        });
        const handle = {
          die: () => {
            isDead = true;
          },
          harness,
        };
        processes.push(handle);
        await harness.start();
        return handle;
      };
      try {
        const first = await openProcess("process-a");
        const created = await first.harness.createTask(task, {});
        await isStarted;
        first.die();
        const second = await openProcess("process-b");
        const done = await second.harness.waitForTask(created._id, {timeout: {seconds: 15}});
        expect(done.status).toBe("completed");
        expect(plain(done.outcome?.result)).toEqual({choice: "run-1"});
        expect(plain(decisions)).toEqual([{choice: "run-1"}, {choice: "run-1"}]);
        expect(await MemoModel.countDocuments({taskId: created._id})).toBe(1);
      } finally {
        release();
        await Promise.all(processes.map(({harness}) => harness.stop()));
      }
    });
  });
});
