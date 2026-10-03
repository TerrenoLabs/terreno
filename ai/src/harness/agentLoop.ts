import {
  tool as aiTool,
  generateText,
  type JSONValue,
  type ModelMessage,
  type TextPart,
  type ToolCallPart,
  type ToolContent,
  type ToolResultPart,
  type ToolSet,
} from "ai";
import {DateTime} from "luxon";
import type mongoose from "mongoose";
import type {ModelPrice} from "../observability/types";
import {normalizeLlmJsonTextForStructuredOutput} from "../service/parseAiJson";
import type {
  HarnessAgentDefinition,
  HarnessChildOutcome,
  HarnessConversationDocument,
  HarnessMessageDocument,
  HarnessMessagePart,
  HarnessModelResolver,
  HarnessReplayPolicy,
  HarnessTaskDefinition,
  HarnessTaskRuntime,
  HarnessTaskView,
  HarnessToolCallPart,
  HarnessToolResultPart,
  HarnessTurnResult,
} from "../types/harness";
import {HARNESS_MESSAGE_ROLES} from "../types/harness";
import type {HarnessCommitWrites, HarnessModels} from "./commit";
import {defineTask} from "./defineTask";
import {internalRuntime} from "./internalRuntime";
import {callModelWithFallback, HarnessModelCallError} from "./modelCall";

/** Name of the built-in task that runs one agent turn on a conversation. */
export const AGENT_TURN_TASK_NAME = "terreno.agent.turn";
/** Name of the built-in task that runs one tool call of a turn. */
export const AGENT_TOOL_TASK_NAME = "terreno.agent.tool";

/** Everything the built-in agent tasks need from their harness. */
export interface AgentLoopContext {
  agents: Map<string, HarnessAgentDefinition>;
  models: HarnessModels;
  /** Read at call time so an `ObservabilityApp` registered later still prices calls. */
  priceMap: () => Record<string, ModelPrice> | undefined;
  random?: () => number;
  resolveModel?: HarnessModelResolver;
}

export interface AgentTurnInput {
  conversationId: string;
}

interface PendingToolCall {
  input: unknown;
  toolCallId: string;
  toolName: string;
}

interface AgentTurnState {
  /** Model requests made so far in this turn. */
  step: number;
  /** Text of the latest assistant message. */
  text: string;
  /** Tool calls of the latest assistant message, awaiting results. */
  toolCalls?: PendingToolCall[];
}

interface AgentToolInput {
  agentName: string;
  conversationId: string;
  /** Whether the conversation's agent snapshot lists this tool; others are refused. */
  enabled: boolean;
  input: unknown;
  replay: HarnessReplayPolicy;
  toolCallId: string;
  toolName: string;
}

interface AgentToolResult {
  /** Text the tool sent through `api.output`, when any. */
  streamedOutput?: string;
  value: unknown;
}

