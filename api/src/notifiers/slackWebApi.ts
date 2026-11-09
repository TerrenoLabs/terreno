import * as Sentry from "@sentry/bun";
import axios, {type AxiosResponse, isAxiosError} from "axios";

import {APIError, errorMessage, isAPIError} from "../errors";
import {logger} from "../logger";
import {normalizeSlackUserId} from "./slackNotifier";

const SLACK_API_URL = "https://slack.com/api";
const MAX_ATTEMPTS = 3;
const MAX_CHANNEL_PAGES = 25;
const INVITE_BATCH_SIZE = 1000;
const CHANNEL_NAME_PATTERN = /^[a-z0-9_-]{1,80}$/;
const CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{8,}$/;

const FATAL_INVITE_ERRORS = new Set([
  "cant_invite",
  "channel_not_found",
  "invalid_auth",
  "is_archived",
  "missing_scope",
  "no_permission",
  "not_authed",
  "not_in_channel",
  "token_revoked",
]);

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
  errors?: {user?: string; error?: string}[];
}

interface SlackChannelObject {
  id?: string;
  name?: string;
  name_normalized?: string;
  is_private?: boolean;
}

interface SlackChannelResponse extends SlackApiResponse {
  channel?: SlackChannelObject;
}

interface SlackMessageResponse extends SlackApiResponse {
  ts?: string;
  channel?: string;
}

interface SlackListResponse extends SlackApiResponse {
  channels?: SlackChannelObject[];
  response_metadata?: {next_cursor?: string};
}

export interface SlackInviteFailure {
  userId: string;
  error: string;
}

export interface SlackInviteResult {
  invitedUserIds: string[];
  alreadyMemberUserIds: string[];
  failures: SlackInviteFailure[];
}

export interface SlackChannelRef {
  channelId: string;
  name: string;
  isPrivate: boolean;
}

export interface CreateSlackPrivateChannelOptions {
  /** Slack channel name: lowercase letters, numbers, hyphens, underscores, max 80. */
  name: string;
  /** Slack member IDs to invite. The bot is already a member because it creates the channel. */
  userIds?: string[];
  initialMessage?: string;
  /** Member IDs to @-mention in `initialMessage`. */
  mentionUserIds?: string[];
  /** Defaults to `SLACK_BOT_TOKEN`. One workspace token for every Terreno app. */
  token?: string;
}

export interface SlackPrivateChannelResult {
  channelId: string;
  name: string;
  invites: SlackInviteResult;
  messageTs?: string;
}

export interface InviteSlackUsersOptions {
  channelId: string;
  userIds: string[];
  token?: string;
}

export interface PostSlackMessageOptions {
  channelId: string;
  text: string;
  blocks?: Record<string, unknown>[];
  mentionUserIds?: string[];
  token?: string;
}

export interface PostSlackMessageResult {
  channelId: string;
  messageTs: string;
}

export interface FindSlackChannelOptions {
  name: string;
  token?: string;
}

/**
 * Slack channel names are lowercase letters, numbers, hyphens, and underscores,
 * at most 80 characters. Leading and trailing whitespace is removed and the
 * value is lowercased. Any other character is rejected.
 */
export const normalizeSlackChannelName = (name: string): string => {
  const normalized = name.trim().toLowerCase();
  const punctuationOnly = /^[_-]+$/u.test(normalized);
  if (!CHANNEL_NAME_PATTERN.test(normalized) || punctuationOnly) {
    throw new APIError({
      code: "slack-channel-name-invalid",
      detail: "Use 1-80 characters: lowercase letters, numbers, hyphens, and underscores.",
      status: 400,
      title: "Invalid Slack channel name",
    });
  }
  return normalized;
};

const requireSlackToken = (token: string | undefined): string => {
  const botToken = token ?? process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new APIError({
      code: "slack-token-missing",
      status: 500,
      title: "SLACK_BOT_TOKEN is not set",
    });
  }
  return botToken;
};

