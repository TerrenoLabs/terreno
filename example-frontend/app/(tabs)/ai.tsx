import {type BlocksDocument, parseBlocks} from "@terreno/blocks";
import {baseUrl, selectBetterAuthUserId, useFeatureFlags, useMCPTools} from "@terreno/rtk";
import {
  type AskSubmission,
  type BlockChatEvent,
  Box,
  GPTChat,
  type GPTChatHistory,
  type GPTChatMessage,
  type GPTChatProps,
  Heading,
  type MCPToolDetail,
  type MessageContentPart,
  type SelectedFile,
  Spinner,
  selectedFileMimeType,
  useStoredState,
} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {type ImageSourcePropType, Linking, Platform, Image as RNImage} from "react-native";
import {useSelector} from "react-redux";
import {getSessionToken} from "@/lib/betterAuth";
import {fileUploadsEnabledFromFlags} from "@/lib/fileUploads";
import {
  answerHistoryId,
  askErrorsFromBody,
  askFromHistoryPrompt,
  askMessage,
  createAskFilesResolver,
  createAskFileUploader,
  errorDetailFromBody,
  readJson,
  withoutEmptyAssistant,
  withResolvedAsk,
  withToolResult,
} from "@/lib/gptAsks";
import {selectGptMascotIndex} from "@/lib/gptMascot";
import {useAppDispatch} from "@/store/index";
import {
  type GptHistory,
  openapi,
  terrenoApi,
  useDeleteGptHistoriesByIdMutation,
  useGetAiModelsQuery,
  useGetGptHistoriesQuery,
  usePatchGptHistoriesByIdMutation,
  usePostFilesUploadMutation,
  usePostGptActionsMutation,
} from "@/store/sdk";

type AskErrors = NonNullable<GPTChatProps["askErrors"]>;

const componentCaption = (text: string): string | undefined => {
  const parsed = parseBlocks(text);
  if (!parsed.ok) {
    return undefined;
  }
  const value = parsed.value;
  if (
    typeof value !== "object" ||
    value === null ||
    !("blocks" in value) ||
    !Array.isArray(value.blocks)
  ) {
    return undefined;
  }
  const count = value.blocks.length;
  return count === 1 ? "1 component" : `${count} components`;
};

interface TurnRequest {
  body: Record<string, unknown>;
  /**
   * The ask a prompt turn leaves behind. When no `{askResolved}` cancels it, another tab resolved
   * it first, so the saved conversation is shown after the turn.
   */
  pendingAskId?: string;
  /** The answer this turn sends, so its `{askResolved}` event can show what the user chose. */
  submitted?: AskSubmission;
}

type TurnOutcome =
  | {kind: "streamed"}
  | {fields: AskErrors[string]; kind: "invalidAnswer"}
  | {detail: string; kind: "conflict"};

const mapHistoryToChat = (history: GptHistory): GPTChatHistory => ({
  id: history.id,
  prompts: history.prompts.map((p) => {
    const ask = askFromHistoryPrompt({pendingAsk: history.pendingAsk, prompt: p});
    const blockNote = p.type === "assistant" ? componentCaption(p.text) : undefined;
    return {
      ...(ask ? {ask} : {}),
      ...(blockNote ? {blockNote} : {}),
      content: p.text,
      contentParts: p.content?.map((c): MessageContentPart => {
        if (c.type === "text") {
          return {text: c.text ?? "", type: "text"};
        }
        if (c.type === "image") {
          return {mimeType: c.mimeType, type: "image", url: c.url ?? ""};
        }
        return {filename: c.filename, mimeType: c.mimeType ?? "", type: "file", url: c.url ?? ""};
      }),
      rating: p.rating,
      role: p.type,
      ...(p.toolCallId && p.type === "tool-call"
        ? {toolCall: {args: p.args ?? {}, toolCallId: p.toolCallId, toolName: p.toolName ?? ""}}
        : {}),
      ...(p.toolCallId && p.type === "tool-result"
        ? {toolResult: {result: p.result, toolCallId: p.toolCallId, toolName: p.toolName ?? ""}}
        : {}),
    };
  }),
  title: history.title,
  updated: history.updated,
});

const IMAGE_MIME_PREFIXES = ["image/"];

const isImageMimeType = (mimeType: string): boolean =>
  IMAGE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));

