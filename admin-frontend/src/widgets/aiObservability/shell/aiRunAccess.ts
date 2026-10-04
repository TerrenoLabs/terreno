export type PlaygroundAiSource = "request-key" | "server" | "unavailable";

const MISSING_API_KEY_ERROR_TITLE =
  "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.";

const DEFAULT_API_KEY_HINT = "Add an AI API key in your app settings, then try again.";

const DEFAULT_FEATURE_LABEL = "Playground";

const backendUnavailableMessage = (featureLabel: string): string => {
  return `${featureLabel} is unavailable. Configure ObservabilityApp.aiService or requestAiServiceFactory on the backend.`;
};

export interface ResolveAiRunBlockedMessageOptions {
  apiKey?: string;
  apiKeyHint?: string;
  apiKeyLoading?: boolean;
  featureLabel?: string;
  playgroundAiSource?: PlaygroundAiSource;
}

/**
 * Explains why an admin AI run cannot start: a missing per-request provider key is the
 * host's problem to fix, while `unavailable` means the backend wired no AI at all.
 */
export const resolveAiRunBlockedMessage = ({
  apiKey,
  apiKeyHint,
  apiKeyLoading,
  featureLabel = DEFAULT_FEATURE_LABEL,
  playgroundAiSource,
}: ResolveAiRunBlockedMessageOptions): string | undefined => {
  if (apiKeyLoading) {
    return undefined;
  }
  if (playgroundAiSource === "request-key" && !apiKey?.trim()) {
    return apiKeyHint ?? DEFAULT_API_KEY_HINT;
  }
  if (playgroundAiSource === "unavailable") {
    return backendUnavailableMessage(featureLabel);
  }
  return undefined;
};

export interface ResolveAiRunErrorOptions {
  apiKey?: string;
  apiKeyHint?: string;
  error: unknown;
  featureLabel?: string;
  playgroundAiSource?: PlaygroundAiSource;
}

const apiErrorTitle = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object" || !("data" in error)) {
    return undefined;
  }
  return (error as {data?: {title?: string}}).data?.title;
};

export const resolveAiRunError = ({
  apiKey,
  apiKeyHint,
  error,
  featureLabel = DEFAULT_FEATURE_LABEL,
  playgroundAiSource,
}: ResolveAiRunErrorOptions): string => {
  const title = apiErrorTitle(error);
  if (
    playgroundAiSource === "request-key" &&
    !apiKey?.trim() &&
    title === MISSING_API_KEY_ERROR_TITLE
  ) {
    return apiKeyHint ?? DEFAULT_API_KEY_HINT;
  }
  if (title) {
    return title;
  }
  return `${featureLabel} run failed. Try again or check your AI configuration.`;
};
