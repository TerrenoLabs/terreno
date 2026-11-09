import type React from "react";
import {useCallback, useEffect, useState} from "react";

import {Badge} from "./Badge";
import {Box} from "./Box";

/** Queued count above which the banner switches to a numeric drain-progress display. */
const PROGRESS_THRESHOLD = 20;

/** Default time connectivity must stay lost before the offline badge appears. */
const DEFAULT_OFFLINE_GRACE_MS = 3000;

export interface SyncStatusBannerProps {
  /** Whether the client currently has connectivity. */
  isOnline: boolean;
  /**
   * How long (ms) `isOnline` must stay false before the offline badge shows. Absorbs the
   * not-yet-connected window at startup and sub-second socket blips so the badge does not
   * flash. Going back online hides it immediately. Defaults to 3000; pass 0 to show at once.
   */
  offlineGraceMs?: number;
  /** Number of mutations waiting in the durable outbox. */
  queuedCount: number;
  /**
   * @deprecated Accepted and ignored. Initial bootstrap syncing is surfaced as a
   * one-shot toast (see SyncHealthToast), not in this banner, and ongoing drain
   * progress is driven by `draining`/`sentThisDrain`/`totalThisDrain`. Passing it
   * has no effect; the prop stays only so existing call sites keep compiling.
   */
  isSyncing?: boolean;
  /** Number of unresolved conflicts. */
  conflictCount: number;
  /**
   * Set when replay is paused pending re-authentication (B4/INV-2). Tapping
   * the paused indicator invokes `onAuthRequired`.
   */
  paused?: "auth";
  /** Count of mutations in the terminal `failed` state (B5). */
  failedCount?: number;
  /** True while a batched drain is actively in flight (B5). */
  draining?: boolean;
  /** Mutations attempted so far in the current (or most recent) drain (B5). */
  sentThisDrain?: number;
  /** Queue length observed when the current (or most recent) drain began (B5). */
  totalThisDrain?: number;
  /** Opens the conflict resolution UI; wired to the pressable conflict badge. */
  onOpenConflicts?: () => void;
  /** Invoked when the paused-for-auth indicator is tapped, to prompt re-login. */
  onAuthRequired?: () => void;
  /** Opens a failed-mutations detail view; wired to the pressable failed badge. */
  onOpenFailed?: () => void;
  testID?: string;
}

/**
 * Compact, presentational sync-state banner for local-first (e.g. @terreno/syncdb) screens:
 * offline indicator (shown only after a short grace period), queued mutation count (with drain progress once the queue grows past
 * {@link PROGRESS_THRESHOLD}), a paused-for-auth indicator, a pressable failed count, and a
 * pressable conflict badge. Initial bootstrap "Syncing…" is intentionally not shown here —
 * apps should surface that as a one-shot toast on launch (see SyncHealthToast). It is
 * intentionally data-driven (no data-layer imports) so it can be reused with any sync store —
 * wire a status hook (such as `useSyncStatus`) to its props in the consuming app.
 */
export const SyncStatusBanner: React.FC<SyncStatusBannerProps> = ({
  isOnline,
  offlineGraceMs = DEFAULT_OFFLINE_GRACE_MS,
  queuedCount,
  isSyncing: _isSyncing,
  conflictCount,
  paused,
  failedCount = 0,
  draining = false,
  sentThisDrain = 0,
  totalThisDrain = 0,
  onOpenConflicts,
  onAuthRequired,
  onOpenFailed,
  testID = "sync-status-banner",
}) => {
  const [isOfflineSettled, setIsOfflineSettled] = useState(!isOnline && offlineGraceMs <= 0);

  // Only surface "Offline" once connectivity has stayed lost for the grace period.
  useEffect(() => {
    if (isOnline) {
      setIsOfflineSettled(false);
      return;
    }
    if (offlineGraceMs <= 0) {
      setIsOfflineSettled(true);
      return;
    }
    const timer = setTimeout(() => setIsOfflineSettled(true), offlineGraceMs);
    return (): void => clearTimeout(timer);
  }, [isOnline, offlineGraceMs]);

  const handleOpenConflicts = useCallback((): void => {
    onOpenConflicts?.();
  }, [onOpenConflicts]);

  const handleAuthRequired = useCallback((): void => {
    onAuthRequired?.();
  }, [onAuthRequired]);

  const handleOpenFailed = useCallback((): void => {
    onOpenFailed?.();
  }, [onOpenFailed]);

  const showProgress = draining && queuedCount > PROGRESS_THRESHOLD && totalThisDrain > 0;

  return (
    <Box direction="row" gap={2} marginBottom={4} minHeight={20} testID={testID} wrap>
      {!isOnline && isOfflineSettled && (
        <Box alignItems="center" direction="row" gap={1} testID="sync-offline-indicator">
          <Badge status="error" value="Offline" />
        </Box>
      )}
      {paused === "auth" && (
        <Box
          accessibilityHint="Sign in again to resume syncing"
          accessibilityLabel="Sync paused, sign in required"
          accessibilityRole="button"
          alignItems="center"
          direction="row"
          gap={1}
          onClick={handleAuthRequired}
          testID="sync-paused-auth-indicator"
        >
          <Badge status="warning" value="Sign in to sync" />
        </Box>
      )}
      {queuedCount > 0 && !showProgress && (
        <Box alignItems="center" direction="row" gap={1} testID="sync-queued-count">
          <Badge status="warning" value={`${queuedCount} queued`} />
        </Box>
      )}
      {showProgress && (
        <Box alignItems="center" direction="row" gap={1} testID="sync-drain-progress">
          <Badge status="warning" value={`Syncing ${sentThisDrain} / ${totalThisDrain}`} />
        </Box>
      )}
      {failedCount > 0 && (
        <Box
          accessibilityHint="Opens the failed sync mutations detail view"
          accessibilityLabel="View failed sync mutations"
          accessibilityRole="button"
          alignItems="center"
          direction="row"
          gap={1}
          onClick={handleOpenFailed}
          testID="sync-failed-badge"
        >
          <Badge status="error" value={`${failedCount} failed`} />
        </Box>
      )}
      {conflictCount > 0 && (
        <Box
          accessibilityHint="Opens the sync conflict resolution sheet"
          accessibilityLabel="View sync conflicts"
          accessibilityRole="button"
          alignItems="center"
          direction="row"
          gap={1}
          onClick={handleOpenConflicts}
          testID="sync-conflict-badge"
        >
          <Badge
            status="error"
            value={`${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`}
          />
        </Box>
      )}
    </Box>
  );
};