const requireChannelId = (channelId: string): string => {
  const normalized = channelId.trim().toUpperCase();
  if (!CHANNEL_ID_PATTERN.test(normalized)) {
    throw new APIError({
      code: "slack-channel-id-invalid",
      detail: channelId,
      status: 400,
      title: "Invalid Slack channel id",
    });
  }
  return normalized;
};

const partitionUserIds = (
  userIds: string[]
): {validUserIds: string[]; invalidUserIds: string[]} => {
  const validUserIds: string[] = [];
  const invalidUserIds: string[] = [];
  const seen = new Set<string>();
  for (const rawId of userIds) {
    const id = normalizeSlackUserId(rawId);
    if (!id) {
      if (rawId.trim()) {
        invalidUserIds.push(rawId);
      }
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    validUserIds.push(id);
  }
  return {invalidUserIds, validUserIds};
};

const retryAfterMs = (headers: AxiosResponse["headers"] | undefined): number => {
  const retryAfterHeader = "retry-after";
  const raw =
    headers && typeof headers.get === "function"
      ? headers.get(retryAfterHeader)
      : (headers as Record<string, unknown> | undefined)?.[retryAfterHeader];
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 1000;
  }
  return Math.min(seconds * 1000, 2000);
};

const delay = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const slackErrorCode = (data: SlackApiResponse | undefined): string =>
  data?.error ?? "unknown_error";

const throwSlackApiError = (method: string, data: SlackApiResponse | undefined): never => {
  const slackError = slackErrorCode(data);
  logger.warn("Slack Web API returned an error", {method, slackError});
  const status = slackError === "name_taken" ? 409 : 502;
  const title =
    slackError === "name_taken"
      ? "Slack channel name is already taken"
      : "Slack API request failed";
  throw new APIError({
    code: `slack-${slackError.replaceAll("_", "-")}`,
    detail: `${method}: ${slackError}`,
    status,
    title,
  });
};

const isRateLimited = (error: unknown, data?: SlackApiResponse): boolean => {
  if (data?.error === "ratelimited") {
    return true;
  }
  return isAxiosError(error) && error.response?.status === 429;
};

const callSlackApi = async <T extends SlackApiResponse>({
  method,
  body,
  params,
  token,
  acceptApplicationError = false,
}: {
  method: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean>;
  token?: string;
  /** Return an `ok: false` body so the caller can classify per-user invite errors. */
  acceptApplicationError?: boolean;
}): Promise<T> => {
  const botToken = requireSlackToken(token);
  const headers = {Authorization: `Bearer ${botToken}`};
  let lastTransportError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = body
        ? await axios.post<T>(`${SLACK_API_URL}/${method}`, body, {headers})
        : await axios.get<T>(`${SLACK_API_URL}/${method}`, {headers, params});
      const data = response.data;
      if (!data) {
        throwSlackApiError(method, undefined);
      }
      if (data?.error === "ratelimited" && attempt < MAX_ATTEMPTS) {
        await delay(retryAfterMs(response.headers));
        continue;
      }
      if (data?.ok || acceptApplicationError) {
        return data;
      }
      throwSlackApiError(method, data);
    } catch (error: unknown) {
      if (isAPIError(error)) {
        throw error;
      }
      if (isRateLimited(error) && attempt < MAX_ATTEMPTS) {
        const response = isAxiosError(error) ? error.response : undefined;
        await delay(retryAfterMs(response?.headers));
        continue;
      }
      lastTransportError = error;
      break;
    }
  }

  const message = errorMessage(lastTransportError);
  logger.error("Slack Web API transport failed", {message, method});
  Sentry.captureException(lastTransportError);
  throw new APIError({
    code: "slack-transport-failed",
    detail: `${method}: ${message}`,
    status: 502,
    title: "Slack API request failed",
  });
};

const mentionPrefix = (mentionUserIds: string[] | undefined): string => {
  const {validUserIds, invalidUserIds} = partitionUserIds(mentionUserIds ?? []);
  for (const value of invalidUserIds) {
    logger.warn("Skipping Slack mention; value is not a Slack member id", {value});
  }
  return validUserIds.map((id) => `<@${id}>`).join(" ");
};

