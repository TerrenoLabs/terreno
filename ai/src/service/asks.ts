import {APIError, logger, type z} from "@terreno/api";
import {
  ASK_CANCEL_REASONS,
  ASK_KINDS,
  ASK_LIMITS,
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
  type ConfirmAnswer,
  type ConfirmAskInput,
  isCompactAskKind,
} from "@terreno/blocks";
import {
  type JSONValue,
  type ModelMessage,
  type Tool,
  type ToolApprovalRequest,
  type ToolApprovalResponse,
  type ToolCallPart,
  type ToolResultPart,
  tool,
} from "ai";

import type {AsksOptions} from "../types";
import {askFilesToolModelOutput} from "./askFiles";
import {
  ASK_CHOICE_TOOL_DESCRIPTION,
  ASK_CONFIRM_TOOL_DESCRIPTION,
  ASK_FILES_TOOL_DESCRIPTION,
  ASK_FORM_TOOL_DESCRIPTION,
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
  files: ASK_FILES_TOOL_DESCRIPTION,
  form: ASK_FORM_TOOL_DESCRIPTION,
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

/** The per-file cap for `files` answers: `asks.maxFileSizeBytes`, or 10 MB. */
export const resolveMaxFileSizeBytes = (asks: boolean | AsksOptions | undefined): number =>
  (typeof asks === "object" ? asks.maxFileSizeBytes : undefined) ??
  ASK_LIMITS.files.defaultMaxFileSizeBytes;

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
        ...(kind === "files" ? {toModelOutput: askFilesToolModelOutput} : {}),
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

/** A tool result part without the `fileData` a host tool returns for the client to download. */
const withoutFileData = (part: unknown): unknown => {
  const output = (part as {output?: {type?: string; value?: unknown}}).output;
  const value = output?.type === "json" ? output.value : undefined;
  if (typeof value !== "object" || value === null || !("fileData" in value)) {
    return part;
  }
  const {fileData: _fileData, ...rest} = value as Record<string, unknown>;
  return {...(part as object), output: {...output, value: rest}};
};

/**
 * A plain JSON copy of AI SDK messages. It drops `undefined` fields, which MongoDB would store as
 * null and the AI SDK would then reject when the messages are replayed. Tool results leave out
 * `fileData`, as the stored rows do, so a generated file is not stored twice.
 */
export const toStoredMessages = (messages: ModelMessage[]): ModelMessage[] =>
  (JSON.parse(JSON.stringify(messages)) as ModelMessage[]).map((message) =>
    message.role === "tool"
      ? ({...message, content: message.content.map(withoutFileData)} as ModelMessage)
      : message
  );

/** Why an approval was denied, as the model sees it in the tool's `execution-denied` result. */
const APPROVAL_DENIAL_REASONS = {
  cancelled: "user_cancelled",
  declined: "user_declined",
  denied: "user_denied",
} as const;

const truncate = (text: string, maxLength: number): string =>
  text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;

/** "Allow <toolName>?" with the tool's description, and Allow / Deny buttons. */
const defaultApprovalAskInput = ({
  description,
  toolName,
}: {
  description?: string;
  toolName: string;
}): ConfirmAskInput => {
  const question = `Allow ${toolName}?`;
  const detail = description?.trim();
  return {
    confirmLabel: "Allow",
    denyLabel: "Deny",
    prompt: truncate(detail ? `${question} ${detail}` : question, ASK_LIMITS.promptMaxLength),
  };
};

/**
 * The `confirm` input of the approval ask for one host tool call: the host's
 * `asks.approvals[toolName]`, or the default when it has none, throws, or returns an input that
 * is not a valid `confirm` input.
 */
export const approvalAskInput = ({
  asks,
  description,
  input,
  surface,
  toolName,
}: {
  asks: boolean | AsksOptions | undefined;
  description?: string;
  input: unknown;
  surface: AskSurface;
  toolName: string;
}): ConfirmAskInput => {
  const fallback = defaultApprovalAskInput({description, toolName});
  const approval = typeof asks === "object" ? asks.approvals?.[toolName] : undefined;
  if (!approval) {
    return fallback;
  }
  try {
    const parsed = askInputSchemaFor({kind: "confirm", surface}).safeParse(approval(input));
    if (parsed.success) {
      return parsed.data as ConfirmAskInput;
    }
    logger.warn("asks.approvals returned an invalid confirm input; using the default approval", {
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      toolName,
    });
  } catch (error) {
    logger.warn("asks.approvals threw; using the default approval", {
      error: error instanceof Error ? error.message : String(error),
      toolName,
    });
  }
  return fallback;
};

/** The approval an answer to an approval ask gives: only an accepted `{confirmed: true}` approves. */
const approvalResponseOf = (
  answer: AskResponse
): Pick<ToolApprovalResponse, "approved" | "reason"> => {
  if (answer.action === "accept") {
    return (answer.content as ConfirmAnswer).confirmed
      ? {approved: true}
      : {approved: false, reason: APPROVAL_DENIAL_REASONS.denied};
  }
  if (answer.action === "decline") {
    return {approved: false, reason: APPROVAL_DENIAL_REASONS.declined};
  }
  return {approved: false, reason: answer.reason ?? APPROVAL_DENIAL_REASONS.cancelled};
};

/**
 * The reason each denied approval in the messages' last tool message gives, by the tool call it
 * denied, so the turn can show why a tool did not run.
 */
export const deniedApprovalReasons = (
  messages: ModelMessage[]
): Map<string, string | undefined> => {
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "tool") {
    return new Map();
  }
  const toolCallIds = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-approval-request") {
        toolCallIds.set(part.approvalId, part.toolCallId);
      }
    }
  }
  return new Map(
    lastMessage.content.flatMap((part) => {
      const toolCallId =
        part.type === "tool-approval-response" && !part.approved
          ? toolCallIds.get(part.approvalId)
          : undefined;
      return toolCallId && part.type === "tool-approval-response"
        ? [[toolCallId, part.reason] as const]
        : [];
    })
  );
};

