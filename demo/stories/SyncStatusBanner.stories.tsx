import {Box, Heading, SyncStatusBanner} from "@terreno/ui";
import type React from "react";
import {useCallback} from "react";

export const SyncStatusBannerDemo: React.FC = (): React.ReactElement => {
  const onOpenConflicts = useCallback((): void => {}, []);
  return (
    <Box gap={2}>
      <Heading size="sm">Queued + conflicts</Heading>
      <SyncStatusBanner
        conflictCount={2}
        isOnline
        onOpenConflicts={onOpenConflicts}
        queuedCount={4}
      />
    </Box>
  );
};

export const SyncStatusBannerOffline: React.FC = (): React.ReactElement => {
  return <SyncStatusBanner conflictCount={0} isOnline={false} offlineGraceMs={0} queuedCount={1} />;
};

export const SyncStatusBannerOfflineGrace: React.FC = (): React.ReactElement => {
  return (
    <Box gap={2}>
      <Heading size="sm">Offline after the default 3s grace period</Heading>
      <SyncStatusBanner conflictCount={0} isOnline={false} queuedCount={0} />
    </Box>
  );
};
