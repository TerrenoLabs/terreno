import type React from "react";

import {Banner} from "./Banner";
import {Box} from "./Box";

export interface OfflineBannerProps {
  /** Whether the server is currently reachable */
  isOnline: boolean;
  /** Number of mutations waiting to be synced */
  queueLength: number;
  /** Whether mutations are currently being replayed */
  isSyncing: boolean;
  /** testID for the root element */
  testID?: string;
}

/**
 * Displays offline/syncing status banners. Renders nothing when online and idle.
 *
 * @example
 * ```typescript
 * // useSyncStatus from @terreno/syncdb/react
 * const {isOnline, isSyncing, queuedCount} = useSyncStatus();
 * <OfflineBanner isOnline={isOnline} queueLength={queuedCount} isSyncing={isSyncing} />
 * ```
 */
export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  isOnline,
  queueLength,
  isSyncing,
  testID = "offline-banner",
}) => {
  if (isSyncing) {
    return (
      <Box marginBottom={4} testID={testID}>
        <Banner id="syncing-status" status="info" text="Syncing offline changes..." />
      </Box>
    );
  }

  if (!isOnline) {
    const suffix =
      queueLength > 0
        ? ` ${queueLength} pending change${queueLength !== 1 ? "s" : ""} will sync when you reconnect.`
        : "";

    return (
      <Box marginBottom={4} testID={testID}>
        <Banner id="offline-status" status="warning" text={`You're offline.${suffix}`} />
      </Box>
    );
  }

  return null;
};
