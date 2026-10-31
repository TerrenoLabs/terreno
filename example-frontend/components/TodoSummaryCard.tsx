import type {ApiRequestArgs} from "@terreno/syncdb/api";
import {useApiMutation} from "@terreno/syncdb/react";
import {Box, Button, Card, Heading, Text, useStoredState} from "@terreno/ui";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {buildTodoSummaryInput} from "@/components/todoSummaryInput";
import {getAiSessionId} from "@/lib/aiSession";
import {postAiExampleSummarizeRequest} from "@/store/apiSdk";
import type {Todo} from "@/store/syncDbSdk";
import * as syncDbSdk from "@/store/syncDbSdk";

interface TodoSummaryDependencies {
  useApiKey: () => string | undefined;
  useSummarize: () => [
    (body: {apiKey?: string; text: string}) => {
      unwrap: () => Promise<{output: string}>;
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
}

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

const defaultDependencies: TodoSummaryDependencies = {
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
  const {useApiKey, useSummarize, useTodoList} = {...defaultDependencies, ...dependencies};
  const {data: todos} = useTodoList();
  const geminiApiKey = useApiKey();
  const [summarize, {isLoading}] = useSummarize();
  const [summary, setSummary] = useState<string>("");
  const [summaryError, setSummaryError] = useState<string>("");

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
    } catch (error) {
      console.warn("example-summarize failed", error);
      setSummary("");
      setSummaryError(errorTitle(error) ?? "Could not summarize your todos.");
    }
  }, [geminiApiKey, summarize, summaryInput]);

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
        {summary ? <Text testID="todos-summary-output">{summary}</Text> : undefined}
      </Box>
    </Card>
  );
};
