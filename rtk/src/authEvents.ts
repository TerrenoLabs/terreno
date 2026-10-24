// Leaf emitter for legacy JWT auth changes (login, logout, token refresh). It backs
// `jwtTokenSource.onAuthChange` without reading Redux state, and imports nothing from rtk so the
// auth slice and the base query can both call it without a cycle.
const listeners = new Set<() => void>();

/** Subscribes to JWT auth changes. Returns an unsubscribe function. */
export const onAuthChange = (callback: () => void): (() => void) => {
  listeners.add(callback);
  return (): void => {
    listeners.delete(callback);
  };
};

/** Notifies every subscriber that the stored JWT changed. A throwing subscriber is skipped. */
export const emitAuthChange = (): void => {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error: unknown) {
      console.warn(
        `[auth] Auth change listener failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
};
