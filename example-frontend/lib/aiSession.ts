import {randomUUID} from "expo-crypto";

let sessionId: string | undefined;

/**
 * Stable id for every AI call made during this app run. Observability groups traces by
 * `sessionId`, so reusing one id per launch keeps a user's related runs together without
 * persisting anything about them. The id comes from a cryptographically secure source on every
 * platform, so it cannot be guessed from another session's id.
 */
export const getAiSessionId = (): string => {
  if (!sessionId) {
    sessionId = randomUUID();
  }
  return sessionId;
};
