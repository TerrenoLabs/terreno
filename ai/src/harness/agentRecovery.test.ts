import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {z} from "@terreno/api";
import type {LanguageModel} from "ai";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import type {HarnessAgentDefinition, HarnessReplayPolicy} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {AGENT_TOOL_TASK_NAME, defineAgent, defineTool, Harness, InProcessRunner} from "./harness";
import {registerHarnessConversation} from "./models/harnessConversation";
import {registerHarnessMessage} from "./models/harnessMessage";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";

const LEASE_MS = 300;
const HEARTBEAT_MS = 50;

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
const ConversationModel = registerHarnessConversation();
const MessageModel = registerHarnessMessage();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

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

type Reply = {
  hang?: Gate;
  started?: Gate;
  text?: string;
  toolCall?: {id: string; name: string};
};

/** LanguageModelV2 mock answering each request with the next reply; `hang` blocks it first. */
const scriptedModel = (replies: Reply[]) => ({
  doGenerate: mock(async () => {
    const reply = replies.shift();
    if (!reply) {
      throw new Error("script exhausted");
    }
    reply.started?.release();
    if (reply.hang) {
      await reply.hang.promise;
    }
    return {
      content: reply.toolCall
        ? [
            {
              input: "{}",
              toolCallId: reply.toolCall.id,
              toolName: reply.toolCall.name,
              type: "tool-call" as const,
            },
          ]
        : [{text: reply.text ?? "", type: "text" as const}],
      finishReason: reply.toolCall ? ("tool-calls" as const) : ("stop" as const),
      usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2},
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
});

interface ProcessHandle {
  die: () => void;
  harness: Harness;
}

const liveHandles: ProcessHandle[] = [];
const hungGates: Gate[] = [];

/** One simulated process sharing the test database; `die` freezes every lease renewal. */
const openProcess = async ({
  agent,
  beforeCommitEnd,
  model,
  ownerId,
}: {
  agent: HarnessAgentDefinition;
  beforeCommitEnd?: (context: {die: () => void; phase: string}) => void;
  model: ReturnType<typeof scriptedModel>;
  ownerId: string;
}): Promise<ProcessHandle> => {
  let isDead = false;
  const die = (): void => {
    isDead = true;
  };
  const harness = await Harness.open({
    // A dead process must not consume the shared script: its model calls fail at once.
    models: () =>
      ({
        ...model,
        doGenerate: async (options: unknown) => {
          if (isDead) {
            throw new Error(`${ownerId} is dead`);
          }
          return (model.doGenerate as (options: unknown) => ReturnType<typeof model.doGenerate>)(
            options
          );
        },
      }) as unknown as LanguageModel,
    registry: [agent],
    runner: new InProcessRunner({
      heartbeatInterval: {milliseconds: HEARTBEAT_MS},
      leaseDuration: {milliseconds: LEASE_MS},
      ownerId,
      pollInterval: {milliseconds: 20},
    }),
    testHooks: {
      beforeCommitEnd: beforeCommitEnd ? ({phase}) => beforeCommitEnd({die, phase}) : undefined,
      isHeartbeatSuspended: () => isDead,
    },
  });
  const handle = {die, harness};
  liveHandles.push(handle);
  await harness.start();
  return handle;
};

/** A `chart` tool whose first execution hangs until the test lets it go. */
const hangingTool = (replay: HarnessReplayPolicy) => {
  const hung = gate();
  hungGates.push(hung);
  const started = gate();
  let runs = 0;
  const tool = defineTool({
    description: "Write a note to the chart",
    execute: async () => {
      runs += 1;
      if (runs === 1) {
        started.release();
        await hung.promise;
        return "written by the dead process";
      }
      return `written on run ${runs}`;
    },
    name: "chart",
    parameters: z.object({}),
    replay,
  });
  return {hung, runs: () => runs, started, tool};
};

const toolMessages = async (conversationId: string) => {
  const rows = await MessageModel.find({conversationId, role: "tool"}).sort({seq: 1});
  return rows.map(({parts, status}) => ({
    output: (parts[0] as {output?: unknown} | undefined)?.output,
    status,
  }));
};

describe("Agent turns across a crash", () => {
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

  it("reports an interrupted replay-never tool as 'interrupted, not retried' and carries on (AC3)", async () => {
    const chart = hangingTool("never");
    const model = scriptedModel([
      {toolCall: {id: "c1", name: "chart"}},
      {text: "Please verify the chart."},
    ]);
    const agent = defineAgent({
      instructions: "Write notes.",
      model: {modelId: "mock-model", provider: "mock"},
      name: "test.writer",
      tools: [chart.tool],
    });
    const first = await openProcess({agent, model, ownerId: "process-1"});
    const conversation = await first.harness.createConversation({agent});
    const turn = await conversation.submit({content: "Write it", requestId: "r1"});
    await chart.started.promise;
    first.die();

    const second = await openProcess({agent, model, ownerId: "process-2"});
    const done = await second.harness.waitForTask(turn._id, {timeout: {seconds: 10}});

    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toMatchObject({text: "Please verify the chart."});
    expect(chart.runs()).toBe(1);
    const tool = await TaskModel.findExactlyOne({name: AGENT_TOOL_TASK_NAME});
    expect(tool.status).toBe("failed");
    expect(tool.outcome?.error).toBe(
      "Interrupted, not retried: lease of process-1 expired mid-phase (replay: never)"
    );
    expect(await toolMessages(conversation.id)).toEqual([
      {
        output: "Interrupted, not retried: lease of process-1 expired mid-phase (replay: never)",
        status: "error",
      },
    ]);
    const toolSpan = await SpanModel.findExactlyOne({kind: "TOOL", traceId: done.traceId});
    expect(toolSpan.status).toBe("error");
    expect(toolSpan.endedAt).toBeDefined();
    expect(model.doGenerate).toHaveBeenCalledTimes(2);
    const secondPrompt = (
      model.doGenerate.mock.calls[1] as unknown as [{prompt: Array<{content: unknown}>}]
    )[0].prompt;
    expect(secondPrompt.at(-1)).toMatchObject({
      content: [
        {
          output: {
            type: "error-text",
            value: "Interrupted, not retried: lease of process-1 expired mid-phase (replay: never)",
          },
        },
      ],
      role: "tool",
    });

    // The dead process's tool finishes late; its result is fenced out.
    chart.hung.release();
    await first.harness.stop();
    expect((await TaskModel.findExactlyOne({name: AGENT_TOOL_TASK_NAME})).status).toBe("failed");
    expect(await toolMessages(conversation.id)).toHaveLength(1);
  }, 20_000);

  it("re-runs an interrupted replay-safe tool on the new process (AC3)", async () => {
    const chart = hangingTool("safe");
    const model = scriptedModel([{toolCall: {id: "c1", name: "chart"}}, {text: "Done."}]);
    const agent = defineAgent({
      instructions: "Write notes.",
      model: {modelId: "mock-model", provider: "mock"},
      name: "test.writer",
      tools: [chart.tool],
    });
    const first = await openProcess({agent, model, ownerId: "process-1"});
    const conversation = await first.harness.createConversation({agent});
    const turn = await conversation.submit({content: "Write it", requestId: "r1"});
    await chart.started.promise;
    first.die();

    const second = await openProcess({agent, model, ownerId: "process-2"});
    const done = await second.harness.waitForTask(turn._id, {timeout: {seconds: 10}});

    expect(done.status).toBe("completed");
    expect(chart.runs()).toBe(2);
    expect(await toolMessages(conversation.id)).toEqual([
      {output: "written on run 2", status: "ok"},
    ]);
    const tool = await TaskModel.findExactlyOne({name: AGENT_TOOL_TASK_NAME});
    expect(tool.status).toBe("completed");
  }, 20_000);

  it("re-runs an interrupted tools phase without re-running its tools", async () => {
    let toolsCommits = 0;
    let runs = 0;
    const chart = defineTool({
      description: "Write a note to the chart",
      execute: async () => {
        runs += 1;
        return "written";
      },
      name: "chart",
      parameters: z.object({}),
    });
    const model = scriptedModel([{toolCall: {id: "c1", name: "chart"}}, {text: "Done."}]);
    const agent = defineAgent({
      instructions: "Write notes.",
      model: {modelId: "mock-model", provider: "mock"},
      name: "test.writer",
      tools: [chart],
    });
    const first = await openProcess({
      agent,
      // The second `tools` commit stores the results: crash right there.
      beforeCommitEnd: ({die, phase}) => {
        if (phase !== "tools") {
          return;
        }
        toolsCommits += 1;
        if (toolsCommits === 2) {
          die();
          throw new Error("process died mid-commit");
        }
      },
      model,
      ownerId: "process-1",
    });
    const conversation = await first.harness.createConversation({agent});
    const turn = await conversation.submit({content: "Write it", requestId: "r1"});
    for (let i = 0; i < 300 && toolsCommits < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(toolsCommits).toBe(2);

    const second = await openProcess({agent, model, ownerId: "process-2"});
    const done = await second.harness.waitForTask(turn._id, {timeout: {seconds: 10}});
    expect(done.status).toBe("completed");
    expect(runs).toBe(1);
    expect(await TaskModel.countDocuments({name: AGENT_TOOL_TASK_NAME})).toBe(1);
    expect(await toolMessages(conversation.id)).toEqual([{output: "written", status: "ok"}]);
    const seqs = (await MessageModel.find({conversationId: conversation.id}).sort({seq: 1})).map(
      ({seq}) => seq
    );
    expect(seqs).toEqual([1, 2, 3, 4]);
  }, 20_000);

  it("re-requests an interrupted model call and keeps exactly one answer", async () => {
    const hung = gate();
    hungGates.push(hung);
    const started = gate();
    const model = scriptedModel([
      {hang: hung, started, text: "from the dead process"},
      {text: "Fresh answer."},
    ]);
    const agent = defineAgent({
      instructions: "Answer.",
      model: {modelId: "mock-model", provider: "mock"},
      name: "test.answerer",
    });
    const first = await openProcess({agent, model, ownerId: "process-1"});
    const conversation = await first.harness.createConversation({agent});
    const turn = await conversation.submit({content: "Question", requestId: "r1"});
    await started.promise;
    first.die();

    const second = await openProcess({agent, model, ownerId: "process-2"});
    const done = await second.harness.waitForTask(turn._id, {timeout: {seconds: 10}});
    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toMatchObject({text: "Fresh answer."});
    expect(model.doGenerate).toHaveBeenCalledTimes(2);

    // The dead process's late answer is fenced out.
    hung.release();
    await first.harness.stop();
    const messages = await MessageModel.find({conversationId: conversation.id}).sort({seq: 1});
    expect(messages.map(({parts, seq}) => ({parts, seq}))).toEqual([
      {parts: [{text: "Question", type: "text"}], seq: 1},
      {parts: [{text: "Fresh answer.", type: "text"}], seq: 2},
    ]);
    expect((await ConversationModel.findExactlyOne({_id: conversation.id})).seq).toBe(2);
    expect(await SpanModel.countDocuments({kind: "LLM", traceId: done.traceId})).toBe(1);
    const interruption = await SpanModel.findExactlyOne({
      name: "request",
      status: "error",
      traceId: done.traceId,
    });
    expect(interruption.error).toContain("re-running (replay: safe)");
  }, 20_000);
});