const outputForUnansweredCall = ({
  answer,
  answerOutput,
  call,
  toolCallId,
}: {
  answer: AskResponse;
  answerOutput?: ToolResultPart["output"];
  call: ToolCallPart;
  toolCallId: string;
}): ToolResultPart["output"] => {
  if (call.toolCallId === toolCallId) {
    return answerOutput ?? {type: "json", value: answer as JSONValue};
  }
  if (askKindFromToolName(call.toolName)) {
    return {type: "json", value: {action: "cancel", reason: ASK_CANCEL_REASONS.oneAskAtATime}};
  }
  return {type: "error-text", value: UNANSWERED_TOOL_CALL_RESULT};
};

/**
 * The paused turn's messages plus a result for every tool call its last step left without one:
 * the user's answer for the pending ask, `cancel` for asks dropped because the model asked more
 * than once, and an error for any other tool that did not run. A call waiting on approval gets a
 * `tool-approval-response` instead of a result, so the AI SDK runs or denies it when the turn
 * resumes: the user's answer decides the pending approval, `approvalId`, and every other
 * approval in the step is denied with `one_ask_at_a_time`. The
 * parts join the step's tool message, results in call order, so providers see one tool message
 * per assistant message. `answerOutput` replaces the answer's JSON result, such as a `files`
 * answer with its files.
 */
export const completePausedTurn = ({
  answer,
  answerOutput,
  approvalId,
  responseMessages,
  toolCallId,
}: {
  answer: AskResponse;
  answerOutput?: ToolResultPart["output"];
  /** Set when the pending ask is an approval: the approval request the answer decides. */
  approvalId?: string;
  responseMessages: ModelMessage[];
  toolCallId: string;
}): ModelMessage[] => {
  const answeredIds = new Set<string>();
  const respondedApprovalIds = new Set<string>();
  for (const message of responseMessages) {
    if (typeof message.content === "string" || message.role === "system") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-result") {
        answeredIds.add(part.toolCallId);
      } else if (part.type === "tool-approval-response") {
        respondedApprovalIds.add(part.approvalId);
      }
    }
  }

  const lastAssistant = responseMessages.findLast((message) => message.role === "assistant");
  const stepParts =
    lastAssistant && typeof lastAssistant.content !== "string" ? lastAssistant.content : [];
  const stepApprovalRequests = stepParts.filter(
    (part): part is ToolApprovalRequest => part.type === "tool-approval-request"
  );
  const awaitingApprovalIds = new Set(stepApprovalRequests.map((request) => request.toolCallId));
  const approvalRequests = stepApprovalRequests.filter(
    (request) => !respondedApprovalIds.has(request.approvalId)
  );
  const stepCalls = stepParts.filter(
    (part): part is ToolCallPart => part.type === "tool-call" && !part.providerExecuted
  );
  const newResults = stepCalls
    .filter(
      (call) => !answeredIds.has(call.toolCallId) && !awaitingApprovalIds.has(call.toolCallId)
    )
    .map(
      (call): ToolResultPart => ({
        output: outputForUnansweredCall({answer, answerOutput, call, toolCallId}),
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        type: "tool-result",
      })
    );
  const approvalResponses = approvalRequests.map(
    (request): ToolApprovalResponse => ({
      approvalId: request.approvalId,
      type: "tool-approval-response",
      ...(approvalId !== undefined && request.approvalId === approvalId
        ? approvalResponseOf(answer)
        : {approved: false, reason: ASK_CANCEL_REASONS.oneAskAtATime}),
    })
  );
  if (newResults.length === 0 && approvalResponses.length === 0) {
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
        content: [
          ...[...existingResults, ...newResults].sort(byCallOrder),
          ...otherParts,
          ...approvalResponses,
        ],
      },
    ];
  }
  return [...responseMessages, {content: [...newResults, ...approvalResponses], role: "tool"}];
};
