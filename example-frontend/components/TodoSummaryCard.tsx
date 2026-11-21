import type {ApiRequestArgs} from "@terreno/syncdb/api";
import {useApiMutation} from "@terreno/syncdb/react";
import {
  Box,
  Button,
  Card,
  Heading,
  Text,
  ThumbsUpDownFeedback,
  type ThumbsUpDownFeedbackValue,
  useStoredState,
} from "@terreno/ui";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {buildTodoSummaryInput} from "@/components/todoSummaryInput";
import {getAiSessionId} from "@/lib/aiSession";
import {
  type PostAiObservabilityTracesByIdFeedbackArgs,
  postAiExampleSummarizeRequest,
  usePostAiObservabilityTracesByIdFeedbackMutation,
} from "@/store/apiSdk";
import type {Todo} from "@/store/syncDbSdk";
import * as syncDbSdk from "@/store/syncDbSdk";

interface TodoSummaryDependencies {
  /** Puts text on the device clipboard. */
  copyText: (text: string) => Promise<void>;
  useApiKey: () => string | undefined;
  useSummarize: () => readonly [
    (body: {apiKey?: string; text: string}) => {
      unwrap: () => Promise<{output: string; traceId?: string}>;
    },
    {isLoading: boolean},
  ];
  useTodoList: () => {data: Todo[] | undefined};
}

interface TodoSummaryCardProps {
  /** @internal Test seam: replaces any of the hook-backed dependencies. */
  dependencies?: Partial<TodoSummaryDependencies>;
}

const useSavedGeminiApiKey = (): string | undefined => {
  const [geminiApiKey] = useStoredState<string>("geminiApiKey", "");
  return geminiApiKey;
};

interface SummarizeRequest {
  apiKey?: string;
  text: string;
}

interface SummarizeResponse {
  output: string;
  /** Trace of this run; feedback on the summary is recorded against it. */
  traceId?: string;
}

type FeedbackBody = PostAiObservabilityTracesByIdFeedbackArgs["body"];

/**
 * POST /ai/example-summarize with the AI session id and the user's own Gemini key. The generated
 * hook cannot send per-call headers, so this wraps its request builder.
 */
const toSummarizeRequest = ({apiKey, text}: SummarizeRequest): ApiRequestArgs => ({
  ...postAiExampleSummarizeRequest({text}),
  headers: {
    "x-ai-session-id": getAiSessionId(),
    ...(apiKey ? {"x-ai-api-key": apiKey} : {}),
  },
});

const useSummarizeExampleText = (): ReturnType<TodoSummaryDependencies["useSummarize"]> =>
  useApiMutation<SummarizeRequest, SummarizeResponse>(toSummarizeRequest);

const copyToClipboard = async (text: string): Promise<void> => {
  const Clipboard = await import("expo-clipboard");
  await Clipboard.setStringAsync(text);
};

const defaultDependencies: TodoSummaryDependencies = {
  copyText: copyToClipboard,
  useApiKey: useSavedGeminiApiKey,
  useSummarize: useSummarizeExampleText,
  useTodoList: syncDbSdk.useTodos,
};

const errorTitle = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object" || !("data" in error)) {
    return undefined;
  }
  return (error as {data?: {title?: string}}).data?.title;
};

/**
 * Runs the seeded `example-summarize` production prompt over the user's todos. This is the
 * example app's traced AI feature: the backend resolves the prompt by name and label, so every
 * run shows up in AI Observability with a prompt reference, user, and session.
 */
