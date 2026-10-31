import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Linking} from "react-native";

import {AnnouncementBanner} from "./AnnouncementBanner";
import {AnnouncementScreen} from "./AnnouncementScreen";
import {
  type AnnouncementFrequencyConfig,
  recordInterruptShown,
  resolveFrequencyConfig,
  shouldSuppressInterrupt,
} from "./announcementFrequency";
import {Box} from "./Box";
import {Button} from "./Button";
import type {TerrenoRequestClient} from "./requestClient";
import {Spinner} from "./Spinner";
import {Text} from "./Text";
import {useAcknowledgeAnnouncement} from "./useAcknowledgeAnnouncement";
import {useAnnouncements} from "./useAnnouncements";

export type {AnnouncementFrequencyConfig} from "./announcementFrequency";

interface AnnouncementNavigatorProps {
  /**
   * Request client for the announcement routes, usually the app's `@terreno/syncdb/api`
   * client (`createApiClient(...)`). Any object with a matching `request` method works.
   */
  client: TerrenoRequestClient;
  /** Path prefixed to the announcement routes (for example `/api`); defaults to none. */
  baseUrl?: string;
  children: React.ReactNode;
  frequency?: AnnouncementFrequencyConfig;
  onError?: (error: unknown) => void;
}

export const AnnouncementNavigator: React.FC<AnnouncementNavigatorProps> = ({
  client,
  baseUrl,
  children,
  frequency,
  onError,
}) => {
  const {pending, isLoading, error, refetch} = useAnnouncements(client, baseUrl);
  const {acknowledge, recordClick, recordImpression, isSubmitting} = useAcknowledgeAnnouncement(
    client,
    baseUrl
  );

  const cooldownHours = frequency?.cooldownHours;
  const maxInterruptionsPerSession = frequency?.maxInterruptionsPerSession;
  const skipFirstLaunch = frequency?.skipFirstLaunch;
  const frequencyUserId = frequency?.userId;

  const frequencyConfig = useMemo(
    () =>
      resolveFrequencyConfig({
        cooldownHours,
        maxInterruptionsPerSession,
        skipFirstLaunch,
        userId: frequencyUserId,
      }),
    [cooldownHours, frequencyUserId, maxInterruptionsPerSession, skipFirstLaunch]
  );

  const rawCurrent = pending?.current ?? null;
  const current = rawCurrent?.displayMode === "feed" ? null : rawCurrent;
  const currentAnnouncementId = current?.id;
  const currentAnnouncementVersion = current?.version;
  const impressionKey =
    currentAnnouncementId && currentAnnouncementVersion !== undefined
      ? `${currentAnnouncementId}:${currentAnnouncementVersion}`
      : null;

  // Frequency result for one impression key. A result for an older key (or none yet) means
  // the current announcement has not been checked, so it stays hidden until it is.
  const [frequencyResult, setFrequencyResult] = useState<{
    key: string;
    suppressed: boolean;
  } | null>(null);
  const isFrequencyChecked = impressionKey !== null && frequencyResult?.key === impressionKey;
  const isFrequencySuppressed = frequencyResult?.suppressed ?? false;

  const visibleCurrent = current && isFrequencyChecked && !isFrequencySuppressed ? current : null;
  const displayMode = visibleCurrent?.displayMode ?? "modal";
  const requiresAcknowledgement = visibleCurrent?.requiresAcknowledgement ?? false;
  const recordedImpressionKeysRef = useRef<Set<string>>(new Set());

  const isShowingAnnouncement = !isLoading && !error && Boolean(visibleCurrent);

  // Apply client-side frequency caps before showing an interrupt surface. Keyed on the
  // announcement version so a refetch returning the same announcement is not re-checked.
  useEffect(() => {
    if (!impressionKey) {
      return;
    }

    let cancelled = false;

    const evaluateFrequency = async (): Promise<void> => {
      try {
        const suppressed = await shouldSuppressInterrupt(frequencyConfig, impressionKey);
        if (!cancelled) {
          setFrequencyResult({key: impressionKey, suppressed});
        }
      } catch (frequencyError) {
        console.warn("[AnnouncementNavigator] Frequency check failed; allowing interrupt", {
          frequencyError,
        });
        if (!cancelled) {
          setFrequencyResult({key: impressionKey, suppressed: false});
        }
      }
    };

    void evaluateFrequency();

    return () => {
      cancelled = true;
    };
  }, [frequencyConfig, impressionKey]);

  // Record session/cooldown state once per announcement version when the interrupt is visible.
  useEffect(() => {
    if (!isShowingAnnouncement || !impressionKey) {
      return;
    }

    const recordFrequencyInterrupt = async (): Promise<void> => {
      try {
        await recordInterruptShown(frequencyConfig, impressionKey);
      } catch (frequencyError) {
        console.warn("[AnnouncementNavigator] Failed to record interrupt for frequency", {
          frequencyError,
        });
      }
    };

    void recordFrequencyInterrupt();
  }, [frequencyConfig, impressionKey, isShowingAnnouncement]);

  // Record one impression per announcement version only while the surface is visible.
  useEffect(() => {
    if (
      !isShowingAnnouncement ||
      !currentAnnouncementId ||
      currentAnnouncementVersion === undefined
    ) {
      return;
    }
    if (recordedImpressionKeysRef.current.has(impressionKey ?? "")) {
      return;
    }
    recordedImpressionKeysRef.current.add(impressionKey ?? "");

    const recordCurrentImpression = async (): Promise<void> => {
      try {
        await recordImpression(currentAnnouncementId);
      } catch (impressionError) {
        console.warn("[AnnouncementNavigator] Failed to record impression", {impressionError});
      }
    };

    void recordCurrentImpression();
  }, [
    currentAnnouncementId,
    currentAnnouncementVersion,
    impressionKey,
    isShowingAnnouncement,
    recordImpression,
  ]);

  const handleAcknowledge = useCallback(async (): Promise<void> => {
    if (!currentAnnouncementId) {
      return;
    }
    try {
      if (requiresAcknowledgement) {
        await acknowledge(currentAnnouncementId);
      } else {
        await recordImpression(currentAnnouncementId);
      }
      await refetch();
    } catch (ackError) {
      onError?.(ackError);
    }
  }, [
    acknowledge,
    currentAnnouncementId,
    onError,
    recordImpression,
    refetch,
    requiresAcknowledgement,
  ]);

  const handleDismiss = useCallback(async (): Promise<void> => {
    await handleAcknowledge();
  }, [handleAcknowledge]);

  const handlePrimaryAction = useCallback(async (): Promise<void> => {
    const url = visibleCurrent?.primaryAction?.url;
    if (!url) {
      return;
    }

    if (currentAnnouncementId && visibleCurrent?.primaryAction) {
      try {
        await recordClick(currentAnnouncementId);
      } catch (clickError) {
        console.warn("[AnnouncementNavigator] Failed to record primary-action click", {
          clickError,
        });
      }
    }

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      }
    } catch (linkError) {
      console.warn("[AnnouncementNavigator] Failed to open primary-action URL", {linkError});
    }
  }, [currentAnnouncementId, recordClick, visibleCurrent?.primaryAction]);

  if (isLoading) {
    return (
      <Box
        alignItems="center"
        flex="grow"
        justifyContent="center"
        testID="announcement-navigator-loading"
      >
        <Spinner />
      </Box>
    );
  }

  if (error) {
    const errorObj = error as {status?: number; originalStatus?: number};
    const status = errorObj?.status ?? errorObj?.originalStatus;
    if (status === 401 || status === 403) {
      return <>{children}</>;
    }
    onError?.(error);
    return (
      <Box
        alignItems="center"
        direction="column"
        flex="grow"
        gap={3}
        justifyContent="center"
        padding={6}
        testID="announcement-navigator-error"
      >
        <Text align="center" color="error" size="lg">
          Failed to load announcements
        </Text>
        <Button onClick={refetch} text="Retry" />
      </Box>
    );
  }

  if (visibleCurrent && displayMode === "modal") {
    return (
      <AnnouncementScreen
        announcement={visibleCurrent}
        isSubmitting={isSubmitting}
        onAcknowledge={handleAcknowledge}
        onDismiss={handleDismiss}
        onPrimaryAction={handlePrimaryAction}
        requiresAcknowledgement={requiresAcknowledgement}
      />
    );
  }

  // Keep a stable Box shell for banner and idle states so children are not remounted
  // when the banner is dismissed or when frequency gating finishes showing it.
  return (
    <Box direction="column" flex="grow" width="100%">
      {visibleCurrent && displayMode === "banner" ? (
        <AnnouncementBanner
          announcement={visibleCurrent}
          isSubmitting={isSubmitting}
          onAcknowledge={handleAcknowledge}
          onDismiss={handleDismiss}
          onPrimaryAction={handlePrimaryAction}
          requiresAcknowledgement={requiresAcknowledgement}
        />
      ) : null}
      {children}
    </Box>
  );
};
