import {useCallback} from "react";

import {buildAnnouncementParams} from "./announcementPlatform";
import {type TerrenoRequestClient, unwrapDataEnvelope, useClientQuery} from "./requestClient";

export type AnnouncementDisplayMode = "banner" | "feed" | "modal";

export interface AnnouncementPublic {
  id: string;
  title: string;
  body: string;
  version: number;
  priority: number;
  displayMode?: AnnouncementDisplayMode;
  requiresAcknowledgement: boolean;
  primaryAction?: {
    label: string;
    url: string;
  };
  publishedAt?: string;
}

export interface PendingAnnouncementsResponse {
  current: AnnouncementPublic | null;
  remainingCount: number;
}

export interface UseAnnouncementsResult {
  /** Error from the pending-announcement request (the feed reports `feedError`). */
  error: unknown;
  feed: AnnouncementPublic[];
  feedError: unknown;
  isFeedLoading: boolean;
  isLoading: boolean;
  isPendingLoading: boolean;
  pending: PendingAnnouncementsResponse | undefined;
  refetch: () => Promise<void>;
  refetchFeed: () => Promise<void>;
}

/**
 * Fetch the current pending announcement (`GET /announcements/pending`) and the
 * announcement feed (`GET /announcements/feed`).
 */
export const useAnnouncements = (
  client: TerrenoRequestClient,
  baseUrl?: string,
  feedOptions?: {page?: number; limit?: number}
): UseAnnouncementsResult => {
  const base = baseUrl || "";
  const page = feedOptions?.page ?? 1;
  const limit = feedOptions?.limit ?? 20;

  const fetchPending = useCallback(async (): Promise<PendingAnnouncementsResponse | undefined> => {
    const result = await client.request<unknown>({
      params: buildAnnouncementParams(),
      url: `${base}/announcements/pending`,
    });
    return unwrapDataEnvelope<PendingAnnouncementsResponse>(result);
  }, [base, client]);

  const fetchFeed = useCallback(async (): Promise<AnnouncementPublic[]> => {
    const result = await client.request<AnnouncementPublic[] | {data?: AnnouncementPublic[]}>({
      params: {limit, page, ...buildAnnouncementParams()},
      url: `${base}/announcements/feed`,
    });
    return Array.isArray(result) ? result : (result?.data ?? []);
  }, [base, client, limit, page]);

  const {
    data: pending,
    error,
    isLoading: isPendingLoading,
    refetch,
  } = useClientQuery({client, fetcher: fetchPending, providesTag: "PendingAnnouncements"});
  const {
    data: feed,
    error: feedError,
    isLoading: isFeedLoading,
    refetch: refetchFeed,
  } = useClientQuery({client, fetcher: fetchFeed});

  return {
    error,
    feed: feed ?? [],
    feedError,
    isFeedLoading,
    isLoading: isPendingLoading,
    isPendingLoading,
    pending,
    refetch,
    refetchFeed,
  };
};