export interface AgentTasks {
  tool: HarnessTaskDefinition<AgentToolInput, unknown, AgentToolResult>;
  turn: HarnessTaskDefinition<AgentTurnInput, AgentTurnState, HarnessTurnResult>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Tool results must be JSON; `undefined` becomes `null`. */
const toJsonValue = (value: unknown): unknown => {
  if (value === undefined) {
    return null;
  }
  return JSON.parse(JSON.stringify(value));
};

const requireAgent = (context: AgentLoopContext, name: string): HarnessAgentDefinition => {
  const agent = context.agents.get(name);
  if (!agent) {
    throw new Error(`Agent "${name}" is not in this harness registry`);
  }
  return agent;
};

const textOf = (parts: ReadonlyArray<HarnessMessagePart>): string =>
  parts
    .filter((part): part is {text: string; type: "text"} => part.type === "text")
    .map((part) => part.text)
    .join("");

/** Convert the stored transcript to AI SDK messages. Aborted (partial) messages are skipped. */
const toModelMessages = (
  history: ReadonlyArray<Pick<HarnessMessageDocument, "aborted" | "parts" | "role">>
): ModelMessage[] => {
  const messages: ModelMessage[] = [];
  for (const message of history) {
    if (message.aborted) {
      continue;
    }
    if (message.role === HARNESS_MESSAGE_ROLES.user) {
      messages.push({content: textOf(message.parts), role: "user"});
    } else if (message.role === HARNESS_MESSAGE_ROLES.system) {
      messages.push({content: textOf(message.parts), role: "system"});
    } else if (message.role === HARNESS_MESSAGE_ROLES.assistant) {
      const content: Array<TextPart | ToolCallPart> = [];
      for (const part of message.parts) {
        if (part.type === "text" && part.text) {
          content.push({text: part.text, type: "text"});
        } else if (part.type === "tool-call") {
          content.push({
            input: part.input,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            type: "tool-call",
          });
        }
      }
      if (content.length > 0) {
        messages.push({content, role: "assistant"});
      }
    } else {
      const content: ToolContent = message.parts
        .filter((part): part is HarnessToolResultPart => part.type === "tool-result")
        .map(
          (part): ToolResultPart => ({
            output: part.isError
              ? {type: "error-text", value: String(part.output)}
              : {type: "json", value: (part.output ?? null) as JSONValue},
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            type: "tool-result",
          })
        );
      if (content.length > 0) {
        messages.push({content, role: "tool"});
      }
    }
  }
  return messages;
};

/** AI SDK tools without `execute`: the model's calls come back to the turn, which runs them. */
const buildToolSet = (
  agent: HarnessAgentDefinition,
  allowed: ReadonlyArray<string>
): ToolSet | undefined => {
  const tools = agent.tools.filter((tool) => allowed.includes(tool.name));
  if (tools.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      aiTool({description: tool.description, inputSchema: tool.parameters as never}),
    ])
  );
};

const costUsd = ({
  inputTokens,
  modelId,
  outputTokens,
  priceMap,
}: {
  inputTokens?: number;
  modelId: string;
  outputTokens?: number;
  priceMap?: Record<string, ModelPrice>;
}): number | undefined => {
  const price = priceMap?.[modelId];
  if (!price || inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  return (price.inputPerMTok * inputTokens + price.outputPerMTok * outputTokens) / 1_000_000;
};

/** Hand out `count` consecutive message seqs for a conversation inside a transaction. */
const allocateSeqs = async ({
  conversationId,
  count,
  models,
  session,
}: {
  conversationId: string;
  count: number;
  models: HarnessModels;
  session: mongoose.ClientSession;
}): Promise<number> => {
  const updated = await models.conversation.findOneAndUpdate(
    {_id: conversationId},
    {$inc: {seq: count}},
    {returnDocument: "after", session}
  );
  if (!updated) {
    throw new Error(`Conversation ${conversationId} no longer exists`);
  }
  return updated.seq - count + 1;
};

/** Parse the final answer against the agent's `output` schema. */
const parseStructuredOutput = (
  agent: HarnessAgentDefinition,
  text: string
): {error?: string; output?: unknown} => {
  if (!agent.output) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizeLlmJsonTextForStructuredOutput(text));
  } catch (error: unknown) {
    return {error: `Agent "${agent.name}" output is not JSON: ${errorMessage(error)}`};
  }
  const result = agent.output.safeParse(parsed);
  if (!result.success) {
    return {
      error: `Agent "${agent.name}" output does not match its schema: ${result.error.message}`,
    };
  }
  return {output: result.data};
};

const loadConversation = (
  models: HarnessModels,
  conversationId: string
): Promise<HarnessConversationDocument> =>
  models.conversation.findExactlyOne({_id: conversationId});

