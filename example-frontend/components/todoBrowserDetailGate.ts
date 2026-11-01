/** What the todo detail shows before the body can be trusted. */
export type TodoBrowserDetailPhase = "loading" | "missing" | "ready";

/**
 * A deep link can render before the local store has the row. `useTodo` has no
 * loading flag, so an empty row during startup or an in-flight sync is still
 * loading. It is missing only after sync is up and idle.
 */
export const todoBrowserDetailGate = ({
  hasTodo,
  isSyncDbReady,
  isSyncing,
}: {
  hasTodo: boolean;
  isSyncDbReady: boolean;
  isSyncing: boolean;
}): TodoBrowserDetailPhase => {
  if (hasTodo) {
    return "ready";
  }
  if (!isSyncDbReady || isSyncing) {
    return "loading";
  }
  return "missing";
};