const readFileAsBase64DataUrl = async (uri: string, _mimeType: string): Promise<string> => {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/** The multipart part for a picked file: a typed Blob on web, a `{uri, name, type}` part on native. */
const uploadFormData = async (file: SelectedFile): Promise<FormData> => {
  const form = new FormData();
  const type = selectedFileMimeType(file);
  if (Platform.OS !== "web") {
    form.append("file", {name: file.name, type, uri: file.uri} as unknown as Blob);
    return form;
  }
  const blob = await (await fetch(file.uri)).blob();
  form.append("file", new Blob([blob], {type}), file.name);
  return form;
};

/** One `data:` event from POST /gpt/prompt or GET /gpt/histories/:id/stream. */
interface GptStreamEvent {
  done?: boolean;
  error?: string;
  file?: {filename?: string; mimeType?: string; url: string};
  historyId?: string;
  image?: {mimeType?: string; url: string};
  /** Resume only: the persisted reply was rewritten; `text` is the whole reply. */
  replace?: boolean;
  resumed?: boolean;
  started?: boolean;
  streamId?: string;
  text?: string;
  title?: string;
  toolCall?: GPTChatMessage["toolCall"];
  toolResult?: GPTChatMessage["toolResult"];
}

/** Read an SSE response body and hand each parsed `data:` event to `onEvent`. */
const readSseEvents = async (
  response: Response,
  onEvent: (event: GptStreamEvent) => void
): Promise<void> => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const {done, value} = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split("\n");
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) {
        continue;
      }
      let event: GptStreamEvent;
      try {
        event = JSON.parse(trimmed.slice(6));
      } catch {
        // Skip malformed JSON lines
        continue;
      }
      onEvent(event);
    }
  }
};

/** The in-flight reply of a stored history, if /gpt/prompt is still streaming it. */
const findStreamingReply = (history?: GptHistory): {text: string} | undefined => {
  const last = history?.prompts[history.prompts.length - 1];
  return last?.type === "assistant" && last.status === "streaming" ? {text: last.text} : undefined;
};

/**
 * Fallback model list used before the backend responds (or if the request fails). The live list is
 * fetched from GET /ai/models, which reflects the backend's allow-list and Vertex enabled models.
 */
const FALLBACK_MODELS = [
  {label: "Gemini 3.8 Flash", value: "gemini-3.8-flash"},
  {label: "Gemini 3.5 Flash Lite", value: "gemini-3.5-flash-lite"},
  {label: "Gemini 3.1 Pro", value: "gemini-3.1-pro-preview"},
  {label: "Gemini 3 Pro Image", value: "gemini-3-pro-image"},
];

/** Default selection — a balanced model that matches the example backend's default. */
const DEFAULT_MODEL_VALUE = "gemini-3.8-flash";

/** RTK Query cache key for the default gpt histories list (must match useGetGptHistoriesQuery). */
const gptHistoriesListQueryArgs = {};

const STALE_ASK_DETAIL = "This question is no longer waiting for an answer.";

const GPT_MASCOT_IMAGES: ImageSourcePropType[] = [
  require("../../assets/gptMascots/mascot-1.png"),
  require("../../assets/gptMascots/mascot-2.png"),
  require("../../assets/gptMascots/mascot-3.png"),
  require("../../assets/gptMascots/mascot-4.png"),
];

