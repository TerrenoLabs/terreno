import {afterAll, afterEach, beforeEach, describe, expect, it, type Mock, spyOn} from "bun:test";
import * as Sentry from "@sentry/bun";
import axios from "axios";

import {APIError, isAPIError} from "../errors";
import {
  formatSlackUserMention,
  lookupSlackUserIdByEmail,
  normalizeSlackUserId,
  sendToSlack,
} from "./slackNotifier";

describe("sendToSlack", () => {
  let mockAxiosPost: Mock<typeof axios.post>;

  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    mockAxiosPost = spyOn(axios, "post").mockResolvedValue({status: 200});
    process.env = {...ORIGINAL_ENV};
    process.env.SLACK_WEBHOOKS = undefined;
    (Sentry.captureException as Mock<typeof Sentry.captureException>).mockClear();
    (Sentry.captureMessage as Mock<typeof Sentry.captureMessage>).mockClear();
  });

  afterEach(() => {
    mockAxiosPost.mockRestore();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns early when SLACK_WEBHOOKS is missing", async () => {
    await sendToSlack("hello");
    expect(mockAxiosPost.mock.calls.length).toBe(0);
  });

  it("posts to default webhook with plain text", async () => {
    process.env.SLACK_WEBHOOKS = JSON.stringify({default: "https://slack.example/webhook"});
    mockAxiosPost.mockResolvedValue({status: 200});

    await sendToSlack("hello world");
    expect(mockAxiosPost.mock.calls.length).toBe(1);
    const callArgs = mockAxiosPost.mock.calls[0];
    expect(Array.isArray(callArgs)).toBe(true);
    const [url, payload] = callArgs;
    expect(url).toBe("https://slack.example/webhook");
    expect(payload).toEqual({text: "hello world"});
  });

  it("posts to a specific channel when provided", async () => {
    process.env.SLACK_WEBHOOKS = JSON.stringify({
      default: "https://slack.example/default",
      ops: "https://slack.example/ops",
    });
    mockAxiosPost.mockResolvedValue({status: 200});

    await sendToSlack("ops msg", {slackChannel: "ops"});
    const callArgs = mockAxiosPost.mock.calls[0];
    expect(Array.isArray(callArgs)).toBe(true);
    const [url, payload] = callArgs;
    expect(url).toBe("https://slack.example/ops");
    expect(payload).toEqual({text: "ops msg"});
  });

  it("falls back to default when channel not found", async () => {
    process.env.SLACK_WEBHOOKS = JSON.stringify({
      default: "https://slack.example/default",
    });
    mockAxiosPost.mockResolvedValue({status: 200});

    await sendToSlack("missing channel", {slackChannel: "unknown"});
    const callArgs = mockAxiosPost.mock.calls[0];
    expect(Array.isArray(callArgs)).toBe(true);
    const [url, payload] = callArgs;
    expect(url).toBe("https://slack.example/default");
    expect(payload).toEqual({text: "missing channel"});
  });

  it("prefixes message with [ENV] when env provided", async () => {
    process.env.SLACK_WEBHOOKS = JSON.stringify({
      default: "https://slack.example/default",
    });
    mockAxiosPost.mockResolvedValue({status: 200});

    await sendToSlack("status ok", {env: "stg"});
    const callArgs = mockAxiosPost.mock.calls[0];
    expect(Array.isArray(callArgs)).toBe(true);
    const [, payload] = callArgs;
    expect(payload).toEqual({text: "[STG] status ok"});
  });

  it("reports to Sentry and returns early when channel has no webhook and no default", async () => {
    process.env.SLACK_WEBHOOKS = JSON.stringify({ops: "https://slack.example/ops"});

    await sendToSlack("orphan message", {slackChannel: "alerts"});
    expect(mockAxiosPost.mock.calls.length).toBe(0);
    expect(
      (Sentry.captureException as Mock<typeof Sentry.captureException>).mock.calls.length
    ).toBe(1);
    const captured = (Sentry.captureException as Mock<typeof Sentry.captureException>).mock
      .calls[0][0] as APIError;
    expect(captured).toBeInstanceOf(APIError);
    expect(captured.title).toContain("alerts");
  });

  it("posts directly using the url parameter without env lookup", async () => {
    mockAxiosPost.mockResolvedValue({status: 200});

    await sendToSlack("direct msg", {url: "https://direct.example/hook"});
    expect(mockAxiosPost.mock.calls.length).toBe(1);
    const [url, payload] = mockAxiosPost.mock.calls[0];
    expect(url).toBe("https://direct.example/hook");
    expect(payload).toEqual({text: "direct msg"});
  });

  it("captures error and throws APIError when shouldThrow=true", async () => {
    process.env.SLACK_WEBHOOKS = JSON.stringify({
      default: "https://slack.example/default",
    });
    mockAxiosPost.mockRejectedValue(new Error("slack down"));

    try {
      await sendToSlack("err", {shouldThrow: true});
      throw new Error("Expected sendToSlack to throw APIError");
    } catch (error) {
      const apiError = error as APIError;
      expect(isAPIError(apiError)).toBe(true);
      expect(apiError.title).toMatch(/Error posting to slack/i);
    }
    expect(mockAxiosPost.mock.calls.length).toBe(1);
  });

  it("captures error and does not throw when shouldThrow=false", async () => {
    process.env.SLACK_WEBHOOKS = JSON.stringify({
      default: "https://slack.example/default",
    });
    mockAxiosPost.mockRejectedValue(new Error("slack intermittent"));

    await sendToSlack("err", {shouldThrow: false});
    expect(mockAxiosPost.mock.calls.length).toBe(1);
  });

  it("prepends Slack member-id mentions so incoming webhooks notify those users", async () => {
    await sendToSlack("needs review", {
      mentionUserIds: ["U012ABCDEF", "<@W0ENTERPR1>"],
      url: "https://direct.example/hook",
    });
    const [, payload] = mockAxiosPost.mock.calls[0];
    expect(payload).toEqual({text: "<@U012ABCDEF> <@W0ENTERPR1> needs review"});
  });

  it("dedupes mention ids and skips names or emails that cannot mention anyone", async () => {
    await sendToSlack("ping", {
      mentionUserIds: ["U012ABCDEF", "u012abcdef", "jane@example.com", "Jane Doe", ""],
      url: "https://direct.example/hook",
    });
    const [, payload] = mockAxiosPost.mock.calls[0];
    expect(payload).toEqual({text: "<@U012ABCDEF> ping"});
  });

  it("applies env prefix after mention tokens", async () => {
    await sendToSlack("deployed", {
      env: "prd",
      mentionUserIds: ["U012ABCDEF"],
      url: "https://direct.example/hook",
    });
    const [, payload] = mockAxiosPost.mock.calls[0];
    expect(payload).toEqual({text: "[PRD] <@U012ABCDEF> deployed"});
  });

  it("sends mention tokens alone when the message text is empty", async () => {
    await sendToSlack("", {
      mentionUserIds: ["U012ABCDEF"],
      url: "https://direct.example/hook",
    });
    const [, payload] = mockAxiosPost.mock.calls[0];
    expect(payload).toEqual({text: "<@U012ABCDEF>"});
  });
});

