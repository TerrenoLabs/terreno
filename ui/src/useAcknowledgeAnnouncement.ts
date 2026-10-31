import {useCallback} from "react";

import {buildAnnouncementParams, getAnnouncementPlatform} from "./announcementPlatform";
import {invalidateClientTags, type TerrenoRequestClient, useClientMutation} from "./requestClient";

export interface UseAcknowledgeAnnouncementResult {
  /** Acknowledge an announcement; the pending announcement refetches on success. */
  acknowledge: (announcementId: string) => Promise<void>;
  error: unknown;
  isAcknowledging: boolean;
  isRecordingClick: boolean;
  isRecordingImpression: boolean;
  isSubmitting: boolean;
  /** Record a primary-action click. */
  recordClick: (announcementId: string) => Promise<void>;
  /** Record that the announcement was shown (also dismisses non-acknowledgement ones). */
  recordImpression: (announcementId: string) => Promise<void>;
}

/** Announcement event requests: acknowledge, primary-action click, and impression. */
export const useAcknowledgeAnnouncement = (
  client: TerrenoRequestClient,
  baseUrl?: string
): UseAcknowledgeAnnouncementResult => {
  const base = baseUrl || "";

  const runAcknowledge = useCallback(
    async (announcementId: string): Promise<void> => {
      await client.request({
        method: "POST",
        params: buildAnnouncementParams(),
        url: `${base}/announcements/${announcementId}/acknowledge`,
      });
      invalidateClientTags({client, tags: ["PendingAnnouncements"]});
    },
    [base, client]
  );

  const runClick = useCallback(
    async (announcementId: string): Promise<void> => {
      await client.request({
        body: {action: "primaryAction", platform: getAnnouncementPlatform()},
        method: "POST",
        params: buildAnnouncementParams(),
        url: `${base}/announcements/${announcementId}/click`,
      });
    },
    [base, client]
  );

  const runImpression = useCallback(
    async (announcementId: string): Promise<void> => {
      await client.request({
        body: {platform: getAnnouncementPlatform()},
        method: "POST",
        url: `${base}/announcements/${announcementId}/impression`,
      });
    },
    [base, client]
  );

  const {
    error: acknowledgeError,
    isLoading: isAcknowledging,
    mutate: acknowledge,
  } = useClientMutation({run: runAcknowledge});
  const {
    error: clickError,
    isLoading: isRecordingClick,
    mutate: recordClick,
  } = useClientMutation({run: runClick});
  const {
    error: impressionError,
    isLoading: isRecordingImpression,
    mutate: recordImpression,
  } = useClientMutation({run: runImpression});

  return {
    acknowledge,
    error: acknowledgeError ?? clickError ?? impressionError,
    isAcknowledging,
    isRecordingClick,
    isRecordingImpression,
    isSubmitting: isAcknowledging || isRecordingClick || isRecordingImpression,
    recordClick,
    recordImpression,
  };
};
