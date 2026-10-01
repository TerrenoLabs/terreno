import {baseUrl, selectBetterAuthUserId, useMCPTools} from "@terreno/rtk";
import {
  Box,
  GPTChat,
  type GPTChatHistory,
  type GPTChatMessage,
  Heading,
  type MCPToolDetail,
  type MessageContentPart,
  type SelectedFile,
  Spinner,
  useStoredState,
} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {type ImageSourcePropType, Image as RNImage} from "react-native";
import {useDispatch, useSelector} from "react-redux";
import {getSessionToken} from "@/lib/betterAuth";
import {selectGptMascotIndex} from "@/lib/gptMascot";
import {
  type GptHistory,
  terrenoApi,
  useDeleteGptHistoriesByIdMutation,
  useGetAiModelsQuery,
  useGetGptHistoriesQuery,
  usePatchGptHistoriesByIdMutation,
} from "@/store/sdk";

const mapHistoryToChat = (history: GptHistory): GPTChatHistory => ({
  id: history.id,
  prompts: history.prompts.map((p) => ({
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
  })),
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
  {label: "Gemini 2.5 Pro", value: "gemini-2.5-pro"},
  {label: "Gemini 2.5 Flash", value: "gemini-2.5-flash"},
  {label: "Gemini 2.5 Flash Lite", value: "gemini-2.5-flash-lite"},
  {label: "Gemini 2.0 Flash", value: "gemini-2.0-flash"},
  {label: "Gemini 2.0 Flash Lite", value: "gemini-2.0-flash-lite"},
];

/** Default selection — a balanced model that matches the example backend's default. */
const DEFAULT_MODEL_VALUE = "gemini-2.5-flash";

/** RTK Query cache key for the default gpt histories list (must match useGetGptHistoriesQuery). */
const gptHistoriesListQueryArgs = {};

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
  const [geminiApiKey, setGeminiApiKey] = useStoredState<string>("geminiApiKey", "");
  const [attachments, setAttachments] = useState<SelectedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_VALUE);
  const [mascotIndex] = useState<number>(() => selectGptMascotIndex(Math.random()));

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

  const dispatch = useDispatch();
  const userId = useSelector(selectBetterAuthUserId);
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
    setIsStreaming(false);
    setCurrentHistoryId(undefined);
    setCurrentMessages([]);
  }, [stopResume]);

  // Reopen the chat that was open before a reload, once the stored id and histories are loaded
  useEffect(() => {
    if (hasRestoredHistoryRef.current || isStoredHistoryIdLoading || isLoading) {
      return;
    }
    hasRestoredHistoryRef.current = true;
    if (storedHistoryId) {
      handleSelectHistory(storedHistoryId);
    }
  }, [handleSelectHistory, isLoading, isStoredHistoryIdLoading, storedHistoryId]);

  // Persist the open chat id after the restore above has run
  useEffect(() => {
    if (!hasRestoredHistoryRef.current) {
      return;
    }
    void setStoredHistoryId(currentHistoryId);
  }, [currentHistoryId, setStoredHistoryId]);

  // Stop following a resumed reply when leaving the screen
  useEffect(() => stopResume, [stopResume]);

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      try {
        await deleteHistory({id}).unwrap();
        if (currentHistoryId === id) {
          setCurrentHistoryId(undefined);
          setCurrentMessages([]);
        }
      } catch (err) {
        console.error("Error deleting history:", err);
      }
    },
    [deleteHistory, currentHistoryId]
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

  const handleSubmit = useCallback(
    async (prompt: string) => {
      const currentAttachments = [...attachments];
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

        const token = await getSessionToken();
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };
        if (geminiApiKey) {
          headers["x-ai-api-key"] = geminiApiKey;
        }
        const response = await fetch(`${baseUrl}/gpt/prompt`, {
          body: JSON.stringify({
            attachments: apiAttachments.length > 0 ? apiAttachments : undefined,
            historyId: currentHistoryId,
            model: selectedModel,
            prompt,
          }),
          headers,
          method: "POST",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await readSseEvents(response, createStreamEventHandler(""));
      } catch (err) {
        console.error("Error sending prompt:", err);
        setCurrentMessages((prev) => [
          ...prev.filter((m) => m.content || m.role !== "assistant"),
          {content: "Failed to get response. Please try again.", role: "assistant"},
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [attachments, createStreamEventHandler, currentHistoryId, geminiApiKey, selectedModel]
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
      attachments={attachments}
      availableModels={availableModels}
      currentHistoryId={currentHistoryId}
      currentMessages={currentMessages}
      geminiApiKey={geminiApiKey}
      histories={histories}
      isStreaming={isStreaming}
      mascot={mascot}
      mcpTools={mcpTools}
      onAttachFiles={handleAttachFiles}
      onCreateHistory={handleCreateHistory}
      onDeleteHistory={handleDeleteHistory}
      onGeminiApiKeyChange={setGeminiApiKey}
      onModelChange={setSelectedModel}
      onRateFeedback={handleRateFeedback}
      onRemoveAttachment={handleRemoveAttachment}
      onSelectHistory={handleSelectHistory}
      onSubmit={handleSubmit}
      onUpdateTitle={handleUpdateTitle}
      selectedModel={selectedModel}
      suggestedPrompts={[
        "Tell me a dad joke about TypeScript",
        "Make a pun about React hooks",
        "Tell me a witty joke about MongoDB",
      ]}
      testID="chat"
    />
  );
};

export default AiScreen;