export const TodoSummaryCard: React.FC<TodoSummaryCardProps> = ({dependencies}) => {
  const {copyText, useApiKey, useSummarize, useTodoList} = {
    ...defaultDependencies,
    ...dependencies,
  };
  const {data: todos} = useTodoList();
  const geminiApiKey = useApiKey();
  const [summarize, {isLoading}] = useSummarize();
  const [summary, setSummary] = useState<string>("");
  const [summaryError, setSummaryError] = useState<string>("");
  const [traceId, setTraceId] = useState<string | undefined>(undefined);
  const [thumbs, setThumbs] = useState<ThumbsUpDownFeedbackValue | undefined>(undefined);
  const [sentComment, setSentComment] = useState<string | undefined>(undefined);
  const [isKept, setIsKept] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [sendFeedback] = usePostAiObservabilityTracesByIdFeedbackMutation();

  const summaryInput = useMemo(() => {
    return buildTodoSummaryInput(todos as Todo[]);
  }, [todos]);

  const handleSummarize = useCallback(async (): Promise<void> => {
    setSummaryError("");
    try {
      const result = await summarize({
        apiKey: geminiApiKey || undefined,
        text: summaryInput,
      }).unwrap();
      setSummary(result.output);
      // A new summary is a new trace: its feedback starts fresh.
      setTraceId(result.traceId);
      setThumbs(undefined);
      setSentComment(undefined);
      setIsKept(false);
      setIsDismissed(false);
    } catch (error) {
      console.warn("example-summarize failed", error);
      setSummary("");
      setTraceId(undefined);
      setSummaryError(errorTitle(error) ?? "Could not summarize your todos.");
    }
  }, [geminiApiKey, summarize, summaryInput]);

  // Feedback is best-effort: a failure is logged and never hides the summary.
  const recordFeedback = useCallback(
    async (body: FeedbackBody): Promise<void> => {
      if (!traceId) {
        return;
      }
      try {
        await sendFeedback({body, id: traceId}).unwrap();
      } catch (error) {
        console.warn("Failed to record summary feedback", error);
      }
    },
    [sendFeedback, traceId]
  );

  const handleThumbsChange = useCallback(
    async (value?: ThumbsUpDownFeedbackValue): Promise<void> => {
      setThumbs(value);
      setSentComment(undefined);
      await recordFeedback({
        thumbs: value === undefined ? null : value === "positive" ? "up" : "down",
      });
    },
    [recordFeedback]
  );

  // Re-sends the vote with the comment; the backend keeps one vote per trace.
  const handleCommentSubmit = useCallback(
    async (comment: string): Promise<void> => {
      if (!traceId || !thumbs) {
        return;
      }
      await sendFeedback({
        body: {comment, thumbs: thumbs === "positive" ? "up" : "down"},
        id: traceId,
      }).unwrap();
      setSentComment(comment);
    },
    [sendFeedback, thumbs, traceId]
  );

  const handleKeep = useCallback(async (): Promise<void> => {
    setIsKept(true);
    await recordFeedback({signal: "accepted"});
  }, [recordFeedback]);

  const handleDismiss = useCallback(async (): Promise<void> => {
    setIsDismissed(true);
    await recordFeedback({signal: "dismissed"});
  }, [recordFeedback]);

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await copyText(summary);
    } catch (error) {
      console.warn("Failed to copy summary", error);
      return;
    }
    await recordFeedback({signal: "copied"});
  }, [copyText, recordFeedback, summary]);

  return (
    <Card marginBottom={6} testID="todos-summary-card">
      <Box gap={3}>
        <Heading size="md">Summarize my todos</Heading>
        <Text color="secondaryLight" size="sm">
          Runs the seeded example-summarize production prompt and records a trace in AI
          Observability.
        </Text>
        <Button
          disabled={!summaryInput || isLoading}
          fullWidth
          iconName="wand-magic-sparkles"
          onClick={handleSummarize}
          testID="todos-summarize-button"
          text={isLoading ? "Summarizing…" : "Summarize"}
          variant="secondary"
        />
        {summaryInput ? undefined : (
          <Text color="secondaryLight" size="sm" testID="todos-summary-empty">
            Add a todo to summarize.
          </Text>
        )}
        {summaryError ? (
          <Text color="error" testID="todos-summary-error">
            {summaryError}
          </Text>
        ) : undefined}
        {summary && !isDismissed ? (
          <Box gap={2}>
            <Text testID="todos-summary-output">{summary}</Text>
            <ThumbsUpDownFeedback
              comment={sentComment}
              onChange={handleThumbsChange}
              onCommentSubmit={handleCommentSubmit}
              testID="todos-summary-feedback"
              value={thumbs}
            />
            <Box direction="row" gap={2} wrap>
              <Button
                disabled={isKept}
                iconName={isKept ? "check" : "bookmark"}
                onClick={handleKeep}
                testID="todos-summary-keep"
                text={isKept ? "Kept" : "Keep"}
                variant={isKept ? "primary" : "outline"}
              />
              <Button
                iconName="xmark"
                onClick={handleDismiss}
                testID="todos-summary-dismiss"
                text="Dismiss"
                variant="outline"
              />
              <Button
                iconName="copy"
                onClick={handleCopy}
                testID="todos-summary-copy"
                text="Copy"
                variant="outline"
              />
            </Box>
          </Box>
        ) : undefined}
      </Box>
    </Card>
  );
};