const inviteBatches = async (
  channelId: string,
  userIds: string[],
  token: string | undefined
): Promise<SlackInviteResult> => {
  const invitedUserIds: string[] = [];
  const alreadyMemberUserIds: string[] = [];
  const failures: SlackInviteFailure[] = [];

  for (let index = 0; index < userIds.length; index += INVITE_BATCH_SIZE) {
    const batch = userIds.slice(index, index + INVITE_BATCH_SIZE);
    const data = await callSlackApi<SlackChannelResponse>({
      acceptApplicationError: true,
      body: {channel: channelId, force: true, users: batch.join(",")},
      method: "conversations.invite",
      token,
    });
    const topLevelError = data.error ?? "";
    if (!data.ok && FATAL_INVITE_ERRORS.has(topLevelError) && !data.errors?.length) {
      throwSlackApiError("conversations.invite", data);
    }
    if (!data.ok && topLevelError === "already_in_channel" && !data.errors?.length) {
      alreadyMemberUserIds.push(...batch);
      continue;
    }
    if (!data.ok && !data.errors?.length) {
      throwSlackApiError("conversations.invite", data);
    }

    if (!data.errors?.length) {
      invitedUserIds.push(...batch);
      continue;
    }

    const accounted = new Set<string>();
    for (const entry of data.errors) {
      const userId = entry.user ? normalizeSlackUserId(entry.user) : undefined;
      if (!userId) {
        continue;
      }
      accounted.add(userId);
      if (entry.error === "already_in_channel") {
        alreadyMemberUserIds.push(userId);
      } else {
        failures.push({error: entry.error ?? "unknown_error", userId});
      }
    }
    if (data.ok) {
      invitedUserIds.push(...batch.filter((id) => !accounted.has(id)));
    }
  }

  return {alreadyMemberUserIds, failures, invitedUserIds};
};

/**
 * Create a private channel in the workspace for `SLACK_BOT_TOKEN`, invite
 * members, and optionally post the first message.
 *
 * Requires bot scopes `groups:write`, `groups:write.invites`, and `chat:write`.
 * `name_taken` throws a 409. Call `findSlackChannelByName` to reuse a channel
 * the bot can already see.
 */
export const createSlackPrivateChannel = async ({
  name,
  userIds = [],
  initialMessage,
  mentionUserIds,
  token,
}: CreateSlackPrivateChannelOptions): Promise<SlackPrivateChannelResult> => {
  const channelName = normalizeSlackChannelName(name);
  const {validUserIds, invalidUserIds} = partitionUserIds(userIds);
  if (userIds.length > 0 && validUserIds.length === 0) {
    throw new APIError({
      code: "slack-user-id-invalid",
      status: 400,
      title: "Slack invite requires member ids",
    });
  }
  for (const value of invalidUserIds) {
    logger.warn("Skipping Slack invite; value is not a Slack member id", {value});
  }

  const created = await callSlackApi<SlackChannelResponse>({
    body: {is_private: true, name: channelName},
    method: "conversations.create",
    token,
  });
  const channelId = created.channel?.id?.toUpperCase();
  if (!channelId) {
    throw new APIError({
      code: "slack-channel-missing",
      detail: "conversations.create",
      status: 502,
      title: "Slack API request failed",
    });
  }

  let invites: SlackInviteResult = {
    alreadyMemberUserIds: [],
    failures: invalidUserIds.map((value) => ({error: "invalid_user_id", userId: value})),
    invitedUserIds: [],
  };
  if (validUserIds.length > 0) {
    try {
      const invited = await inviteBatches(channelId, validUserIds, token);
      invites = {
        ...invited,
        failures: [...invites.failures, ...invited.failures],
      };
    } catch (error: unknown) {
      if (!isAPIError(error)) {
        throw error;
      }
      throw new APIError({
        code: error.code,
        detail: error.detail,
        meta: {channelId, channelName},
        status: error.status,
        title: error.title,
      });
    }
  }

  const text = initialMessage?.trim();
  if (!text && !mentionUserIds?.length) {
    return {channelId, invites, name: created.channel?.name ?? channelName};
  }

  try {
    const posted = await postSlackMessage({
      channelId,
      mentionUserIds,
      text: text ?? "",
      token,
    });
    return {
      channelId,
      invites,
      messageTs: posted.messageTs,
      name: created.channel?.name ?? channelName,
    };
  } catch (error: unknown) {
    if (!isAPIError(error)) {
      throw error;
    }
    throw new APIError({
      code: "slack-initial-message-failed",
      detail: error.detail,
      meta: {channelId, channelName},
      status: error.status,
      title: "Slack initial message failed",
    });
  }
};

