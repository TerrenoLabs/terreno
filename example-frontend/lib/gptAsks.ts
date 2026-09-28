import {
  type AskFilesResolver,
  type AskSubmission,
  type ChatAsk,
  type GPTChatMessage,
  type GPTChatProps,
  normalizeMimeType,
  resolveAskFilesAsDataUrls,
  type SelectedFile,
} from "@terreno/ui";

import type {GptHistory} from "@/store/sdk";

type AskResponse = AskSubmission["response"];
type AskFieldErrors = NonNullable<GPTChatProps["askErrors"]>[string];
type AskFileRef = Awaited<ReturnType<AskFilesResolver>>[number];
type HistoryPrompt = GptHistory["prompts"][number];

/** The `{ask}` event the server streams when the model asks the user a question. */
export interface AskStreamEvent {
  input: Record<string, unknown>;
  kind: ChatAsk["kind"];
  simple?: Record<string, unknown>;
  toolCallId: string;
}

/**
 * The transcript without assistant rows that hold nothing to show. A row with only an image or a
 * file is kept: its text is empty but its attachments are the reply.
 */
export const withoutEmptyAssistant = (messages: GPTChatMessage[]): GPTChatMessage[] =>
  messages.filter(
    (message) =>
      message.role !== "assistant" ||
      Boolean(message.content) ||
      (message.contentParts?.length ?? 0) > 0
  );

/**
 * Applies a `{toolResult}` event. A tool call opens an empty reply for the text that follows its
 * result, so the result goes before that reply. A tool run by an answered approval streams no tool
 * call, so its result goes last, after the ask's own result row, as the server saves it.
 */
export const withToolResult = ({
  messages,
  toolResult,
}: {
  messages: GPTChatMessage[];
  toolResult: NonNullable<GPTChatMessage["toolResult"]>;
}): GPTChatMessage[] => {
  const resultMessage: GPTChatMessage = {
    content: `Tool result: ${toolResult.toolName}`,
    role: "tool-result",
    toolResult,
  };
  const last = messages.at(-1);
  if (last && withoutEmptyAssistant([last]).length === 0) {
    return [...messages.slice(0, -1), resultMessage, last];
  }
  return [...messages, resultMessage];
};

/**
 * The conversation an answer goes to: the one the ask's `{ask}` event named, so an ask on a new
 * chat can be answered before `{done}` opens it, else the open conversation.
 */
export const answerHistoryId = ({
  askHistoryIds,
  currentHistoryId,
  toolCallId,
}: {
  askHistoryIds: ReadonlyMap<string, string>;
  currentHistoryId: string | undefined;
  toolCallId: string;
}): string | undefined => askHistoryIds.get(toolCallId) ?? currentHistoryId;

/** The `{askResolved}` event that starts a turn which answered or cancelled an ask. */
export interface AskResolvedStreamEvent {
  action: AskResponse["action"];
  toolCallId: string;
}

/** What the server records for a pending ask when the user sends a message instead of answering. */
const CANCELLED_BY_MESSAGE: AskResponse = {action: "cancel", reason: "user_sent_message"};

const askToolName = (kind: ChatAsk["kind"]): string => `ask_${kind}`;

/**
 * The server validates an ask's input and card before storing or streaming them, and `AskCard`
 * checks the input again before it renders controls, so the wire values are used as they are.
 */
const toChatAsk = ({
  input,
  kind,
  simple,
  status,
  toolCallId,
}: Omit<AskStreamEvent, "simple"> & {
  simple?: Record<string, unknown>;
  status: ChatAsk["status"];
}): ChatAsk => ({input, kind, status, toolCallId, ...(simple ? {simple} : {})}) as ChatAsk;

/**
 * The ask a saved history row holds, if any. Only the conversation's `pendingAsk` can still be
 * answered, so a row marked pending that is not the pending ask shows as cancelled.
 */
export const askFromHistoryPrompt = ({
  pendingAsk,
  prompt,
}: {
  pendingAsk?: GptHistory["pendingAsk"];
  prompt: HistoryPrompt;
}): ChatAsk | undefined => {
  if (prompt.type !== "tool-call" || !prompt.ask || !prompt.toolCallId) {
    return undefined;
  }
  const isPendingAsk = pendingAsk?.toolCallId === prompt.toolCallId;
  const status = prompt.ask.status === "pending" && !isPendingAsk ? "cancelled" : prompt.ask.status;
  return toChatAsk({
    input: prompt.args ?? {},
    kind: prompt.ask.kind,
    simple: isPendingAsk ? pendingAsk?.simple : undefined,
    status,
    toolCallId: prompt.toolCallId,
  });
};

