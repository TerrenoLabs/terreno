import {baseUrl, selectBetterAuthUserId, useMCPTools} from "@terreno/rtk";
import {
  type AskSubmission,
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
  useStoredState,
} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useMemo, useRef, useState} from "react";
import {type ImageSourcePropType, Platform, Image as RNImage} from "react-native";
import {useSelector} from "react-redux";
import {getSessionToken} from "@/lib/betterAuth";
import {
  type AskFileUploader,
  answerHistoryId,
  askErrorsFromBody,
  askFromHistoryPrompt,
  askMessage,
  createAskFilesResolver,
  errorDetailFromBody,
  uploadedFileFromBody,
  withoutEmptyAssistant,
  withResolvedAsk,
} from "@/lib/gptAsks";
import {selectGptMascotIndex} from "@/lib/gptMascot";
import {useAppDispatch} from "@/store/index";
import {
  type GptHistory,
  terrenoApi,
  useDeleteGptHistoriesByIdMutation,
  useGetAiModelsQuery,
  useGetGptHistoriesQuery,
  usePatchGptHistoriesByIdMutation,
} from "@/store/sdk";

type AskErrors = NonNullable<GPTChatProps["askErrors"]>;

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
    return {
      ...(ask ? {ask} : {}),
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
      rating: (p as unknown as {rating?: "up" | "down"}).rating,
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

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

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
  if (Platform.OS !== "web") {
    form.append("file", {name: file.name, type: file.mimeType, uri: file.uri} as unknown as Blob);
    return form;
  }
  const blob = await (await fetch(file.uri)).blob();
  form.append("file", new Blob([blob], {type: file.mimeType}), file.name);
  return form;
};

/** Uploads a file picked for a `files` ask; the server has no file routes without a GCS bucket. */
const uploadAskFile: AskFileUploader = async (file) => {
  const token = await getSessionToken();
  const response = await fetch(`${baseUrl}/files/upload`, {
    body: await uploadFormData(file),
    headers: {Authorization: `Bearer ${token}`},
    method: "POST",
  });
  if (response.status === 404) {
    return undefined;
  }
  const body = await readJson(response);
  const uploaded = response.ok ? uploadedFileFromBody(body) : undefined;
  if (!uploaded) {
    throw new Error(errorDetailFromBody(body) ?? `HTTP ${response.status}`);
  }
  return uploaded;
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

const STALE_ASK_DETAIL = "This question is no longer waiting for an answer.";

const GPT_MASCOT_IMAGES: ImageSourcePropType[] = [
  require("../../assets/gptMascots/mascot-1.png"),
  require("../../assets/gptMascots/mascot-2.png"),
  require("../../assets/gptMascots/mascot-3.png"),
  require("../../assets/gptMascots/mascot-4.png"),
];

const AiScreen: React.FC = () => {
  const [currentHistoryId, setCurrentHistoryId] = useState<string | undefined>(undefined);
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
  const resolveAskFiles = useMemo(() => createAskFilesResolver({upload: uploadAskFile}), []);

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

  const handleSelectHistory = useCallback(
    (id: string) => {
      const history = histories.find((h) => h.id === id);
      if (history) {
        transcriptVersionRef.current += 1;
        setCurrentHistoryId(id);
        setCurrentMessages(history.prompts);
      }
    },
    [histories]
  );

  const handleCreateHistory = useCallback(() => {
    transcriptVersionRef.current += 1;
    setCurrentHistoryId(undefined);
    setCurrentMessages([]);
  }, []);

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

            if (data.text) {
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
                    content: `Tool result: ${data.toolResult.toolName}`,
                    role: "tool-result",
                    toolResult: data.toolResult,
                  });
                }
                return updated;
              });
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
    [attachments, currentHistoryId, currentMessages, runTurn, selectedModel]
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

  if (isLoading) {
    return (
      <Box alignItems="center" flex="grow" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  return (
    <GPTChat
      askErrors={askErrors}
      attachments={attachments}
      availableModels={availableModels}
      currentHistoryId={currentHistoryId}
      currentMessages={currentMessages}
      geminiApiKey={geminiApiKey}
      histories={histories}
      isStreaming={isStreaming}
      mascot={mascot}
      mcpTools={mcpTools}
      onAskSubmit={handleAskSubmit}
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
      resolveAskFiles={resolveAskFiles}
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
    />
  );
};

export default AiScreen;