const AiScreen: React.FC = () => {
  const [currentHistoryId, setCurrentHistoryId] = useState<string | undefined>(undefined);
  // Remember the open chat so a reload can reopen it and re-attach to an in-flight reply
  const [storedHistoryId, setStoredHistoryId, isStoredHistoryIdLoading] = useStoredState<
    string | undefined
  >("gptCurrentHistoryId", undefined);
  const hasRestoredHistoryRef = useRef(false);
  const resumeAbortRef = useRef<AbortController | null>(null);
  const [currentMessages, setCurrentMessages] = useState<GPTChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [askErrors, setAskErrors] = useState<AskErrors>({});
  // Bumped when a turn starts or another conversation opens, so a late reload of the saved
  // conversation never replaces newer messages.
  const transcriptVersionRef = useRef(0);
  // The conversation each streamed ask waits in, so it can be answered before `{done}` arrives.
  const askHistoryIdsRef = useRef(new Map<string, string>());
  const [geminiApiKey, setGeminiApiKey] = useStoredState<string>("geminiApiKey", "");
  const [attachments, setAttachments] = useState<SelectedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_VALUE);
  const [mascotIndex] = useState<number>(() => selectGptMascotIndex(Math.random()));
  const [postFilesUpload] = usePostFilesUploadMutation();
  const [postGptActions] = usePostGptActionsMutation();
  const [fetchDataset] = openapi.useLazyGetGptDatasetsByIdQuery();
  // Uploads each file picked for a `files` ask; without a GCS bucket the server has no file
  // routes, and the resolver sends data URLs instead.
  const resolveAskFiles = useMemo(
    () =>
      createAskFilesResolver({
        upload: createAskFileUploader({
          send: async (file) => postFilesUpload(await uploadFormData(file)),
        }),
      }),
    [postFilesUpload]
  );

  const mascot = useMemo(
    (): React.ReactElement => (
      <Box alignItems="center" gap={3} testID="example-gpt-mascot">
        <RNImage
          accessibilityLabel="Terreno plant robot mascot"
          resizeMode="cover"
          source={GPT_MASCOT_IMAGES[mascotIndex]}
          style={{borderRadius: 112, height: 224, width: 224}}
          testID={`example-gpt-mascot-${mascotIndex + 1}`}
        />
        <Heading align="center" size="md">
          Ask anything about Terreno.
        </Heading>
      </Box>
    ),
    [mascotIndex]
  );

  const dispatch = useAppDispatch();
  const userId = useSelector(selectBetterAuthUserId);
  const {flags, isLoading: isFlagsLoading} = useFeatureFlags(terrenoApi, {skip: !userId, userId});
  const fileUploadsEnabled = fileUploadsEnabledFromFlags({flags, isLoading: isFlagsLoading});

  // Drop staged files when an admin turns the file-uploads flag off.
  useEffect(() => {
    if (!fileUploadsEnabled) {
      setAttachments([]);
    }
  }, [fileUploadsEnabled]);

  const {data: modelsData} = useGetAiModelsQuery(undefined, {skip: !userId});

  // Prefer the live model list from the backend; fall back to the static list until it loads.
  const availableModels = useMemo(
    () => (modelsData?.models?.length ? modelsData.models : FALLBACK_MODELS),
    [modelsData]
  );
  const {data: historiesData, isLoading} = useGetGptHistoriesQuery(gptHistoriesListQueryArgs, {
    skip: !userId,
  });
  const {tools: mcpToolsRaw} = useMCPTools();
  const mcpTools: MCPToolDetail[] = useMemo(
    () => mcpToolsRaw.map((t) => ({description: t.description, name: t.name})),
    [mcpToolsRaw]
  );
  const [deleteHistory] = useDeleteGptHistoriesByIdMutation();
  const [patchHistory] = usePatchGptHistoriesByIdMutation();

  const histories: GPTChatHistory[] = (historiesData?.data ?? []).map(mapHistoryToChat);

  const upsertSidebarHistory = useCallback(
    (historyId: string, title?: string) => {
      dispatch(
        terrenoApi.util.updateQueryData(
          "getGptHistories" as never,
          gptHistoriesListQueryArgs as never,
          (draft: {data?: GptHistory[]}) => {
            const entry = draft.data?.find((h: GptHistory) => h.id === historyId);
            if (entry) {
              if (title) {
                entry.title = title;
              }
              return;
            }
            if (!draft.data) {
              draft.data = [];
            }
            // New conversation — add it to the sidebar immediately
            draft.data.unshift({
              _id: historyId,
              created: DateTime.now().toISO() ?? "",
              id: historyId,
              prompts: [],
              title: title ?? "New Chat",
              updated: DateTime.now().toISO() ?? "",
              userId: "",
            });
          }
        )
      );
    },
    [dispatch]
  );

  /** Build a handler that applies stream events to the open chat, starting from `initialText`. */
  const createStreamEventHandler = useCallback(
    (initialText: string) => {
      let assistantText = initialText;
      const setAssistantText = (text: string): void => {
        assistantText = text;
        setCurrentMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          // Update existing assistant message or create one
          if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
            updated[lastIdx] = {...updated[lastIdx], content: text};
          } else {
            updated.push({content: text, role: "assistant"});
          }
          return updated;
        });
      };

      return (data: GptStreamEvent): void => {
        if (data.started && data.historyId) {
          // The backend saved the turn before streaming; a reload can now resume it
          setCurrentHistoryId(data.historyId);
          upsertSidebarHistory(data.historyId);
        } else if (data.replace && typeof data.text === "string") {
          setAssistantText(data.text);
        } else if (data.text) {
          setAssistantText(assistantText + data.text);
        } else if (data.toolCall) {
          const toolCall = data.toolCall;
          setCurrentMessages((prev) => [
            ...prev,
            {content: `Tool call: ${toolCall.toolName}`, role: "tool-call", toolCall},
          ]);
          // Add a new empty assistant message for continued text after tool results
          assistantText = "";
          setCurrentMessages((prev) => [...prev, {content: "", role: "assistant"}]);
        } else if (data.toolResult) {
          const toolResult = data.toolResult;
          // Insert tool result before the last empty assistant message
          setCurrentMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (
              lastIdx >= 0 &&
              updated[lastIdx].role === "assistant" &&
              !updated[lastIdx].content
            ) {
              updated.splice(lastIdx, 0, {
                content: `Tool result: ${toolResult.toolName}`,
                role: "tool-result",
                toolResult,
              });
            }
            return updated;
          });
        } else if (data.image || data.file) {
          const part: MessageContentPart = data.image
            ? {mimeType: data.image.mimeType, type: "image", url: data.image.url}
            : {
                filename: data.file?.filename,
                mimeType: data.file?.mimeType ?? "",
                type: data.file?.mimeType?.startsWith("image/") ? "image" : "file",
                url: data.file?.url ?? "",
              };
          setCurrentMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
              const existing = updated[lastIdx].contentParts ?? [];
              updated[lastIdx] = {...updated[lastIdx], contentParts: [...existing, part]};
            } else {
              updated.push({content: "", contentParts: [part], role: "assistant"});
            }
            return updated;
          });
        } else if (data.done) {
          // Clean up trailing empty assistant messages
          setCurrentMessages((prev) =>
            prev.filter(
              (m) =>
                m.content || (m.contentParts && m.contentParts.length > 0) || m.role !== "assistant"
            )
          );
          if (data.historyId) {
            setCurrentHistoryId(data.historyId);
            // Update sidebar locally (backend already persisted it)
            upsertSidebarHistory(data.historyId, data.title);
          }
        } else if (data.error) {
          console.error("SSE error:", data.error);
          setCurrentMessages((prev) => [
            ...prev.filter((m) => m.content || m.role !== "assistant"),
            {content: `Error: ${data.error}`, role: "assistant"},
          ]);
        }
      };
    },
    [upsertSidebarHistory]
  );

  const stopResume = useCallback(() => {
    resumeAbortRef.current?.abort();
    resumeAbortRef.current = null;
  }, []);

  /** Re-attach to a reply another page load started, continuing after `partialText`. */
  const resumeStream = useCallback(
    async (historyId: string, partialText: string) => {
      stopResume();
      const controller = new AbortController();
      resumeAbortRef.current = controller;
      setIsStreaming(true);
      try {
        const token = await getSessionToken();
        const response = await fetch(
          `${baseUrl}/gpt/histories/${historyId}/stream?offset=${partialText.length}`,
          {headers: {Authorization: `Bearer ${token}`}, signal: controller.signal}
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        await readSseEvents(response, createStreamEventHandler(partialText));
        // Pick up the final stored reply for later visits to this chat
        dispatch(terrenoApi.util.invalidateTags([{id: "LIST", type: "gptHistories"}]));
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Error resuming reply:", err);
        }
      } finally {
        if (resumeAbortRef.current === controller) {
          resumeAbortRef.current = null;
          setIsStreaming(false);
        }
      }
    },
    [createStreamEventHandler, dispatch, stopResume]
  );

  const handleSelectHistory = useCallback(
    (id: string) => {
      const history = histories.find((h) => h.id === id);
      if (!history) {
        return;
      }
      stopResume();
      transcriptVersionRef.current += 1;
      setIsStreaming(false);
      setCurrentHistoryId(id);
      setCurrentMessages(history.prompts);
      const streamingReply = findStreamingReply(historiesData?.data?.find((h) => h.id === id));
      if (streamingReply) {
        void resumeStream(id, streamingReply.text);
      }
    },
    [histories, historiesData, resumeStream, stopResume]
  );

  const handleCreateHistory = useCallback(() => {
    stopResume();
    transcriptVersionRef.current += 1;
    setIsStreaming(false);
    setCurrentHistoryId(undefined);
    setCurrentMessages([]);
  }, [stopResume]);

  // Reopen the chat that was open before a reload, once the stored id and histories are loaded
  useEffect(() => {
    if (!userId || hasRestoredHistoryRef.current || isStoredHistoryIdLoading || isLoading) {
      return;
    }
    hasRestoredHistoryRef.current = true;
    if (storedHistoryId) {
      handleSelectHistory(storedHistoryId);
    }
  }, [handleSelectHistory, isLoading, isStoredHistoryIdLoading, storedHistoryId, userId]);

  // Persist the open chat id after the restore above has run
  useEffect(() => {
    if (!userId || !hasRestoredHistoryRef.current) {
      return;
    }
    void setStoredHistoryId(currentHistoryId);
  }, [currentHistoryId, setStoredHistoryId, userId]);

  // Stop following a resumed reply when leaving the screen
  useEffect(() => stopResume, [stopResume]);

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      try {
        await deleteHistory({id}).unwrap();
        if (currentHistoryId === id) {
          stopResume();
          setIsStreaming(false);
          setCurrentHistoryId(undefined);
          setCurrentMessages([]);
        }
      } catch (err) {
        console.error("Error deleting history:", err);
      }
    },
    [deleteHistory, currentHistoryId, stopResume]
  );

  const handleUpdateTitle = useCallback(
    async (id: string, title: string) => {
      try {
        await patchHistory({body: {title}, id}).unwrap();
      } catch (err) {
        console.error("Error updating history title:", err);
      }
    },
    [patchHistory]
  );

  const handleAttachFiles = useCallback((files: SelectedFile[]) => {
    setAttachments((prev) => [...prev, ...files]);
  }, []);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleRateFeedback = useCallback(
    async (promptIndex: number, rating: "up" | "down" | null) => {
      if (!currentHistoryId) {
        return;
      }
      try {
        const token = await getSessionToken();
        await fetch(`${baseUrl}/gpt/histories/${currentHistoryId}/rating`, {
          body: JSON.stringify({promptIndex, rating}),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "PATCH",
        });
        // Update local state
        setCurrentMessages((prev) => {
          const updated = [...prev];
          if (promptIndex < updated.length) {
            updated[promptIndex] = {
              ...updated[promptIndex],
              rating: rating ?? undefined,
            };
          }
          return updated;
        });
      } catch (err) {
        console.error("Error rating message:", err);
      }
    },
    [currentHistoryId]
  );

  /** Replaces the transcript with the saved conversation, for turns whose stream left rows out. */
  const syncConversation = useCallback(
    async (historyId: string): Promise<void> => {
      const version = transcriptVersionRef.current;
      try {
        const history = await dispatch(
          terrenoApi.endpoints.getGptHistoriesById.initiate(
            {id: historyId},
            {forceRefetch: true, subscribe: false}
          )
        ).unwrap();
        if (transcriptVersionRef.current === version) {
          setCurrentMessages(mapHistoryToChat(history).prompts);
        }
      } catch (err) {
        console.warn("Could not reload the conversation:", err);
      }
    },
    [dispatch]
  );

  /** The sidebar cache holds each conversation's rows; refetch it after a turn changes them. */
  const refreshHistories = useCallback((): void => {
    dispatch(
      terrenoApi.endpoints.getGptHistories.initiate(gptHistoriesListQueryArgs, {
        forceRefetch: true,
        subscribe: false,
      })
    );
  }, [dispatch]);

  /**
   * Sends one turn to /gpt/prompt, either a new prompt or an answer to the pending ask, and applies
   * its SSE events to the transcript. An answer that fails validation and an ask that is no longer
   * pending come back as outcomes instead of errors.
   */
  const runTurn = useCallback(
    async ({body, pendingAskId: askBeforeTurn, submitted}: TurnRequest): Promise<TurnOutcome> => {
      const token = await getSessionToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (geminiApiKey) {
        headers["x-ai-api-key"] = geminiApiKey;
      }
      const response = await fetch(`${baseUrl}/gpt/prompt`, {
        body: JSON.stringify(body),
        headers,
        method: "POST",
      });

      if (response.status === 400 && submitted) {
        const fields = askErrorsFromBody(await readJson(response));
        if (!fields) {
          throw new Error("HTTP 400");
        }
        return {fields, kind: "invalidAnswer"};
      }
      if (response.status === 409) {
        const detail = errorDetailFromBody(await readJson(response));
        return {detail: detail ?? STALE_ASK_DETAIL, kind: "conflict"};
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let assistantText = "";
      let buffer = "";
      let finishedHistoryId: string | undefined;
      let pendingAskId: string | undefined;
      let hasAskEvents = false;
      let hasVisibleEvents = false;
      const streamedAskIds = new Set<string>();
      const resolvedAskIds = new Set<string>();

      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split("\n");
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) {
            continue;
          }

          try {
            const data = JSON.parse(trimmed.slice(6));

            if (data.replace === "text" && typeof data.text === "string") {
              hasVisibleEvents = true;
              assistantText = data.text;
              const updatedText = assistantText;
              setCurrentMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                  updated[lastIdx] = {...updated[lastIdx], content: updatedText};
                } else {
                  updated.push({content: updatedText, role: "assistant"});
                }
                return updated;
              });
            } else if (data.text) {
              hasVisibleEvents = true;
              assistantText += data.text;
              const updatedText = assistantText;
              setCurrentMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                // Update existing assistant message or create one
                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                  updated[lastIdx] = {...updated[lastIdx], content: updatedText};
                } else {
                  updated.push({content: updatedText, role: "assistant"});
                }
                return updated;
              });
            } else if (data.toolCall) {
              hasVisibleEvents = true;
              setCurrentMessages((prev) => [
                ...prev,
                {
                  content: `Tool call: ${data.toolCall.toolName}`,
                  role: "tool-call",
                  toolCall: data.toolCall,
                },
              ]);
              // Add a new empty assistant message for continued text after tool results
              assistantText = "";
              setCurrentMessages((prev) => [...prev, {content: "", role: "assistant"}]);
            } else if (data.toolResult) {
              hasVisibleEvents = true;
              const {toolResult} = data;
              // Text after a result that lands last starts a new reply instead of repeating the old one.
              assistantText = "";
              setCurrentMessages((prev) => withToolResult({messages: prev, toolResult}));
            } else if (data.ask) {
              hasAskEvents = true;
              hasVisibleEvents = true;
              streamedAskIds.add(data.ask.toolCallId);
              if (typeof data.historyId === "string") {
                askHistoryIdsRef.current.set(data.ask.toolCallId, data.historyId);
              }
              const message = askMessage(data.ask);
              assistantText = "";
              setCurrentMessages((prev) => [...withoutEmptyAssistant(prev), message]);
            } else if (data.askResolved) {
              hasAskEvents = true;
              hasVisibleEvents = true;
              const {action, toolCallId} = data.askResolved;
              resolvedAskIds.add(toolCallId);
              setCurrentMessages((prev) =>
                withResolvedAsk({action, messages: prev, submitted, toolCallId})
              );
            } else if (data.image || data.file) {
              hasVisibleEvents = true;
              const part = data.image
                ? {mimeType: data.image.mimeType, type: "image" as const, url: data.image.url}
                : {
                    filename: data.file.filename,
                    mimeType: data.file.mimeType,
                    type: (typeof data.file.mimeType === "string" &&
                    data.file.mimeType.startsWith("image/")
                      ? "image"
                      : "file") as "image" | "file",
                    url: data.file.url,
                  };
              setCurrentMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                  const existing = updated[lastIdx].contentParts ?? [];
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    contentParts: [...existing, part],
                  };
                } else {
                  updated.push({content: "", contentParts: [part], role: "assistant"});
                }
                return updated;
              });
            } else if (data.blocks) {
              hasVisibleEvents = true;
              const note = data.blocks.ok ? componentCaption(assistantText) : undefined;
              if (note) {
                setCurrentMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                    updated[lastIdx] = {...updated[lastIdx], blockNote: note};
                  }
                  return updated;
                });
              }
            } else if (data.done) {
              finishedHistoryId = data.historyId;
              pendingAskId = data.pendingAsk?.toolCallId;
              // Clean up trailing empty assistant messages
              setCurrentMessages(withoutEmptyAssistant);
              if (data.historyId) {
                setCurrentHistoryId(data.historyId);
              }
              // Update sidebar locally (backend already persisted it)
              if (data.historyId) {
                dispatch(
                  terrenoApi.util.updateQueryData(
                    "getGptHistories" as never,
                    gptHistoriesListQueryArgs as never,
                    (draft: {data?: GptHistory[]}) => {
                      const entry = draft.data?.find((h: GptHistory) => h.id === data.historyId);
                      if (entry) {
                        if (data.title) {
                          entry.title = data.title;
                        }
                      } else {
                        if (!draft.data) {
                          draft.data = [];
                        }
                        // New conversation — add it to the sidebar immediately
                        draft.data.unshift({
                          _id: data.historyId,
                          created: DateTime.now().toISO() ?? "",
                          id: data.historyId,
                          prompts: [],
                          title: data.title ?? "New Chat",
                          updated: DateTime.now().toISO() ?? "",
                          userId: "",
                        });
                      }
                    }
                  )
                );
              }
            } else if (data.error) {
              hasVisibleEvents = true;
              console.error("SSE error:", data.error);
              setCurrentMessages((prev) => [
                ...withoutEmptyAssistant(prev),
                {content: `Error: ${data.error}`, role: "assistant"},
              ]);
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      if (!finishedHistoryId) {
        return {kind: "streamed"};
      }
      // A turn that streams only `{done}` still saved rows, such as an ask the server cancelled
      // because another ask was already pending, so show the saved conversation instead.
      const missedPendingAsk = pendingAskId !== undefined && !streamedAskIds.has(pendingAskId);
      const missedAskResolution = askBeforeTurn !== undefined && !resolvedAskIds.has(askBeforeTurn);
      const isStreamIncomplete = !hasVisibleEvents || missedPendingAsk || missedAskResolution;
      if (isStreamIncomplete) {
        await syncConversation(finishedHistoryId);
      }
      // Reopening this conversation from the sidebar should show its asks as they now stand.
      if (hasAskEvents || isStreamIncomplete) {
        refreshHistories();
      }
      return {kind: "streamed"};
    },
    [dispatch, geminiApiKey, refreshHistories, syncConversation]
  );

  const handleSubmit = useCallback(
    async (prompt: string) => {
      const pendingAskId = currentMessages.find((message) => message.ask?.status === "pending")?.ask
        ?.toolCallId;
      const currentAttachments = fileUploadsEnabled ? [...attachments] : [];
      setAttachments([]);

      // Build content parts for display in the chat from attached files
      const userContentParts: GPTChatMessage["contentParts"] = currentAttachments.map((file) => ({
        filename: file.name,
        mimeType: file.mimeType,
        type: isImageMimeType(file.mimeType) ? ("image" as const) : ("file" as const),
        url: file.uri,
      }));

      const userMessage: GPTChatMessage = {
        content: prompt,
        contentParts: userContentParts.length > 0 ? userContentParts : undefined,
        role: "user",
      };
      transcriptVersionRef.current += 1;
      setCurrentMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);

      try {
        // Convert local file URIs to base64 data URLs for the API
        const apiAttachments = await Promise.all(
          currentAttachments.map(async (file) => {
            const dataUrl = await readFileAsBase64DataUrl(file.uri, file.mimeType);
            return {
              filename: file.name,
              mimeType: file.mimeType,
              type: isImageMimeType(file.mimeType) ? "image" : "file",
              url: dataUrl,
            };
          })
        );

        const outcome = await runTurn({
          body: {
            attachments: apiAttachments.length > 0 ? apiAttachments : undefined,
            historyId: currentHistoryId,
            model: selectedModel,
            prompt,
          },
          pendingAskId,
        });
        if (outcome.kind === "conflict") {
          setCurrentMessages((prev) => [
            ...withoutEmptyAssistant(prev),
            {content: outcome.detail, role: "assistant"},
          ]);
        }
      } catch (err) {
        console.error("Error sending prompt:", err);
        setCurrentMessages((prev) => [
          ...withoutEmptyAssistant(prev),
          {content: "Failed to get response. Please try again.", role: "assistant"},
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [attachments, currentHistoryId, currentMessages, fileUploadsEnabled, runTurn, selectedModel]
  );

  const handleAskSubmit = useCallback(
    async (submission: AskSubmission): Promise<void> => {
      const {response, toolCallId} = submission;
      const historyId = answerHistoryId({
        askHistoryIds: askHistoryIdsRef.current,
        currentHistoryId,
        toolCallId,
      });
      if (!historyId) {
        return;
      }
      transcriptVersionRef.current += 1;
      setAskErrors(({[toolCallId]: _cleared, ...rest}) => rest);
      setIsStreaming(true);

      try {
        const outcome = await runTurn({
          body: {
            askResponse: {...response, toolCallId},
            historyId,
            model: selectedModel,
          },
          submitted: submission,
        });
        if (outcome.kind === "invalidAnswer") {
          setAskErrors((prev) => ({...prev, [toolCallId]: outcome.fields}));
        } else if (outcome.kind === "conflict") {
          // Another tab or device already resolved the ask; show how it ended.
          await syncConversation(historyId);
          refreshHistories();
        }
      } catch (err) {
        console.error("Error answering the question:", err);
        setCurrentMessages((prev) => [
          ...withoutEmptyAssistant(prev),
          {content: "Failed to send your answer. Please try again.", role: "assistant"},
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [currentHistoryId, refreshHistories, runTurn, selectedModel, syncConversation]
  );

  const handleBlockAction = useCallback((event: BlockChatEvent): void => {
    if (event.action.kind !== "open") {
      return;
    }
    if (event.action.route?.startsWith("/")) {
      router.push(event.action.route as Href);
      return;
    }
    if (event.action.url?.startsWith("https://")) {
      void Linking.openURL(event.action.url);
    }
  }, []);

  const handleBlockCallback = useCallback(
    async (event: BlockChatEvent) => {
      if (event.action.kind !== "callback" || !currentHistoryId) {
        return undefined;
      }
      const body = await postGptActions({
        blockId: event.blockId,
        elementId: event.elementId,
        historyId: currentHistoryId,
        messageId: event.messageId,
        name: event.action.name,
        payload: event.action.payload,
      }).unwrap();
      const payload = body as {
        blocks?: BlocksDocument;
        data?: {blocks?: BlocksDocument; replace?: "block"; text?: string};
        replace?: "block";
        text?: string;
      };
      return payload.data ?? payload;
    },
    [currentHistoryId, postGptActions]
  );

  const resolveDataset = useCallback(
    async (ref: {grain?: "day" | "hour" | "month" | "week"; id: string; limit?: number}) => {
      const body = await fetchDataset({
        grain: ref.grain,
        id: ref.id,
        limit: ref.limit,
      }).unwrap();
      const payload = body as {
        columns?: {name: string; type: "date" | "number" | "string"}[];
        data?: {
          columns: {name: string; type: "date" | "number" | "string"}[];
          rows: unknown[][];
        };
        rows?: unknown[][];
      };
      const dataset = payload.data ?? payload;
      if (!dataset.columns || !dataset.rows) {
        return undefined;
      }
      return {columns: dataset.columns, rows: dataset.rows, source: "inline" as const};
    },
    [fetchDataset]
  );

  if (isLoading) {
    return (
      <Box alignItems="center" flex="grow" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  return (
    <GPTChat
      allowHtml
      askErrors={askErrors}
      attachments={fileUploadsEnabled ? attachments : []}
      availableModels={availableModels}
      currentHistoryId={currentHistoryId}
      currentMessages={currentMessages}
      geminiApiKey={geminiApiKey}
      histories={histories}
      hostActions={["exportDataset", "export_csv"]}
      isStreaming={isStreaming}
      mascot={mascot}
      mcpTools={mcpTools}
      onAskSubmit={handleAskSubmit}
      onAttachFiles={fileUploadsEnabled ? handleAttachFiles : undefined}
      onBlockAction={handleBlockAction}
      onBlockCallback={handleBlockCallback}
      onCreateHistory={handleCreateHistory}
      onDeleteHistory={handleDeleteHistory}
      onGeminiApiKeyChange={setGeminiApiKey}
      onModelChange={setSelectedModel}
      onRateFeedback={handleRateFeedback}
      onRemoveAttachment={handleRemoveAttachment}
      onSelectHistory={handleSelectHistory}
      onSubmit={handleSubmit}
      onUpdateTitle={handleUpdateTitle}
      resolveAskFiles={resolveAskFiles}
      resolveDataset={resolveDataset}
      selectedModel={selectedModel}
      suggestedPrompts={[
        "Tell me a dad joke about TypeScript",
        "Make a pun about React hooks",
        "Tell me a witty joke about MongoDB",
        "Help me pick a plan",
        "Archive old chats",
        "Draft an announcement",
        "Fill in the invoice details",
        "Upload a receipt",
      ]}
      testID="chat"
      uiBlocks
    />
  );
};

export default AiScreen;
