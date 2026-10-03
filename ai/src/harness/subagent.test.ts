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

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import type {HarnessAgentDefinition, HarnessTestHooks} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {
  AGENT_TURN_TASK_NAME,
  defineAgent,
  defineTask,
  defineTool,
  Harness,
  type HarnessModelRef,
  HarnessSubagentError,
  InProcessRunner,
} from "./harness";
import {registerHarnessConversation} from "./models/harnessConversation";
import {registerHarnessMessage} from "./models/harnessMessage";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";

// Each test runs whole parent + subagent turns on a real replica set. A timed-out test
// makes Bun kill mongod, so leave room for a loaded machine.
setDefaultTimeout(20_000);

/** Short leases only where a test kills a process; elsewhere a loaded machine must not expire one. */
const CRASH_LEASE_MS = 300;
const LEASE_MS = 5000;
const HEARTBEAT_MS = 50;

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

const gate = (): Gate => {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {promise, release};
};

interface ScriptStep {
  finishReason?: "length" | "stop";
  /** Blocks the request until released, or until the request is aborted. */
  hang?: Gate;
  started?: Gate;
  text?: string;
  toolCall?: {id: string; input: Record<string, unknown>; name: string};
}

interface GenerateCall {
  abortSignal?: AbortSignal;
  prompt: Array<{content: unknown; role: string}>;
  responseFormat?: {schema?: unknown; type: string};
}