/** The transcript message for a streamed `{ask}`: a tool-call row holding the pending ask. */
export const askMessage = (event: AskStreamEvent): GPTChatMessage => {
  const toolName = askToolName(event.kind);
  return {
    ask: toChatAsk({...event, status: "pending"}),
    content: `Tool call: ${toolName}`,
    role: "tool-call",
    toolCall: {args: event.input, toolCallId: event.toolCallId, toolName},
  };
};

const resolvedResponse = ({
  action,
  submitted,
  toolCallId,
}: AskResolvedStreamEvent & {submitted?: AskSubmission}): AskResponse | undefined => {
  if (submitted?.toolCallId === toolCallId) {
    return submitted.response;
  }
  if (action === "cancel") {
    return CANCELLED_BY_MESSAGE;
  }
  return undefined;
};

/**
 * Applies an `{askResolved}` event: marks the ask answered or cancelled and adds its result row
 * right after it, as the server saves them, so message indexes keep matching history rows (ratings
 * are sent by index). `submitted` is the answer this client sent, when the turn is an answer.
 */
export const withResolvedAsk = ({
  action,
  messages,
  submitted,
  toolCallId,
}: AskResolvedStreamEvent & {
  messages: GPTChatMessage[];
  submitted?: AskSubmission;
}): GPTChatMessage[] => {
  const index = messages.findIndex((message) => message.ask?.toolCallId === toolCallId);
  const resolvedMessage = messages[index];
  if (!resolvedMessage?.ask) {
    return messages;
  }
  const response = resolvedResponse({action, submitted, toolCallId});
  const toolName = askToolName(resolvedMessage.ask.kind);
  const ask: ChatAsk = {
    ...resolvedMessage.ask,
    status: action === "cancel" ? "cancelled" : "answered",
    ...(response ? {response} : {}),
  };
  const resultMessage: GPTChatMessage = {
    content: `Tool result: ${toolName}`,
    role: "tool-result",
    toolResult: {result: response ?? {action}, toolCallId, toolName},
  };
  return [
    ...messages.slice(0, index),
    {...resolvedMessage, ask},
    resultMessage,
    ...messages.slice(index + 1),
  ];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The `fields` of a 400 answer response, shown inline on the ask. */
export const askErrorsFromBody = (body: unknown): AskFieldErrors | undefined => {
  if (!isRecord(body) || !Array.isArray(body.fields) || body.fields.length === 0) {
    return undefined;
  }
  return body.fields as AskFieldErrors;
};

/** The part of a POST /files/upload response that a `files` answer needs. */
export interface UploadedAskFile {
  id: string;
  size: number;
}

/**
 * Uploads one picked file to POST /files/upload. Resolves undefined when the server answers 404,
 * which means it has no file storage (no GCS bucket) and so no file routes.
 */
export type AskFileUploader = (file: SelectedFile) => Promise<UploadedAskFile | undefined>;

/** The `data` of a POST /files/upload response, or undefined when it has no id or size. */
export const uploadedFileFromBody = (body: unknown): UploadedAskFile | undefined => {
  const data = isRecord(body) ? body.data : undefined;
  if (!isRecord(data) || typeof data.id !== "string" || typeof data.size !== "number") {
    return undefined;
  }
  return {id: data.id, size: data.size};
};

/**
 * The example app's `resolveAskFiles`: it uploads each picked file and answers with `{fileId}`
 * refs, so the conversation stores only ids. When the server has no file routes it sends every
 * file as a data URL instead, and skips the upload attempt from then on.
 */
export const createAskFilesResolver = ({
  toDataUrlRefs = resolveAskFilesAsDataUrls,
  upload,
}: {
  toDataUrlRefs?: AskFilesResolver;
  upload: AskFileUploader;
}): AskFilesResolver => {
  let hasFileRoutes = true;
  return async (files) => {
    if (!hasFileRoutes) {
      return toDataUrlRefs(files);
    }
    const refs: AskFileRef[] = [];
    for (const file of files) {
      const uploaded = await upload(file);
      if (!uploaded) {
        hasFileRoutes = false;
        return toDataUrlRefs(files);
      }
      refs.push({
        fileId: uploaded.id,
        filename: file.name,
        mimeType: normalizeMimeType(file.mimeType),
        size: uploaded.size,
      });
    }
    return refs;
  };
};

/** The message of a JSON error response: its `detail`, or its `title` without one. */
export const errorDetailFromBody = (body: unknown): string | undefined => {
  if (!isRecord(body)) {
    return undefined;
  }
  if (typeof body.detail === "string" && body.detail) {
    return body.detail;
  }
  return typeof body.title === "string" && body.title ? body.title : undefined;
};
