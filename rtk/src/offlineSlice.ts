import {createSelector, createSlice, type PayloadAction} from "@reduxjs/toolkit";
import {REHYDRATE} from "redux-persist";

import {IsWeb} from "./platform";

const getInitialOnlineStatus = (): boolean => {
  if (IsWeb && typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
    return navigator.onLine;
  }
  return true;
};

export interface QueuedMutation {
  /** Unique identifier for this queued mutation */
  id: string;
  /** RTK Query endpoint name, e.g. "patchTodosById" */
  endpointName: string;
  /** Original mutation arguments */
  args: unknown;
  /** ISO timestamp of when the mutation was queued */
  timestamp: string;
  /** Document `_updatedAt` at queue time (used for If-Unmodified-Since on replay) */
  baseUpdatedAt?: string;
  /** The type of CRUD operation */
  type: "create" | "update" | "delete";
  /** Auth user ID when the mutation was queued; replay is skipped if it does not match the current user */
  userId?: string;
  /**
   * `false` when `userId` came from a persisted token-source id that no read in this process had
   * confirmed yet. A read that returns a user keeps the mutation (and clears this flag) only when
   * it names the same user and no auth change or source swap happened since; otherwise the
   * mutation is dropped. Absent means confirmed.
   */
  userIdConfirmed?: boolean;
}

export interface ConflictRecord {
  /** Unique identifier for this conflict */
  id: string;
  /** RTK Query endpoint name that caused the conflict */
  endpointName: string;
  /** Original mutation arguments that were rejected */
  args: unknown;
  /** The current server version of the document */
  serverDocument: unknown;
  /** ISO timestamp of when the conflict was detected */
  timestamp: string;
  /** Whether the user has dismissed this conflict notification */
  dismissed: boolean;
}

export interface OfflineState {
  isOnline: boolean;
  queue: QueuedMutation[];
  conflicts: ConflictRecord[];
  isSyncing: boolean;
  /**
   * Last user id confirmed by a non-JWT token source's `getUserId()`. Persisted with the slice so
   * mutations made after an offline launch are tagged with it; cleared on logout and sign-out.
   * Unused on the JWT path, which reads `state.auth.userId`.
   */
  lastUserId?: string;
}

const initialState: OfflineState = {
  conflicts: [],
  isOnline: getInitialOnlineStatus(),
  isSyncing: false,
  queue: [],
};

export const offlineSlice = createSlice({
  extraReducers: (builder) => {
    builder.addCase(REHYDRATE, (state) => {
      state.isSyncing = false;
    });
  },
  initialState,
  name: "offline",
  reducers: {
    addConflict(state, action: PayloadAction<ConflictRecord>) {
      state.conflicts.push(action.payload);
    },
    clearConflicts(state) {
      state.conflicts = [];
    },
    clearQueue(state) {
      state.queue = [];
    },
    dequeue(state, action: PayloadAction<string>) {
      state.queue = state.queue.filter((m) => m.id !== action.payload);
    },
    dismissConflict(state, action: PayloadAction<string>) {
      const conflict = state.conflicts.find((c) => c.id === action.payload);
      if (conflict) {
        conflict.dismissed = true;
      }
    },
    /** Drops mutations tagged with an unconfirmed user id; an auth change left their owner unknown. */
    dropUnconfirmedMutations(state) {
      state.queue = state.queue.filter((m) => m.userIdConfirmed !== false);
    },
    enqueue(state, action: PayloadAction<QueuedMutation>) {
      state.queue.push(action.payload);
    },
    /**
     * Resolves mutations tagged with an unconfirmed user id against the user a read confirmed:
     * matching ones become confirmed, the rest are dropped (never re-tagged).
     */
    resolveUnconfirmedMutations(state, action: PayloadAction<string>) {
      state.queue = state.queue.filter(
        (m) => m.userIdConfirmed !== false || m.userId === action.payload
      );
      for (const mutation of state.queue) {
        delete mutation.userIdConfirmed;
      }
    },
    setLastUserId(state, action: PayloadAction<string | undefined>) {
      state.lastUserId = action.payload;
    },
    setOnlineStatus(state, action: PayloadAction<boolean>) {
      state.isOnline = action.payload;
    },
    setSyncing(state, action: PayloadAction<boolean>) {
      state.isSyncing = action.payload;
    },
  },
});

export const {
  setOnlineStatus,
  enqueue,
  dequeue,
  clearQueue,
  addConflict,
  dismissConflict,
  clearConflicts,
  dropUnconfirmedMutations,
  resolveUnconfirmedMutations,
  setLastUserId,
  setSyncing,
} = offlineSlice.actions;

export const offlineReducer = offlineSlice.reducer;

// Selectors
export const selectIsOnline = (state: {offline: OfflineState}): boolean => state.offline.isOnline;

/** Safe online check when the offline reducer may not be mounted (defaults to online). */
export const selectIsOnlineSafe = (state: {offline?: OfflineState}): boolean =>
  state.offline?.isOnline ?? true;

export const selectOfflineQueue = (state: {offline: OfflineState}): QueuedMutation[] =>
  state.offline.queue;

export const selectQueueLength = (state: {offline: OfflineState}): number =>
  state.offline.queue.length;

export const selectConflicts = (state: {offline: OfflineState}): ConflictRecord[] =>
  state.offline.conflicts;

export const selectUndismissedConflicts = createSelector(
  selectConflicts,
  (conflicts): ConflictRecord[] => conflicts.filter((c) => !c.dismissed)
);

export const selectIsSyncing = (state: {offline: OfflineState}): boolean => state.offline.isSyncing;

/** Last user id a non-JWT token source confirmed; undefined when unknown or signed out. */
export const selectLastUserId = (state: {offline: OfflineState}): string | undefined =>
  state.offline.lastUserId;
