import {
  tool as aiTool,
  generateText,
  type JSONValue,
  jsonSchema,
  type ModelMessage,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type TextPart,
  type ToolCallPart,
  type ToolContent,
  type ToolResultPart,
  type ToolSet,
} from "ai";
import {DateTime} from "luxon";
import type mongoose from "mongoose";
import type {ModelPrice} from "../observability/types";
import {withStrippedJsonFencesModel} from "../service/jsonFenceModel";
import {normalizeLlmJsonTextForStructuredOutput} from "../service/parseAiJson";
import type {
  AnyHarnessToolDefinition,
  HarnessAgentDefinition,
  HarnessChildOutcome,
  HarnessConversationDocument,
  HarnessExtensionDefinition,
  HarnessHookApi,
  HarnessMessageDocument,
  HarnessMessagePart,
  HarnessModelResolver,
  HarnessReplayPolicy,
  HarnessSystemPromptPart,
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
import {
  buildSystemPrompt,
  HarnessExtensionError,
  hashText,
  resolveExtensions,
  resolveTools,
  runAfterTool,
  runBeforeModelRequest,
  runBeforeTool,
} from "./extensions";
import {internalRuntime} from "./internalRuntime";
import {callModelWithFallback, HarnessModelCallError} from "./modelCall";
import {isHarnessSuspendSignal} from "./suspend";

/** Name of the built-in task that runs one agent turn on a conversation. */
export const AGENT_TURN_TASK_NAME = "terreno.agent.turn";
/** Name of the built-in task that runs one tool call of a turn. */
export const AGENT_TOOL_TASK_NAME = "terreno.agent.tool";

/** Everything the built-in agent tasks need from their harness. */
export interface AgentLoopContext {
  agents: Map<string, HarnessAgentDefinition>;
  extensions: Map<string, HarnessExtensionDefinition>;
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

/** A tool's own `execute` threw; reported to the model as `Tool "<name>" failed: ...`. */
class ToolExecuteError extends Error {
  constructor(toolName: string, cause: unknown) {
    super(`Tool "${toolName}" failed: ${errorMessage(cause)}`);
    this.name = "ToolExecuteError";
  }
}

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

const isSystemPromptRecord = (message: Pick<HarnessMessageDocument, "parts">): boolean =>
  message.parts.some((part) => part.type === "system-prompt");

/** Convert the stored transcript to AI SDK messages. Aborted (partial) messages are skipped. */
const toModelMessages = (
  history: ReadonlyArray<Pick<HarnessMessageDocument, "aborted" | "parts" | "role">>
): ModelMessage[] => {
  const messages: ModelMessage[] = [];
  for (const message of history) {
    // Aborted partials and recorded system prompts are never replayed to the model.
    if (message.aborted || isSystemPromptRecord(message)) {
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
  available: Map<string, AnyHarnessToolDefinition>,
  allowed: ReadonlyArray<string>
): ToolSet | undefined => {
  const tools = [...available.values()].filter((tool) => allowed.includes(tool.name));
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

/** How an `LLM` span names the system prompt it sent. */
interface SystemPromptSpan {
  hash: string;
  /** The `system` message holding the text; unset when it is the snapshot's instructions. */
  messageSeq?: number;
  sections: HarnessSystemPromptPart["sections"];
}

/**
 * Decide how a request's effective system prompt is recorded. When it differs from the
 * last recorded prompt (or, before any, from the conversation's instructions), `write`
 * appends a `system` message with a `system-prompt` part inside the request's commit, so
 * the transcript holds exactly what the model saw. `span` names it by hash and seq.
 */
const promptRecord = ({
  conversation,
  history,
  models,
  sections,
  system,
}: {
  conversation: HarnessConversationDocument;
  history: ReadonlyArray<HarnessMessageDocument>;
  models: HarnessModels;
  sections: HarnessSystemPromptPart["sections"];
  system: string;
}): {span: SystemPromptSpan; write: HarnessCommitWrites} => {
  const hash = hashText(system);
  const last = [...history].reverse().find(isSystemPromptRecord);
  const lastPart = last?.parts.find(
    (part): part is HarnessSystemPromptPart => part.type === "system-prompt"
  );
  const baseline = lastPart ? lastPart.hash : hashText(conversation.agent.instructions);
  const span: SystemPromptSpan = {hash, messageSeq: lastPart ? last?.seq : undefined, sections};
  if (hash === baseline) {
    return {span, write: async () => {}};
  }
  const conversationId = String(conversation._id);
  return {
    span,
    write: async ({session, task}) => {
      const seq = await allocateSeqs({conversationId, count: 1, models, session});
      const part: HarnessSystemPromptPart = {hash, sections, text: system, type: "system-prompt"};
      await models.message.create(
        [
          {
            conversationId,
            parts: [part],
            role: HARNESS_MESSAGE_ROLES.system,
            seq,
            turnTaskId: task._id,
          },
        ],
        {session}
      );
      span.messageSeq = seq;
    },
  };
};

/** What the turn keeps from one model response. */
interface ModelResponse {
  finishReason: string;
  /** Why the answer failed the conversation's `outputSchema`, when it did. */
  invalidOutput?: string;
  /** Parsed structured output, when the conversation requests one. */
  output?: unknown;
  text: string;
  toolCalls: ReadonlyArray<{input: unknown; toolCallId: string; toolName: string}>;
  usage: {inputTokens?: number; outputTokens?: number};
}

/**
 * The SDK parses structured output only for a final answer (`stop`, or text without tool
 * calls); otherwise reading it throws. Missing output is the caller's to report.
 */
const structuredOutputOf = (generated: {output: unknown}): unknown => {
  try {
    return generated.output;
  } catch (error: unknown) {
    if (NoOutputGeneratedError.isInstance(error)) {
      return undefined;
    }
    throw error;
  }
};

const describeInvalidOutput = (agentName: string, error: NoObjectGeneratedError): string => {
  const cause = error.cause ? `: ${errorMessage(error.cause)}` : "";
  return `Agent "${agentName}" output does not match its schema (${error.message})${cause}`;
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
      {
        _id: (task.input as AgentTurnInput).conversationId,
        activeTurnTaskId: task._id,
        status: "busy",
      },
      {$set: {status: "idle"}, $unset: {activeTurnTaskId: 1}},
      {session}
    );
  };

  /** Extensions a conversation uses, from its snapshot. */
  const conversationExtensions = (
    conversation: HarnessConversationDocument
  ): HarnessExtensionDefinition[] =>
    resolveExtensions(context.extensions, conversation.agent.extensions ?? []);

  /** Hook api for a tool call: memos are scoped to the turn task that owns the call. */
  const toolHookApi = async ({
    conversationId,
    extensions,
    rt,
  }: {
    conversationId: string;
    extensions: ReadonlyArray<HarnessExtensionDefinition>;
    rt: HarnessTaskRuntime<unknown, AgentToolResult>;
  }): Promise<HarnessHookApi> => {
    let turnTaskId = rt.taskId;
    if (extensions.length > 0) {
      const self = await models.task.findExactlyOne({_id: rt.taskId});
      turnTaskId = String(self.ownership.id ?? rt.taskId);
    }
    return {
      conversationId,
      memo: internalRuntime(rt as HarnessTaskRuntime<unknown, unknown>).memoFor(turnTaskId),
      signal: rt.signal,
      taskId: rt.taskId,
      turnTaskId,
    };
  };

  const runTool = async (
    task: HarnessTaskView<AgentToolInput, unknown>,
    rt: HarnessTaskRuntime<unknown, AgentToolResult>
  ): Promise<void> => {
    const {agentName, conversationId, enabled, input, toolCallId, toolName} = task.input;
    const fail = (error: string): Promise<void> => rt.commit({terminal: {error, status: "failed"}});
    const agent = context.agents.get(agentName);
    let extensions: HarnessExtensionDefinition[] = [];
    let tool: AnyHarnessToolDefinition | undefined;
    try {
      if (enabled && agent) {
        extensions = conversationExtensions(await loadConversation(models, conversationId));
        tool = resolveTools(agent, extensions).get(toolName);
      }
    } catch (error: unknown) {
      await fail(errorMessage(error));
      return;
    }
    if (!tool) {
      await fail(`Unknown tool "${toolName}"`);
      return;
    }
    const parsed = tool.parameters.safeParse(input);
    if (!parsed.success) {
      await fail(`Invalid arguments for tool "${toolName}": ${parsed.error.message}`);
      return;
    }
    const streamed: string[] = [];
    let value: unknown;
    try {
      const api = await toolHookApi({conversationId, extensions, rt});
      const before = await runBeforeTool({
        api,
        approvalFor: internalRuntime(rt as HarnessTaskRuntime<unknown, unknown>).approvalFor,
        call: {args: parsed.data, toolCallId, toolName},
        extensions,
      });
      if (before.blocked !== undefined) {
        await fail(before.blocked);
        return;
      }
      const args = tool.parameters.safeParse(before.args);
      if (!args.success) {
        await fail(
          `Invalid arguments for tool "${toolName}" after beforeTool hooks: ${args.error.message}`
        );
        return;
      }
      let returned: unknown;
      try {
        returned = await tool.execute(args.data, {
          conversationId,
          env: rt.env,
          output: (text: string) => {
            streamed.push(String(text));
          },
          signal: rt.signal,
          taskId: rt.taskId,
        });
      } catch (error: unknown) {
        throw new ToolExecuteError(toolName, error);
      }
      value = toJsonValue(
        await runAfterTool({
          api,
          call: {args: args.data, toolCallId, toolName},
          extensions,
          result: toJsonValue(returned),
        })
      );
    } catch (error: unknown) {
      // An abort or an approval wait is the harness's business; any other throw is
      // reported to the model.
      if (rt.signal.aborted || isHarnessSuspendSignal(error)) {
        throw error;
      }
      await fail(
        error instanceof ToolExecuteError || error instanceof HarnessExtensionError
          ? error.message
          : `Tool "${toolName}" failed: ${errorMessage(error)}`
      );
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
    const extensions = conversationExtensions(conversation);
    const history = await models.message.find({conversationId}).sort({seq: 1});
    const tools = buildToolSet(resolveTools(agent, extensions), conversation.agent.tools);
    const transcript = toModelMessages(history);
    const internals = internalRuntime(rt as HarnessTaskRuntime<unknown, unknown>);
    const api: HarnessHookApi = {
      conversationId,
      memo: rt.memo,
      signal: rt.signal,
      taskId: rt.taskId,
      turnTaskId: rt.taskId,
    };
    const built = await buildSystemPrompt({
      api,
      extensions,
      input: {
        agentName: agent.name,
        conversationId,
        messages: [...transcript],
        step: task.state.step + 1,
      },
      instructions: conversation.agent.instructions,
    });
    const {request: modelRequest, rewrittenBy} = await runBeforeModelRequest({
      api,
      extensions,
      request: {messages: [...transcript], system: built.text},
    });
    const {messages, system} = modelRequest;
    const prompt = promptRecord({
      conversation,
      history,
      models,
      sections: built.sections,
      system,
    });
    const spanInput = {
      // The transcript is stored permanently; the span names the slice that was sent so
      // its size stays bounded however long the conversation grows.
      messages: {
        count: messages.length,
        fromSeq: history[0]?.seq,
        // A hook replaced the messages: name exactly what was sent by hash.
        ...(rewrittenBy.length > 0 ? {hash: hashText(JSON.stringify(messages))} : {}),
        toSeq: history.at(-1)?.seq,
      },
      models: [conversation.agent.model, ...(conversation.agent.fallbackModels ?? [])],
      ...(rewrittenBy.length > 0 ? {rewrittenBy} : {}),
      system: prompt.span,
      tools: tools ? Object.keys(tools) : [],
    };
    const commit = internals.commitWithWrites;
    const startedAt = DateTime.now();
    const resolveModel = context.resolveModel;
    const {outputSchema} = conversation.agent;
    const output = outputSchema
      ? Output.object({schema: jsonSchema(JSON.parse(outputSchema))})
      : undefined;
    const requestModel = () =>
      callModelWithFallback({
        call: async (model): Promise<ModelResponse> => {
          try {
            const generated = await generateText({
              abortSignal: rt.signal,
              // Retries and fallbacks are the harness's; the SDK must not retry on its own.
              maxRetries: 0,
              messages,
              // Same fence and preamble cleanup AIService applies before `Output` parsing.
              model: output ? withStrippedJsonFencesModel(model) : model,
              output,
              system,
              tools,
            });
            return {
              finishReason: generated.finishReason,
              output: output ? structuredOutputOf(generated) : undefined,
              text: generated.text,
              toolCalls: generated.toolCalls,
              usage: generated.usage,
            };
          } catch (error: unknown) {
            // The model answered, but not with the requested structure: that is the
            // turn's outcome, not a model failure to retry or fall back from.
            if (!NoObjectGeneratedError.isInstance(error)) {
              throw error;
            }
            return {
              finishReason: error.finishReason ?? "stop",
              invalidOutput: describeInvalidOutput(conversation.agent.name, error),
              text: error.text ?? "",
              toolCalls: [],
              usage: error.usage ?? {inputTokens: undefined, outputTokens: undefined},
            };
          }
        },
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
        await prompt.write(context);
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

    const writes: HarnessCommitWrites = async (writeContext) => {
      const {session, task: turn, traceStartedAt} = writeContext;
      await prompt.write(writeContext);
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
    const structured = outputSchema
      ? {error: result.invalidOutput, output: result.output}
      : parseStructuredOutput(agent, text);
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

    // A wrap that throws here is reported by the tool call itself, which resolves again.
    let available: Map<string, AnyHarnessToolDefinition> | undefined;
    try {
      available = resolveTools(agent, conversationExtensions(conversation));
    } catch {
      available = undefined;
    }
    const ids: string[] = [];
    for (const [index, call] of toolCalls.entries()) {
      const declared = available?.get(call.toolName);
      ids.push(
        await rt.createTask(
          tool,
          {
            agentName: agent.name,
            conversationId,
            enabled:
              (available === undefined || Boolean(declared)) &&
              conversation.agent.tools.includes(call.toolName),
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
