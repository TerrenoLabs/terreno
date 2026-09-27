import {APIError, logger, type z} from "@terreno/api";
import {
  ASK_CANCEL_REASONS,
  ASK_KINDS,
  type Ask,
  type AskKind,
  type AskResponse,
  type AskSurface,
  askInputSchemaFor,
  askInputSchemas,
  askKindsForSurface,
  askOutputSchemas,
  askPromptSection,
  type CompactAskKind,
  isCompactAskKind,
} from "@terreno/blocks";
import {
  type JSONValue,
  type ModelMessage,
  type Tool,
  type ToolCallPart,
  type ToolResultPart,
  tool,
} from "ai";

import type {AsksOptions} from "../types";
import {
  ASK_CHOICE_TOOL_DESCRIPTION,
  ASK_CONFIRM_TOOL_DESCRIPTION,
  ASK_MARKDOWN_TOOL_DESCRIPTION,
  COMPACT_ASK_CHOICE_TOOL_DESCRIPTION,
  COMPACT_ASK_CONFIRM_TOOL_DESCRIPTION,
  TERRENO_ASKS_SYSTEM_PROMPT,
  UNANSWERED_TOOL_CALL_RESULT,
} from "./prompts";

const ASK_TOOL_PREFIX = "ask_";

const ASK_TOOL_DESCRIPTIONS: Record<AskKind, string> = {
  choice: ASK_CHOICE_TOOL_DESCRIPTION,
  confirm: ASK_CONFIRM_TOOL_DESCRIPTION,
  markdown: ASK_MARKDOWN_TOOL_DESCRIPTION,
};

const COMPACT_ASK_TOOL_DESCRIPTIONS: Record<CompactAskKind, string> = {
  choice: COMPACT_ASK_CHOICE_TOOL_DESCRIPTION,
  confirm: COMPACT_ASK_CONFIRM_TOOL_DESCRIPTION,
};

const askToolDescription = ({kind, surface}: {kind: AskKind; surface: AskSurface}): string =>
  surface === "compact" && isCompactAskKind(kind)
    ? COMPACT_ASK_TOOL_DESCRIPTIONS[kind]
    : ASK_TOOL_DESCRIPTIONS[kind];

/** The kinds the `asks` route option enables; empty when asks are off. Throws on unknown kinds. */
export const resolveAskKinds = (asks: boolean | AsksOptions | undefined): AskKind[] => {
  if (!asks) {
    return [];
  }
  const kinds = asks === true ? ASK_KINDS : (asks.kinds ?? ASK_KINDS);
  const unknownKinds = kinds.filter((kind) => !ASK_KINDS.includes(kind));
  if (unknownKinds.length > 0) {
    throw new APIError({
      detail: `Unknown ask kinds: ${unknownKinds.join(", ")}. Known kinds: ${ASK_KINDS.join(", ")}.`,
      status: 500,
      title: "The asks option lists unknown ask kinds",
    });
  }
  return [...new Set(kinds)];
};

export const askToolName = (kind: AskKind): string => `${ASK_TOOL_PREFIX}${kind}`;

/** The ask kind a tool name calls, or undefined when it is not one of the given kinds' tools. */
export const askKindFromToolName = (
  toolName: string,
  kinds: readonly AskKind[] = ASK_KINDS
): AskKind | undefined => kinds.find((kind) => askToolName(kind) === toolName);

/**
 * One tool per enabled kind the surface offers. Ask tools have no `execute`, so the AI SDK ends
 * the step loop when the model calls one and the turn pauses until the user answers. On the
 * compact surface each tool takes the kind's compact input schema, so an ask whose options do not
 * fit a small screen's buttons goes back to the model as a tool error.
 */
export const createAskTools = ({
  kinds,
  surface = "full",
}: {
  kinds: readonly AskKind[];
  surface?: AskSurface;
}): Record<string, Tool> =>
  Object.fromEntries(
    askKindsForSurface({kinds, surface}).map((kind) => [
      askToolName(kind),
      tool<Ask["input"], AskResponse>({
        description: askToolDescription({kind, surface}),
        inputSchema: askInputSchemaFor({kind, surface}) as z.ZodType<Ask["input"]>,
        outputSchema: askOutputSchemas[kind] as z.ZodType<AskResponse>,
      }),
    ])
  );

/** Types the input of a valid ask call. The AI SDK has already checked it against the kind's schema. */
export const parseAsk = ({input, kind}: {input: unknown; kind: AskKind}): Ask =>
  ({input: askInputSchemas[kind].parse(input), kind}) as Ask;

