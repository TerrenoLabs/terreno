import * as Sentry from "@sentry/bun";
import axios from "axios";

import {APIError, errorMessage} from "../errors";
import {logger} from "../logger";

/** Slack member IDs are `U…` (users) or `W…` (Enterprise Grid). */
const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{8,}$/i;

const SLACK_LOOKUP_BY_EMAIL_URL = "https://slack.com/api/users.lookupByEmail";

export interface SendToSlackOptions {
  slackChannel?: string;
  shouldThrow?: boolean;
  env?: string;
  url?: string;
  /**
   * Slack member IDs to @-mention. Incoming webhooks only notify when the
   * payload contains `<@U123…>` (or `<@W123…>`). Display names and emails in
   * the message text do not mention anyone.
   */
  mentionUserIds?: string[];
}

export interface LookupSlackUserIdByEmailOptions {
  email: string;
  /** Slack bot token (`xoxb-…`) with `users:read.email`. Defaults to `SLACK_BOT_TOKEN`. */
  token?: string;
  shouldThrow?: boolean;
}

/**
 * Normalize a Slack member ID. Accepts a bare id (`U012ABCDEF`) or a mention
 * token (`<@U012ABCDEF>`). Returns undefined when the value is not a Slack
 * member ID — names and emails cannot be used for mentions.
 */
export const normalizeSlackUserId = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const unwrapped =
    trimmed.startsWith("<@") && trimmed.endsWith(">") ? trimmed.slice(2, -1) : trimmed;
  if (!SLACK_USER_ID_PATTERN.test(unwrapped)) {
    return undefined;
  }
  return unwrapped.toUpperCase();
};

/** Format a Slack member ID as an incoming-webhook mention token. */
export const formatSlackUserMention = (slackUserId: string): string => {
  const id = normalizeSlackUserId(slackUserId);
  if (!id) {
    throw new APIError({
      detail: slackUserId,
      status: 400,
      title: "Invalid Slack user id",
    });
  }
  return `<@${id}>`;
};

const uniqueMentionTokens = (mentionUserIds: string[] | undefined): string[] => {
  if (!mentionUserIds?.length) {
    return [];
  }
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const rawId of mentionUserIds) {
    const id = normalizeSlackUserId(rawId);
    if (!id) {
      logger.warn("Skipping Slack mention; value is not a Slack member id", {value: rawId});
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    tokens.push(`<@${id}>`);
  }
  return tokens;
};

const applyMentions = (text: string, mentionUserIds: string[] | undefined): string => {
  const tokens = uniqueMentionTokens(mentionUserIds);
  if (tokens.length === 0) {
    return text;
  }
  if (!text) {
    return tokens.join(" ");
  }
  return `${tokens.join(" ")} ${text}`;
};

/**
 * Resolve a workspace member's Slack user id from their email.
 *
 * Incoming webhooks cannot look users up. This calls `users.lookupByEmail` and
 * needs a bot token with the `users:read.email` scope. Store the returned id on
 * the staff/user record and pass it to `sendToSlack({mentionUserIds})`.
 */
export const lookupSlackUserIdByEmail = async ({
  email,
  token,
  shouldThrow = false,
}: LookupSlackUserIdByEmailOptions): Promise<string | undefined> => {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    if (shouldThrow) {
      throw new APIError({status: 400, title: "Email is required to look up a Slack user"});
    }
    logger.debug("lookupSlackUserIdByEmail skipped: empty email");
    return undefined;
  }

  const botToken = token ?? process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    if (shouldThrow) {
      throw new APIError({
        status: 500,
        title: "SLACK_BOT_TOKEN is not set; cannot look up Slack user ids",
      });
    }
    logger.debug("lookupSlackUserIdByEmail skipped: no Slack bot token");
    return undefined;
  }

  try {
    const response = await axios.get<{ok: boolean; error?: string; user?: {id?: string}}>(
      SLACK_LOOKUP_BY_EMAIL_URL,
      {
        headers: {Authorization: `Bearer ${botToken}`},
        params: {email: trimmedEmail},
      }
    );
    const payload = response.data;
    if (!payload?.ok || !payload.user?.id) {
      const slackError = payload?.error ?? "unknown_error";
      logger.warn("Slack users.lookupByEmail did not return a user id", {
        email: trimmedEmail,
        slackError,
      });
      if (shouldThrow) {
        throw new APIError({
          detail: slackError,
          status: 502,
          title: "Slack user lookup failed",
        });
      }
      return undefined;
    }
    return normalizeSlackUserId(payload.user.id);
  } catch (error: unknown) {
    if (error instanceof APIError) {
      throw error;
    }
    const message = errorMessage(error);
    logger.error(`Error looking up Slack user by email: ${message}`);
    Sentry.captureException(error);
    if (shouldThrow) {
      throw new APIError({
        status: 500,
        title: `Error looking up Slack user by email: ${message}`,
      });
    }
    return undefined;
  }
};

// Convenience method to send data to a Slack webhook.
// If `url` is provided, it will be used directly instead of looking up from environment.
// DEPRECATED: Looking up webhook URLs from the SLACK_WEBHOOKS environment variable by channel name
// is deprecated and will be removed in a future version. Please pass the `url` parameter directly.
export const sendToSlack = async (
  text: string,
  {slackChannel, shouldThrow = false, env, url, mentionUserIds}: SendToSlackOptions = {}
): Promise<void> => {
  let slackWebhookUrl = url;

  if (!slackWebhookUrl) {
    logger.debug(
      "DEPRECATED: Looking up webhook URLs from SLACK_WEBHOOKS environment variable is deprecated and will be removed in a future version. Please pass the url parameter directly."
    );
    // since Slack now requires a webhook for each channel, we need to store them in the environment
    // as an object, so we can look them up by channel name.
    const slackWebhooksString = process.env.SLACK_WEBHOOKS;
    if (!slackWebhooksString) {
      logger.debug("You must set SLACK_WEBHOOKS in the environment to use sendToSlack.");
      return;
    }
    const slackWebhooks = JSON.parse(slackWebhooksString ?? "{}");

    const channel = slackChannel ?? "default";

    slackWebhookUrl = slackWebhooks[channel] ?? slackWebhooks.default;

    if (!slackWebhookUrl) {
      Sentry.captureException(
        new APIError({
          status: 500,
          title: `No webhook url set in env for ${channel}. Slack message not sent`,
        })
      );
      return;
    }
  }

  let formattedText = applyMentions(text, mentionUserIds);
  if (env) {
    formattedText = `[${env.toUpperCase()}] ${formattedText}`;
  }

  try {
    await axios.post(slackWebhookUrl, {
      text: formattedText,
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    logger.error(`Error posting to slack: ${message}`);
    Sentry.captureException(error);
    if (shouldThrow) {
      throw new APIError({
        status: 500,
        title: `Error posting to slack: ${message}`,
      });
    }
  }
};