/** A LanguageModelV2 mock answering each request with the next scripted step. */
const scriptedModel = (steps: ScriptStep[]) => {
  const calls: GenerateCall[] = [];
  const model = {
    doGenerate: mock(async (options: GenerateCall) => {
      calls.push(options);
      const step = steps.shift();
      if (!step) {
        throw new Error("script exhausted");
      }
      step.started?.release();
      if (step.hang) {
        const hang = step.hang;
        await new Promise<void>((resolve, reject) => {
          hang.promise.then(resolve);
          options.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return {
        content: step.toolCall
          ? [
              {
                input: JSON.stringify(step.toolCall.input),
                toolCallId: step.toolCall.id,
                toolName: step.toolCall.name,
                type: "tool-call" as const,
              },
            ]
          : [{text: step.text ?? "", type: "text" as const}],
        finishReason: step.toolCall ? ("tool-calls" as const) : (step.finishReason ?? "stop"),
        usage: {inputTokens: 10, outputTokens: 5, totalTokens: 15},
        warnings: [],
      };
    }),
    doStream: mock(async () => {
      throw new Error("streaming is not used by the turn");
    }),
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

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
const ConversationModel = registerHarnessConversation();
const MessageModel = registerHarnessMessage();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

interface ProcessHandle {
  die: () => void;
  harness: Harness;
}

const liveHandles: ProcessHandle[] = [];
const hungGates: Gate[] = [];

/**
 * One simulated process sharing the test database. `die` freezes every lease renewal and
 * makes this process's model requests hang, as if the process had stopped.
 */
const openProcess = async ({
  beforeCommitEnd,
  leaseMs = LEASE_MS,
  model,
  ownerId = "process-1",
  registry,
}: {
  beforeCommitEnd?: (context: {die: () => void; phase: string; taskId: string}) => void;
  leaseMs?: number;
  model: ReturnType<typeof scriptedModel>["model"];
  ownerId?: string;
  registry: Parameters<typeof Harness.open>[0]["registry"];
}): Promise<ProcessHandle> => {
  let isDead = false;
  const frozen = gate();
  hungGates.push(frozen);
  const die = (): void => {
    isDead = true;
  };
  const hooks: HarnessTestHooks = {
    beforeCommitEnd: beforeCommitEnd
      ? ({phase, taskId}) => beforeCommitEnd({die, phase, taskId})
      : undefined,
    isHeartbeatSuspended: () => isDead,
    random: () => 0,
  };
  const harness = await Harness.open({
    models: () =>
      ({
        ...model,
        doGenerate: async (options: GenerateCall) => {
          if (isDead) {
            await frozen.promise;
            throw new Error(`${ownerId} is dead`);
          }
          return model.doGenerate(options);
        },
      }) as unknown as LanguageModel,
    registry,
    runner: new InProcessRunner({
      heartbeatInterval: {milliseconds: HEARTBEAT_MS},
      leaseDuration: {milliseconds: leaseMs},
      ownerId,
      pollInterval: {milliseconds: 20},
    }),
    testHooks: hooks,
  });
  const handle = {die, harness};
  liveHandles.push(handle);
  await harness.start();
  return handle;
};

const summarizerWith = (
  overrides: Partial<Parameters<typeof defineAgent>[0]> = {}
): HarnessAgentDefinition =>
  defineAgent({
    instructions: "Summarize the chart.",
    model: MODEL,
    modelRetry: {backoffMs: 1, maxAttempts: 1, maxBackoffMs: 2},
    name: "test.summarizer",
    ...overrides,
  });

const SummarySchema = z.object({risk: z.number(), summary: z.string()});

/** A one-phase task that runs `agent` once per input and completes with the results. */
const parentTask = ({
  agent,
  inputs = [{chart: "stable vitals"}],
  instructions,
  name = "test.parent",
  output,
}: {
  agent: HarnessAgentDefinition;
  inputs?: unknown[];
  instructions?: string;
  name?: string;
  output?: z.ZodType;
}) =>
  defineTask<Record<string, never>, Record<string, never>, {results: unknown[]}>({
    initial: () => ({phase: "summarize"}),
    name,
    phases: {
      summarize: {
        replay: "safe",
        run: async (_task, rt) => {
          const results: unknown[] = [];
          for (const input of inputs) {
            results.push(await rt.runAgent(agent, {input, instructions, output}));
          }
          await rt.commit({terminal: {result: {results}, status: "completed"}});
        },
      },
    },
    retry: {maxAttempts: 1},
    version: 1,
  });

describe("rt.runAgent (subagents)", () => {
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
      SpanModel.deleteMany({}),
      TraceModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    for (const hung of hungGates.splice(0)) {
      hung.release();
    }
    await Promise.all(liveHandles.splice(0).map(({harness}) => harness.stop()));
  });

  it("returns the final text from a task-owned conversation run as a child turn", async () => {
    const agent = summarizerWith();
    const parent = parentTask({agent, instructions: "Be brief."});
    const {calls, model} = scriptedModel([{text: "Vitals are stable."}]);
    const {harness} = await openProcess({model, registry: [agent, parent]});

    const created = await harness.createTask(parent, {});
    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});

    expect(done.status).toBe("completed");
    expect(plain(done.outcome?.result)).toEqual({results: ["Vitals are stable."]});
    const conversation = await ConversationModel.findExactlyOne({});
    expect(plain(conversation.ownership)).toEqual({id: String(created._id), kind: "task"});
    expect(conversation.status).toBe("idle");
    expect(conversation.agent.instructions).toBe("Be brief.");
    expect(conversation.ownerKey).toBe("0:0:agent:0");
    const turn = await TaskModel.findExactlyOne({name: AGENT_TURN_TASK_NAME});
    expect(plain(turn.ownership)).toEqual({id: String(created._id), kind: "task"});
    expect(turn.status).toBe("completed");
    const messages = await MessageModel.find({conversationId: conversation._id}).sort({seq: 1});
    expect(plain(messages.map(({parts, role}) => ({parts, role})))).toEqual([
      {parts: [{text: '{"chart":"stable vitals"}', type: "text"}], role: "user"},
      {parts: [{text: "Vitals are stable.", type: "text"}], role: "assistant"},
    ]);
    expect(calls).toHaveLength(1);
    expect(plain(calls[0]?.prompt[0])).toEqual({content: "Be brief.", role: "system"});
    // A plain-text subagent asks for text, not JSON.
    expect(calls[0]?.responseFormat?.type ?? "text").toBe("text");

    // Only rt.runAgent runs turns on a task-owned conversation.
    const handle = await harness.conversation(conversation._id);
    await expect(handle.submit({content: "Follow up", requestId: "r1"})).rejects.toThrow(
      `belongs to task ${created._id}; only rt.runAgent runs its turns`
    );
  });

  it("nests the subagent's AGENT span under the caller and its LLM and TOOL spans under it", async () => {
    const lookup = defineTool({
      description: "Look up a chart",
      execute: async ({patientId}: {patientId: string}) => ({chart: `chart-${patientId}`}),
      name: "lookup",
      parameters: z.object({patientId: z.string()}),
    });
    const agent = summarizerWith({tools: [lookup]});
    const parent = parentTask({agent});
    const {model} = scriptedModel([
      {toolCall: {id: "c1", input: {patientId: "p1"}, name: "lookup"}},
      {text: "Summary of chart-p1."},
    ]);
    const {harness} = await openProcess({model, registry: [agent, parent]});

    const created = await harness.createTask(parent, {});
    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.status).toBe("completed");

    const spans = await SpanModel.find({traceId: done.traceId});
    const byId = new Map(spans.map((span) => [String(span._id), span]));
    const parentOf = (span: (typeof spans)[number]) =>
      span.parentSpanId ? byId.get(String(span.parentSpanId)) : undefined;
    const agentSpan = spans.find(({kind}) => kind === "AGENT");
    expect(agentSpan?.name).toBe("test.summarizer");
    expect(String(agentSpan?.parentSpanId)).toBe(String(done.rootSpanId));
    expect(agentSpan?.status).toBe("ok");
    expect(agentSpan?.endedAt).toBeDefined();
    expect(plain(agentSpan?.input)).toMatchObject({messageSeq: 1});
    const llmSpans = spans.filter(({kind}) => kind === "LLM");
    expect(llmSpans).toHaveLength(2);
    for (const llm of llmSpans) {
      expect(String(llm.parentSpanId)).toBe(String(agentSpan?._id));
    }
    const toolSpan = spans.find(({kind}) => kind === "TOOL");
    expect(toolSpan?.name).toBe("lookup");
    expect(String(toolSpan?.parentSpanId)).toBe(String(agentSpan?._id));
    expect(parentOf(agentSpan as (typeof spans)[number])?.kind).toBe("CHAIN");
    // The subagent shares the caller's trace.
    expect(await TraceModel.countDocuments({})).toBe(1);
  });

  it("returns structured output requested through the AI SDK and validated with the schema", async () => {
    const agent = summarizerWith();
    const parent = parentTask({agent, output: SummarySchema});
    const {calls, model} = scriptedModel([
      {text: '```json\n{"summary": "stable", "risk": 2}\n```'},
    ]);
    const {harness} = await openProcess({model, registry: [agent, parent]});

    const done = await harness.waitForTask((await harness.createTask(parent, {}))._id, {
      timeout: {seconds: 10},
    });

    expect(done.status).toBe("completed");
    expect(plain(done.outcome?.result)).toEqual({results: [{risk: 2, summary: "stable"}]});
    expect(calls[0]?.responseFormat).toMatchObject({
      schema: {properties: {risk: {type: "number"}, summary: {type: "string"}}, type: "object"},
      type: "json",
    });
    const turn = await TaskModel.findExactlyOne({name: AGENT_TURN_TASK_NAME});
    expect(plain(turn.outcome?.result)).toMatchObject({output: {risk: 2, summary: "stable"}});
    // Without an override the agent's own instructions are used.
    const conversation = await ConversationModel.findExactlyOne({});
    expect(conversation.agent.instructions).toBe("Summarize the chart.");
    expect(plain(calls[0]?.prompt[0])).toEqual({content: "Summarize the chart.", role: "system"});
  });

  it("uses the agent's own output schema when the call passes none", async () => {
    const agent = summarizerWith({output: SummarySchema});
    const parent = parentTask({agent});
    const {calls, model} = scriptedModel([{text: '{"summary": "ok", "risk": 1}'}]);
    const {harness} = await openProcess({model, registry: [agent, parent]});

    const done = await harness.waitForTask((await harness.createTask(parent, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(plain(done.outcome?.result)).toEqual({results: [{risk: 1, summary: "ok"}]});
    expect(calls[0]?.responseFormat?.type).toBe("json");
  });

  it("reports a cut-off answer as missing structured output, not a model failure", async () => {
    const agent = summarizerWith();
    const parent = parentTask({agent, output: SummarySchema});
    const {calls, model} = scriptedModel([{finishReason: "length", text: ""}]);
    const {harness} = await openProcess({model, registry: [agent, parent]});

    const done = await harness.waitForTask((await harness.createTask(parent, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(done.status).toBe("failed");
    expect(done.outcome?.error).toBe(
      'Subagent "test.summarizer" answered without structured output'
    );
    expect(calls).toHaveLength(1);
    const turn = await TaskModel.findExactlyOne({name: AGENT_TURN_TASK_NAME});
    expect(turn.status).toBe("completed");
  });

  it("lets the caller catch HarnessSubagentError for a turn cut off by maxSteps", async () => {
    const lookup = defineTool({
      description: "Look up a chart",
      execute: async () => ({chart: "chart"}),
      name: "lookup",
      parameters: z.object({}),
    });
    const agent = summarizerWith({maxSteps: 1, tools: [lookup]});
    const parent = defineTask<Record<string, never>, Record<string, never>, unknown>({
      initial: () => ({phase: "summarize"}),
      name: "test.catching",
      phases: {
        summarize: {
          replay: "safe",
          run: async (_task, rt) => {
            try {
              await rt.runAgent(agent, {input: "chart"});
              await rt.commit({terminal: {result: {caught: false}, status: "completed"}});
            } catch (error: unknown) {
              if (!(error instanceof HarnessSubagentError)) {
                throw error;
              }
              await rt.commit({
                terminal: {
                  result: {
                    agentName: error.agentName,
                    conversationId: error.conversationId,
                    message: error.message,
                    status: error.status,
                    turnTaskId: error.turnTaskId,
                  },
                  status: "completed",
                },
              });
            }
          },
        },
      },
      version: 1,
    });
    const {model} = scriptedModel([{toolCall: {id: "c1", input: {}, name: "lookup"}}]);
    const {harness} = await openProcess({model, registry: [agent, parent]});

    const done = await harness.waitForTask((await harness.createTask(parent, {}))._id, {
      timeout: {seconds: 10},
    });
    const turn = await TaskModel.findExactlyOne({name: AGENT_TURN_TASK_NAME});
    const conversation = await ConversationModel.findExactlyOne({});
    expect(plain(done.outcome?.result)).toEqual({
      agentName: "test.summarizer",
      conversationId: String(conversation._id),
      message: 'Subagent "test.summarizer" finished (max-steps) without a final answer',
      status: "completed",
      turnTaskId: String(turn._id),
    });
  });

  it("fails the caller at once for blank input", async () => {
    const agent = summarizerWith();
    const parent = parentTask({agent, inputs: ["   "]});
    const {model} = scriptedModel([]);
    const {harness} = await openProcess({model, registry: [agent, parent]});

    const done = await harness.waitForTask((await harness.createTask(parent, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(done.status).toBe("failed");
    expect(done.outcome?.error).toBe("test.parent@1: rt.runAgent requires non-empty input");
    expect(await ConversationModel.countDocuments({})).toBe(0);
  });

  it("fails the caller with a clear error when the output does not match the schema", async () => {
    const agent = summarizerWith();
    const notJson = parentTask({agent, name: "test.notJson", output: SummarySchema});
    const wrongType = parentTask({agent, name: "test.wrongType", output: SummarySchema});
    const {model} = scriptedModel([
      {text: "The patient is stable."},
      {text: '{"summary": "stable", "risk": "high"}'},
    ]);
    const {harness} = await openProcess({model, registry: [agent, notJson, wrongType]});

    // Not JSON: the AI SDK's structured-output parse fails the subagent's turn.
    const first = await harness.waitForTask((await harness.createTask(notJson, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(first.status).toBe("failed");
    expect(first.outcome?.error).toStartWith(
      'Subagent "test.summarizer" failed: Agent "test.summarizer" output does not match its schema (No object generated: could not parse the response.)'
    );
    // The invalid answer is still in the subagent's transcript.
    const firstConversation = await ConversationModel.findExactlyOne({
      "ownership.id": first._id,
    });
    expect(firstConversation.status).toBe("idle");
    const answer = await MessageModel.findExactlyOne({
      conversationId: firstConversation._id,
      role: "assistant",
    });
    expect(plain(answer.parts)).toEqual([{text: "The patient is stable.", type: "text"}]);

    // JSON of the wrong shape: the caller's zod schema rejects it.
    const second = await harness.waitForTask((await harness.createTask(wrongType, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(second.status).toBe("failed");
    expect(second.outcome?.error).toStartWith(
      'Subagent "test.summarizer" output does not match its schema: '
    );
    expect(second.outcome?.error).toContain("expected number, received string");
  });

  it("gives two runAgent calls in one phase distinct child conversations", async () => {
    const agent = summarizerWith();
    const parent = parentTask({agent, inputs: ["first chart", "second chart"]});
    const {calls, model} = scriptedModel([{text: "Summary A"}, {text: "Summary B"}]);
    const {harness} = await openProcess({model, registry: [agent, parent]});

    const done = await harness.waitForTask((await harness.createTask(parent, {}))._id, {
      timeout: {seconds: 10},
    });

    expect(plain(done.outcome?.result)).toEqual({results: ["Summary A", "Summary B"]});
    const conversations = await ConversationModel.find({"ownership.id": done._id}).sort({
      ownerKey: 1,
    });
    expect(conversations.map(({ownerKey}) => ownerKey)).toEqual(["0:0:agent:0", "0:0:agent:1"]);
    expect(await TaskModel.countDocuments({name: AGENT_TURN_TASK_NAME})).toBe(2);
    // The first child is found again, not re-run, when the phase resumes for the second.
    expect(calls).toHaveLength(2);
    const firstMessages = async (conversationId: unknown) =>
      (await MessageModel.find({conversationId}).sort({seq: 1})).map(
        ({parts}) => (parts[0] as {text: string}).text
      );
    expect(await firstMessages(conversations[0]?._id)).toEqual(["first chart", "Summary A"]);
    expect(await firstMessages(conversations[1]?._id)).toEqual(["second chart", "Summary B"]);
    // Each subagent sees only its own transcript.
    expect(JSON.stringify(calls[1]?.prompt)).not.toContain("first chart");
  });

  it("fails the caller at once for an agent missing from the registry", async () => {
    const registered = summarizerWith();
    // Same name as the registered agent, but not the registered definition.
    const stranger = summarizerWith({instructions: "Something else."});
    const parent = parentTask({agent: stranger});
    const {model} = scriptedModel([]);
    const {harness} = await openProcess({model, registry: [registered, parent]});

    const done = await harness.waitForTask((await harness.createTask(parent, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(done.status).toBe("failed");
    expect(done.outcome?.error).toBe(
      'test.parent@1: rt.runAgent agent "test.summarizer" is not in this harness registry'
    );
    expect(await ConversationModel.countDocuments({})).toBe(0);
  });

  it("aborting the caller aborts the subagent's turn and frees its conversation", async () => {
    const started = gate();
    const hang = gate();
    hungGates.push(hang);
    const agent = summarizerWith();
    const parent = parentTask({agent});
    const {calls, model} = scriptedModel([{hang, started}]);
    const {harness} = await openProcess({model, registry: [agent, parent]});

    const created = await harness.createTask(parent, {});
    await started.promise;
    const aborted = await harness.abort(created._id, {reason: "Patient left"});

    expect(aborted.status).toBe("aborted");
    const turn = await TaskModel.findExactlyOne({name: AGENT_TURN_TASK_NAME});
    expect(turn.status).toBe("aborted");
    expect(turn.outcome?.error).toBe("Aborted: Patient left");
    const conversation = await ConversationModel.findExactlyOne({});
    expect(conversation.status).toBe("idle");
    expect(conversation.activeTurnTaskId).toBeUndefined();
    // The in-flight model request was cancelled and recorded no answer.
    expect(calls[0]?.abortSignal?.aborted).toBe(true);
    expect(await MessageModel.countDocuments({role: "assistant"})).toBe(0);
    const agentSpan = await SpanModel.findExactlyOne({kind: "AGENT"});
    expect(agentSpan.endedAt).toBeDefined();
    expect(agentSpan.status).toBe("error");
  });

  describe("across a crash", () => {
    it("resumes the same child when the caller dies between creating it and waiting", async () => {
      const agent = summarizerWith();
      const parent = parentTask({agent});
      let parentId = "";
      let hasCrashed = false;
      // Process 1 may claim the turn before it dies; that request then hangs forever.
      const deadHang = gate();
      hungGates.push(deadHang);
      const deadModel = scriptedModel([{hang: deadHang}]);
      const first = await openProcess({
        // The caller's `waiting` commit follows the child's creation: crash right there.
        beforeCommitEnd: ({die, phase, taskId}) => {
          if (phase === "summarize" && taskId === parentId) {
            hasCrashed = true;
            die();
            throw new Error("process died mid-commit");
          }
        },
        leaseMs: CRASH_LEASE_MS,
        model: deadModel.model,
        registry: [agent, parent],
      });
      const created = await first.harness.createTask(parent, {});
      parentId = String(created._id);
      for (let i = 0; i < 1000 && !hasCrashed; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(hasCrashed).toBe(true);
      expect(await TaskModel.countDocuments({name: AGENT_TURN_TASK_NAME})).toBe(1);
      // The waiting commit rolled back: the caller is still running at its checkpoint.
      expect((await TaskModel.findExactlyOne({_id: created._id})).status).toBe("running");

      const live = scriptedModel([{text: "Summary after the crash."}]);
      const second = await openProcess({
        leaseMs: CRASH_LEASE_MS,
        model: live.model,
        ownerId: "process-2",
        registry: [agent, parent],
      });
      const done = await second.harness.waitForTask(created._id, {timeout: {seconds: 15}});

      expect(done.status).toBe("completed");
      expect(plain(done.outcome?.result)).toEqual({results: ["Summary after the crash."]});
      expect(await ConversationModel.countDocuments({})).toBe(1);
      expect(await TaskModel.countDocuments({name: AGENT_TURN_TASK_NAME})).toBe(1);
      expect(await MessageModel.countDocuments({role: "user"})).toBe(1);
      expect(live.calls).toHaveLength(1);
      expect(deadModel.calls.length).toBeLessThanOrEqual(1);
      expect(await MessageModel.countDocuments({role: "assistant"})).toBe(1);
    }, 30_000);

    it("resumes a child turn mid-flight without repeating its completed model step", async () => {
      const toolStarted = gate();
      const toolHang = gate();
      hungGates.push(toolHang);
      let toolRuns = 0;
      const lookup = defineTool({
        description: "Look up a chart",
        execute: async () => {
          toolRuns += 1;
          if (toolRuns === 1) {
            toolStarted.release();
            await toolHang.promise;
          }
          return {chart: `run ${toolRuns}`};
        },
        name: "lookup",
        parameters: z.object({}),
        replay: "safe",
      });
      const agent = summarizerWith({tools: [lookup]});
      const parent = parentTask({agent});
      const firstModel = scriptedModel([{toolCall: {id: "c1", input: {}, name: "lookup"}}]);
      const first = await openProcess({
        leaseMs: CRASH_LEASE_MS,
        model: firstModel.model,
        registry: [agent, parent],
      });
      const created = await first.harness.createTask(parent, {});
      await toolStarted.promise;
      first.die();

      const secondModel = scriptedModel([{text: "Done after the crash."}]);
      const second = await openProcess({
        leaseMs: CRASH_LEASE_MS,
        model: secondModel.model,
        ownerId: "process-2",
        registry: [agent, parent],
      });
      const done = await second.harness.waitForTask(created._id, {timeout: {seconds: 15}});

      expect(done.status).toBe("completed");
      expect(plain(done.outcome?.result)).toEqual({results: ["Done after the crash."]});
      expect(firstModel.calls).toHaveLength(1);
      expect(secondModel.calls).toHaveLength(1);
      expect(await ConversationModel.countDocuments({})).toBe(1);
      expect(await TaskModel.countDocuments({name: AGENT_TURN_TASK_NAME})).toBe(1);
      const conversation = await ConversationModel.findExactlyOne({});
      const roles = (
        await MessageModel.find({conversationId: conversation._id}).sort({seq: 1})
      ).map(({role}) => role);
      expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
    }, 30_000);
  });
});