const reservedToolNames = (tools: Record<string, Tool>): string[] =>
  Object.keys(tools).filter((name) => name.startsWith(ASK_TOOL_PREFIX));

/** Throws when a host tool name uses the `ask_` prefix that ask tools own. */
export const assertNoReservedToolNames = (tools: Record<string, Tool> | undefined): void => {
  const reserved = reservedToolNames(tools ?? {});
  if (reserved.length > 0) {
    throw new APIError({
      detail: `Tool names starting with "${ASK_TOOL_PREFIX}" are reserved for asks: ${reserved.join(", ")}.`,
      status: 500,
      title: "Host tool names use the prefix reserved for asks",
    });
  }
};

/** Drops tools resolved per request (request tools, MCP tools) whose names use the `ask_` prefix. */
export const withoutReservedToolNames = (tools: Record<string, Tool>): Record<string, Tool> => {
  const reserved = reservedToolNames(tools);
  if (reserved.length === 0) {
    return tools;
  }
  logger.warn("Dropping tools whose names are reserved for asks", {tools: reserved});
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => !name.startsWith(ASK_TOOL_PREFIX))
  );
};

/** The asks section of the system prompt for the kinds offered on the surface. */
export const buildAsksSystemPrompt = ({
  kinds,
  surface = "full",
}: {
  kinds: readonly AskKind[];
  surface?: AskSurface;
}): string => `${TERRENO_ASKS_SYSTEM_PROMPT}\n\n${askPromptSection({kinds, surface})}`;

/**
 * A plain JSON copy of AI SDK messages. It drops `undefined` fields, which MongoDB would store as
 * null and the AI SDK would then reject when the messages are replayed.
 */
export const toStoredMessages = (messages: ModelMessage[]): ModelMessage[] =>
  JSON.parse(JSON.stringify(messages)) as ModelMessage[];

const outputForUnansweredCall = ({
  answer,
  call,
  toolCallId,
}: {
  answer: AskResponse;
  call: ToolCallPart;
  toolCallId: string;
}): ToolResultPart["output"] => {
  if (call.toolCallId === toolCallId) {
    return {type: "json", value: answer as JSONValue};
  }
  if (askKindFromToolName(call.toolName)) {
    return {type: "json", value: {action: "cancel", reason: ASK_CANCEL_REASONS.oneAskAtATime}};
  }
  return {type: "error-text", value: UNANSWERED_TOOL_CALL_RESULT};
};

/**
 * The paused turn's messages plus a result for every tool call its last step left without one:
 * the user's answer for the pending ask, `cancel` for asks dropped because the model asked more
 * than once, and an error for any other tool that did not run. Results join the step's tool
 * message, in call order, so providers see one tool message per assistant message.
 */
export const completePausedTurn = ({
  answer,
  responseMessages,
  toolCallId,
}: {
  answer: AskResponse;
  responseMessages: ModelMessage[];
  toolCallId: string;
}): ModelMessage[] => {
  const answeredIds = new Set<string>();
  for (const message of responseMessages) {
    if (typeof message.content === "string" || message.role === "system") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-result") {
        answeredIds.add(part.toolCallId);
      }
    }
  }

  const lastAssistant = responseMessages.findLast((message) => message.role === "assistant");
  const stepCalls =
    lastAssistant && typeof lastAssistant.content !== "string"
      ? lastAssistant.content.filter(
          (part): part is ToolCallPart => part.type === "tool-call" && !part.providerExecuted
        )
      : [];
  const newResults = stepCalls
    .filter((call) => !answeredIds.has(call.toolCallId))
    .map(
      (call): ToolResultPart => ({
        output: outputForUnansweredCall({answer, call, toolCallId}),
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        type: "tool-result",
      })
    );
  if (newResults.length === 0) {
    return responseMessages;
  }

  const callOrder = new Map(stepCalls.map((call, index) => [call.toolCallId, index]));
  const byCallOrder = (a: ToolResultPart, b: ToolResultPart): number =>
    (callOrder.get(a.toolCallId) ?? callOrder.size) -
    (callOrder.get(b.toolCallId) ?? callOrder.size);

  const lastMessage = responseMessages.at(-1);
  if (lastMessage?.role === "tool") {
    const existingResults = lastMessage.content.filter(
      (part): part is ToolResultPart => part.type === "tool-result"
    );
    const otherParts = lastMessage.content.filter((part) => part.type !== "tool-result");
    return [
      ...responseMessages.slice(0, -1),
      {
        ...lastMessage,
        content: [...[...existingResults, ...newResults].sort(byCallOrder), ...otherParts],
      },
    ];
  }
  return [...responseMessages, {content: newResults, role: "tool"}];
};