/**
 * Invite staff to a channel the bot already belongs to. Private channels do
 * not allow a bot to join itself; invite the app once, then call this.
 *
 * `groups:write.invites` covers private channels. `channels:write.invites`
 * covers public channels. Member IDs that are already in the channel are
 * reported on `alreadyMemberUserIds` and do not fail the call.
 */
export const inviteSlackUsersToChannel = async ({
  channelId,
  userIds,
  token,
}: InviteSlackUsersOptions): Promise<SlackInviteResult> => {
  const normalizedChannelId = requireChannelId(channelId);
  const {validUserIds, invalidUserIds} = partitionUserIds(userIds);
  if (validUserIds.length === 0) {
    throw new APIError({
      code: "slack-user-id-invalid",
      status: 400,
      title: "Slack invite requires member ids",
    });
  }
  const invited = await inviteBatches(normalizedChannelId, validUserIds, token);
  return {
    ...invited,
    failures: [
      ...invalidUserIds.map((value) => ({error: "invalid_user_id", userId: value})),
      ...invited.failures,
    ],
  };
};

/** Post as the bot with `chat:write`. The bot must already be in the channel. */
export const postSlackMessage = async ({
  channelId,
  text,
  blocks,
  mentionUserIds,
  token,
}: PostSlackMessageOptions): Promise<PostSlackMessageResult> => {
  const normalizedChannelId = requireChannelId(channelId);
  const prefix = mentionPrefix(mentionUserIds);
  const body = text.trim();
  if (!prefix && !body) {
    throw new APIError({
      code: "slack-message-empty",
      status: 400,
      title: "Slack message text is required",
    });
  }
  const payload: Record<string, unknown> = {
    channel: normalizedChannelId,
    text: prefix && body ? `${prefix} ${body}` : prefix || body,
  };
  if (blocks) {
    payload.blocks = blocks;
  }
  const posted = await callSlackApi<SlackMessageResponse>({
    body: payload,
    method: "chat.postMessage",
    token,
  });
  if (!posted.ts) {
    throw new APIError({
      code: "slack-message-missing",
      detail: "chat.postMessage",
      status: 502,
      title: "Slack API request failed",
    });
  }
  return {channelId: normalizedChannelId, messageTs: posted.ts};
};

/**
 * Find a public channel, or a private channel the bot is already in.
 * Returns undefined when the name is not visible to the bot. Archived
 * channels are skipped. Requires `channels:read` and `groups:read`.
 */
export const findSlackChannelByName = async ({
  name,
  token,
}: FindSlackChannelOptions): Promise<SlackChannelRef | undefined> => {
  const channelName = normalizeSlackChannelName(name);
  let cursor = "";

  for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
    const listed = await callSlackApi<SlackListResponse>({
      method: "conversations.list",
      params: {
        cursor,
        exclude_archived: true,
        limit: 200,
        types: "public_channel,private_channel",
      },
      token,
    });
    const match = listed.channels?.find((channel) => {
      const candidate = (channel.name_normalized ?? channel.name ?? "").toLowerCase();
      return candidate === channelName && Boolean(channel.id);
    });
    if (match?.id) {
      return {
        channelId: match.id.toUpperCase(),
        isPrivate: Boolean(match.is_private),
        name: match.name ?? channelName,
      };
    }
    cursor = listed.response_metadata?.next_cursor ?? "";
    if (!cursor) {
      return undefined;
    }
  }

  return undefined;
};