describe("normalizeSlackUserId / formatSlackUserMention", () => {
  it("accepts bare ids and already-wrapped mention tokens", () => {
    expect(normalizeSlackUserId("U012ABCDEF")).toBe("U012ABCDEF");
    expect(normalizeSlackUserId("<@u012abcdef>")).toBe("U012ABCDEF");
    expect(normalizeSlackUserId("W0ENTERPR1")).toBe("W0ENTERPR1");
  });

  it("rejects display names and emails", () => {
    expect(normalizeSlackUserId("Jane Doe")).toBeUndefined();
    expect(normalizeSlackUserId("jane@example.com")).toBeUndefined();
    expect(normalizeSlackUserId("@jane")).toBeUndefined();
  });

  it("formats a valid member id as a Slack mention token", () => {
    expect(formatSlackUserMention("U012ABCDEF")).toBe("<@U012ABCDEF>");
  });

  it("throws APIError for values that are not Slack member ids", () => {
    try {
      formatSlackUserMention("jane@example.com");
      throw new Error("Expected formatSlackUserMention to throw");
    } catch (error) {
      expect(isAPIError(error)).toBe(true);
      expect((error as APIError).title).toBe("Invalid Slack user id");
    }
  });
});

describe("lookupSlackUserIdByEmail", () => {
  let mockAxiosGet: Mock<typeof axios.get>;

  beforeEach(() => {
    mockAxiosGet = spyOn(axios, "get").mockResolvedValue({
      data: {ok: true, user: {id: "U012ABCDEF"}},
      status: 200,
    });
    Reflect.deleteProperty(process.env, "SLACK_BOT_TOKEN");
    (Sentry.captureException as Mock<typeof Sentry.captureException>).mockClear();
  });

  afterEach(() => {
    mockAxiosGet.mockRestore();
  });

  it("returns the member id from users.lookupByEmail", async () => {
    const id = await lookupSlackUserIdByEmail({
      email: "jane@example.com",
      token: "xoxb-test",
    });
    expect(id).toBe("U012ABCDEF");
    expect(mockAxiosGet.mock.calls.length).toBe(1);
    const [url, config] = mockAxiosGet.mock.calls[0];
    expect(url).toBe("https://slack.com/api/users.lookupByEmail");
    expect(config).toEqual({
      headers: {Authorization: "Bearer xoxb-test"},
      params: {email: "jane@example.com"},
    });
  });

  it("returns undefined when no bot token is configured", async () => {
    const id = await lookupSlackUserIdByEmail({email: "jane@example.com"});
    expect(id).toBeUndefined();
    expect(mockAxiosGet.mock.calls.length).toBe(0);
  });

  it("returns undefined when email is empty and shouldThrow is false", async () => {
    const id = await lookupSlackUserIdByEmail({email: "   ", token: "xoxb-test"});
    expect(id).toBeUndefined();
    expect(mockAxiosGet.mock.calls.length).toBe(0);
  });

  it("returns undefined when Slack reports the user was not found", async () => {
    mockAxiosGet.mockResolvedValue({data: {error: "users_not_found", ok: false}, status: 200});
    const id = await lookupSlackUserIdByEmail({
      email: "missing@example.com",
      token: "xoxb-test",
    });
    expect(id).toBeUndefined();
  });

  it("throws when shouldThrow is true and Slack returns an error", async () => {
    mockAxiosGet.mockResolvedValue({data: {error: "missing_scope", ok: false}, status: 200});
    try {
      await lookupSlackUserIdByEmail({
        email: "jane@example.com",
        shouldThrow: true,
        token: "xoxb-test",
      });
      throw new Error("Expected lookupSlackUserIdByEmail to throw");
    } catch (error) {
      expect(isAPIError(error)).toBe(true);
      expect((error as APIError).title).toBe("Slack user lookup failed");
      expect((error as APIError).detail).toBe("missing_scope");
    }
  });

  it("throws when shouldThrow is true and email is empty", async () => {
    try {
      await lookupSlackUserIdByEmail({email: "  ", shouldThrow: true, token: "xoxb-test"});
      throw new Error("Expected lookupSlackUserIdByEmail to throw");
    } catch (error) {
      expect(isAPIError(error)).toBe(true);
      expect((error as APIError).title).toBe("Email is required to look up a Slack user");
    }
    expect(mockAxiosGet.mock.calls.length).toBe(0);
  });

  it("throws when shouldThrow is true and no bot token is set", async () => {
    try {
      await lookupSlackUserIdByEmail({email: "jane@example.com", shouldThrow: true});
      throw new Error("Expected lookupSlackUserIdByEmail to throw");
    } catch (error) {
      expect(isAPIError(error)).toBe(true);
      expect((error as APIError).title).toContain("SLACK_BOT_TOKEN");
    }
    expect(mockAxiosGet.mock.calls.length).toBe(0);
  });

  it("throws when shouldThrow is true and the Slack HTTP call fails", async () => {
    mockAxiosGet.mockRejectedValue(new Error("network down"));
    try {
      await lookupSlackUserIdByEmail({
        email: "jane@example.com",
        shouldThrow: true,
        token: "xoxb-test",
      });
      throw new Error("Expected lookupSlackUserIdByEmail to throw");
    } catch (error) {
      expect(isAPIError(error)).toBe(true);
      expect((error as APIError).title).toMatch(/Error looking up Slack user by email/i);
    }
  });

  it("returns undefined when the Slack HTTP call fails and shouldThrow is false", async () => {
    mockAxiosGet.mockRejectedValue(new Error("network down"));
    const id = await lookupSlackUserIdByEmail({
      email: "jane@example.com",
      token: "xoxb-test",
    });
    expect(id).toBeUndefined();
  });
});