/**
 * Build the built-in `terreno.agent.turn@1` and `terreno.agent.tool@1` task definitions.
 *
 * A turn alternates two replay-safe phases. `request` calls the model (with retries and
 * fallbacks) and commits the assistant message and its LLM span with the checkpoint.
 * `tools` runs each tool call as a child task, waits for all of them, and commits the
 * tool result messages. The loop ends when the model answers without tool calls, or once
 * `maxSteps` model requests have been made.
 */
export const createAgentTasks = (context: AgentLoopContext): AgentTasks => {
  const {models} = context;

  /**
   * Free the conversation inside a turn's terminal commit, so `idle` lands with the
   * outcome. Fenced on this turn; the runner's post-commit release covers thrown failures.
   */
  const releaseConversationIn: HarnessCommitWrites = async ({session, task}) => {
    await models.conversation.updateOne(
      {_id: task.ownership.id, activeTurnTaskId: task._id, status: "busy"},
      {$set: {status: "idle"}, $unset: {activeTurnTaskId: 1}},
      {session}
    );
  };

  const runTool = async (
    task: HarnessTaskView<AgentToolInput, unknown>,
    rt: HarnessTaskRuntime<unknown, AgentToolResult>
  ): Promise<void> => {
    const {agentName, conversationId, enabled, input, toolName} = task.input;
    const tool = enabled
      ? context.agents.get(agentName)?.tools.find(({name}) => name === toolName)
      : undefined;
    if (!tool) {
      await rt.commit({terminal: {error: `Unknown tool "${toolName}"`, status: "failed"}});
      return;
    }
    const args = tool.parameters.safeParse(input);
    if (!args.success) {
      await rt.commit({
        terminal: {
          error: `Invalid arguments for tool "${toolName}": ${args.error.message}`,
          status: "failed",
        },
      });
      return;
    }
    const streamed: string[] = [];
    let value: unknown;
    try {
      const returned = await tool.execute(args.data, {
        conversationId,
        env: rt.env,
        output: (text: string) => {
          streamed.push(String(text));
        },
        signal: rt.signal,
        taskId: rt.taskId,
      });
      value = toJsonValue(returned);
    } catch (error: unknown) {
      // An abort is the harness's business; any other throw is reported to the model.
      if (rt.signal.aborted) {
        throw error;
      }
      await rt.commit({
        terminal: {error: `Tool "${toolName}" failed: ${errorMessage(error)}`, status: "failed"},
      });
      return;
    }
    const result: AgentToolResult = {value};
    if (streamed.length > 0) {
      result.streamedOutput = streamed.join("");
    }
    await rt.commit({terminal: {result, status: "completed"}});
  };

  const tool = defineTask<AgentToolInput, unknown, AgentToolResult>({
    // The replay choice is the tool's, so it picks the phase; both phases run the same code.
    initial: (input) => ({phase: input.replay === "safe" ? "executeSafe" : "execute"}),
    name: AGENT_TOOL_TASK_NAME,
    onInterrupt: "fail",
    phases: {
      execute: {run: runTool},
      executeSafe: {replay: "safe", run: runTool},
    },
    // A failing tool is reported to the model, not retried.
    retry: {maxAttempts: 1},
    spanKind: "TOOL",
    spanName: (input) => input.toolName,
    version: 1,
  });

  const request = async (
    task: HarnessTaskView<AgentTurnInput, AgentTurnState>,
    rt: HarnessTaskRuntime<AgentTurnState, HarnessTurnResult>
  ): Promise<void> => {
    const {conversationId} = task.input;
    const conversation = await loadConversation(models, conversationId);
    const agent = requireAgent(context, conversation.agent.name);
    if (!context.resolveModel) {
      throw new Error("Harness.open needs a models resolver to run agents");
    }
    const history = await models.message.find({conversationId}).sort({seq: 1});
    const messages = toModelMessages(history);
    const tools = buildToolSet(agent, conversation.agent.tools);
    const {instructions} = conversation.agent;
    const spanInput = {
      // The transcript is stored permanently; the span names the slice that was sent so
      // its size stays bounded however long the conversation grows.
      messages: {count: messages.length, fromSeq: history[0]?.seq, toSeq: history.at(-1)?.seq},
      models: [conversation.agent.model, ...(conversation.agent.fallbackModels ?? [])],
      system: instructions,
      tools: tools ? Object.keys(tools) : [],
    };
    const commit = internalRuntime(rt as HarnessTaskRuntime<unknown, unknown>).commitWithWrites;
    const startedAt = DateTime.now();
    const resolveModel = context.resolveModel;
    const requestModel = () =>
      callModelWithFallback({
        call: (model) =>
          generateText({
            abortSignal: rt.signal,
            // Retries and fallbacks are the harness's; the SDK must not retry on its own.
            maxRetries: 0,
            messages,
            model,
            system: instructions,
            tools,
          }),
        models: [conversation.agent.model, ...(conversation.agent.fallbackModels ?? [])],
        random: context.random,
        resolveModel,
        retry: agent.modelRetry,
        signal: rt.signal,
      });
    let call: Awaited<ReturnType<typeof requestModel>>;
    try {
      call = await requestModel();
    } catch (error: unknown) {
      if (!(error instanceof HarnessModelCallError) || rt.signal.aborted) {
        throw error;
      }
      // Record every failed attempt on an error LLM span with the failed outcome.
      const last = error.attempts.at(-1);
      await commit({terminal: {error: error.message, status: "failed"}}, async (context) => {
        const endedAt = DateTime.now();
        await models.span.create(
          [
            {
              durationMs: endedAt.diff(startedAt).toMillis(),
              endedAt: endedAt.toJSDate(),
              error: error.message,
              input: spanInput,
              kind: "LLM",
              name: last ? `${last.provider}/${last.modelId}` : "model",
              output: {attempts: error.attempts},
              parentSpanId: context.task.rootSpanId,
              startedAt: startedAt.toJSDate(),
              startOffsetMs: startedAt.diff(context.traceStartedAt).toMillis(),
              status: "error",
              traceId: context.task.traceId,
            },
          ],
          {session: context.session}
        );
        await releaseConversationIn(context);
      });
      return;
    }
    const {result} = call;
    const step = task.state.step + 1;
    const text = result.text ?? "";
    const toolCalls: PendingToolCall[] = result.toolCalls.map((toolCall) => ({
      input: toolCall.input,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
    }));
    const parts: HarnessMessagePart[] = [
      ...(text ? [{text, type: "text" as const}] : []),
      ...toolCalls.map((toolCall): HarnessToolCallPart => ({...toolCall, type: "tool-call"})),
    ];

    const writes: HarnessCommitWrites = async ({session, task: turn, traceStartedAt}) => {
      const seq = await allocateSeqs({conversationId, count: 1, models, session});
      await models.message.create(
        [
          {
            conversationId,
            parts,
            role: HARNESS_MESSAGE_ROLES.assistant,
            seq,
            turnTaskId: turn._id,
          },
        ],
        {session}
      );
      const endedAt = DateTime.now();
      const {inputTokens, outputTokens} = result.usage;
      await models.span.create(
        [
          {
            durationMs: endedAt.diff(startedAt).toMillis(),
            endedAt: endedAt.toJSDate(),
            input: spanInput,
            kind: "LLM",
            name: `${call.model.provider}/${call.model.modelId}`,
            output: {
              attempts: call.attempts,
              finishReason: result.finishReason,
              text,
              toolCalls,
            },
            parentSpanId: turn.rootSpanId,
            startedAt: startedAt.toJSDate(),
            startOffsetMs: startedAt.diff(traceStartedAt).toMillis(),
            status: "ok",
            traceId: turn.traceId,
            usage: {
              costUsd: costUsd({
                inputTokens,
                modelId: call.model.modelId,
                outputTokens,
                priceMap: context.priceMap(),
              }),
              inputTokens,
              model: call.model.modelId,
              outputTokens,
            },
          },
        ],
        {session}
      );
    };

    if (toolCalls.length > 0) {
      await commit({phase: "tools", state: {step, text, toolCalls}}, writes);
      return;
    }
    const finalWrites: HarnessCommitWrites = async (writeContext) => {
      await writes(writeContext);
      await releaseConversationIn(writeContext);
    };
    const structured = parseStructuredOutput(agent, text);
    if (structured.error) {
      await commit({terminal: {error: structured.error, status: "failed"}}, finalWrites);
      return;
    }
    const done: HarnessTurnResult = {finishReason: "stop", steps: step, text};
    if (structured.output !== undefined) {
      done.output = structured.output;
    }
    await commit({terminal: {result: done, status: "completed"}}, finalWrites);
  };

  const runTools = async (
    task: HarnessTaskView<AgentTurnInput, AgentTurnState>,
    rt: HarnessTaskRuntime<AgentTurnState, HarnessTurnResult>
  ): Promise<void> => {
    const {conversationId} = task.input;
    const {step, text} = task.state;
    const toolCalls = task.state.toolCalls ?? [];
    const conversation = await loadConversation(models, conversationId);
    const agent = requireAgent(context, conversation.agent.name);

    const ids: string[] = [];
    for (const [index, call] of toolCalls.entries()) {
      const declared = agent.tools.find(({name}) => name === call.toolName);
      ids.push(
        await rt.createTask(
          tool,
          {
            agentName: agent.name,
            conversationId,
            enabled: Boolean(declared) && conversation.agent.tools.includes(call.toolName),
            input: call.input,
            replay: declared?.replay ?? "never",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
          },
          {key: `${index}:${call.toolCallId}`}
        )
      );
    }
    const outcomes = await rt.waitForTasks(ids);

    const results = toolCalls.map((call, index): HarnessToolResultPart => {
      const outcome = outcomes[index] as HarnessChildOutcome;
      const isError = outcome.status !== "completed";
      return {
        isError,
        output: isError
          ? (outcome.error ?? `Tool call ${outcome.status}`)
          : ((outcome.result as AgentToolResult | undefined)?.value ?? null),
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        type: "tool-result",
      };
    });

    const writes: HarnessCommitWrites = async ({session, task: turn}) => {
      if (results.length === 0) {
        return;
      }
      const first = await allocateSeqs({conversationId, count: results.length, models, session});
      await models.message.create(
        results.map((part, index) => ({
          conversationId,
          parts: [part],
          role: HARNESS_MESSAGE_ROLES.tool,
          seq: first + index,
          status: part.isError ? ("error" as const) : ("ok" as const),
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          turnTaskId: turn._id,
        })),
        {ordered: true, session}
      );
    };

    const commit = internalRuntime(rt as HarnessTaskRuntime<unknown, unknown>).commitWithWrites;
    if (step >= conversation.agent.maxSteps) {
      await commit(
        {terminal: {result: {finishReason: "max-steps", steps: step, text}, status: "completed"}},
        async (writeContext) => {
          await writes(writeContext);
          await releaseConversationIn(writeContext);
        }
      );
      return;
    }
    await commit({phase: "request", state: {step, text}}, writes);
  };

  const turn = defineTask<AgentTurnInput, AgentTurnState, HarnessTurnResult>({
    initial: () => ({phase: "request", state: {step: 0, text: ""}}),
    name: AGENT_TURN_TASK_NAME,
    phases: {
      // A model request has no side effect, so an interrupted one is simply re-requested.
      request: {replay: "safe", run: request},
      // Tool children are idempotent per phase visit, so re-running the fan-out is safe.
      tools: {replay: "safe", run: runTools},
    },
    // Model retries and fallbacks happen inside `request`; a turn that still fails, fails.
    retry: {maxAttempts: 1},
    version: 1,
  });

  return {tool, turn};
};
