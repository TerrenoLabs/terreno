import {DateTime} from "luxon";

let sessionId: string | undefined;

const createSessionId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `ai-session-${DateTime.now().toMillis()}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Stable id for every AI call made during this app run. Observability groups traces by
 * `sessionId`, so reusing one id per launch keeps a user's related runs together without
 * persisting anything about them.
 */
export const getAiSessionId = (): string => {
  if (!sessionId) {
    sessionId = createSessionId();
  }
  return sessionId;
};
