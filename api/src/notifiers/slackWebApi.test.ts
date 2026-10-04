import {afterEach, beforeEach, describe, expect, it, type Mock, spyOn} from "bun:test";
import * as Sentry from "@sentry/bun";
import axios from "axios";

import {APIError, isAPIError} from "../errors";
import {
  createSlackPrivateChannel,
  findSlackChannelByName,
  inviteSlackUsersToChannel,
  normalizeSlackChannelName,
  postSlackMessage,
} from "./slackWebApi";

describe("normalizeSlackChannelName", () => {
  it("lowercases and trims a valid channel name", () => {
    expect(normalizeSlackChannelName("  Case-Room_1  ")).toBe("case-room_1");
  });

  it("rejects names Slack will not accept", () => {
    expect(() => normalizeSlackChannelName("case room")).toThrow(APIError);
    expect(() => normalizeSlackChannelName("---")).toThrow(APIError);
  });
});

describe("Slack Web API", () => {
  let mockAxiosPost: Mock<typeof axios.post>;
  let mockAxiosGet: Mock<typeof axios.get>;

  beforeEach(() => {
    mockAxiosPost = spyOn(axios, "post");
    mockAxiosGet = spyOn(axios, "get");
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    (Sentry.captureException as Mock<typeof Sentry.captureException>).mockClear();
  });

  afterEach(() => {
    mockAxiosPost.mockRestore();
    mockAxiosGet.mockRestore();
    Reflect.deleteProperty(process.env, "SLACK_BOT_TOKEN");
  });

  it("creates a private channel, invites members, and posts the first message", async () => {
    mockAxiosPost.mockImplementation(async (url: string, body: {name?: string; text?: string}) => {
      if (String(url).endsWith("conversations.create")) {
        return {
          data: {channel: {id: "C012345678", is_private: true, name: body.name}, ok: true},
          status: 200,
        };
      }
      if (String(url).endsWith("conversations.invite")) {
        return {data: {ok: true}, status: 200};
      }
      return {data: {channel: "C012345678", ok: true, ts: "1503435956.000247"}, status: 200};
    });

    const created = await createSlackPrivateChannel({
      initialMessage: "Case opened",
      mentionUserIds: ["U012ABCDEF"],
      name: "Case-123",
      userIds: ["U012ABCDEF", "not-a-slack-id"],
    });

    expect(created).toEqual({
      channelId: "C012345678",
      invites: {
        alreadyMemberUserIds: [],
        failures: [{error: "invalid_user_id", userId: "not-a-slack-id"}],
        invitedUserIds: ["U012ABCDEF"],
      },
      messageTs: "1503435956.000247",
      name: "case-123",
    });
    const createBody = mockAxiosPost.mock.calls[0]?.[1] as {is_private?: boolean; name?: string};
    expect(createBody).toEqual({is_private: true, name: "case-123"});
    const messageBody = mockAxiosPost.mock.calls[2]?.[1] as {text?: string};
    expect(messageBody.text).toBe("<@U012ABCDEF> Case opened");
  });

  it("throws 409 when the channel name is taken", async () => {
    mockAxiosPost.mockResolvedValue({data: {error: "name_taken", ok: false}, status: 200});

    try {
      await createSlackPrivateChannel({name: "case-123"});
      throw new Error("Expected createSlackPrivateChannel to throw");
    } catch (error) {
      expect(isAPIError(error)).toBe(true);
      expect((error as APIError).status).toBe(409);
      expect((error as APIError).title).toBe("Slack channel name is already taken");
    }
  });

  it("keeps the new channel id when the initial message fails", async () => {
    mockAxiosPost.mockImplementation(async (url: string) => {
      if (String(url).endsWith("conversations.create")) {
        return {data: {channel: {id: "C012345678", name: "case-123"}, ok: true}, status: 200};
      }
      return {data: {error: "not_in_channel", ok: false}, status: 200};
    });

    try {
      await createSlackPrivateChannel({initialMessage: "hello", name: "case-123"});
      throw new Error("Expected createSlackPrivateChannel to throw");
    } catch (error) {
      expect(isAPIError(error)).toBe(true);
      expect((error as APIError).title).toBe("Slack initial message failed");
      expect((error as APIError).meta?.channelId).toBe("C012345678");
    }
  });

  it("reports members who are already in the channel", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {error: "already_in_channel", ok: false},
      status: 200,
    });

    const result = await inviteSlackUsersToChannel({
      channelId: "c012345678",
      userIds: ["<@U012ABCDEF>", "U012ABCDEF"],
    });

    expect(result.alreadyMemberUserIds).toEqual(["U012ABCDEF"]);
    expect(result.invitedUserIds).toEqual([]);
    const body = mockAxiosPost.mock.calls[0]?.[1] as {channel?: string; users?: string};
    expect(body).toEqual({channel: "C012345678", force: true, users: "U012ABCDEF"});
  });

  it("returns per-user invite failures without failing the whole call", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {
        error: "user_not_found",
        errors: [{error: "user_not_found", user: "U012ABCDEF"}],
        ok: false,
      },
      status: 200,
    });

    const result = await inviteSlackUsersToChannel({
      channelId: "C012345678",
      userIds: ["U012ABCDEF", "W0ENTERPR1"],
    });

    expect(result.failures).toEqual([{error: "user_not_found", userId: "U012ABCDEF"}]);
    expect(result.invitedUserIds).toEqual([]);
  });

  it("throws when the bot is not in an existing private channel", async () => {
    mockAxiosPost.mockResolvedValue({data: {error: "not_in_channel", ok: false}, status: 200});

    try {
      await inviteSlackUsersToChannel({channelId: "C012345678", userIds: ["U012ABCDEF"]});
      throw new Error("Expected inviteSlackUsersToChannel to throw");
    } catch (error) {
      expect(isAPIError(error)).toBe(true);
      expect((error as APIError).detail).toContain("not_in_channel");
    }
  });

  it("posts blocks and mention tokens to a channel", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {channel: "C012345678", ok: true, ts: "1.2"},
      status: 200,
    });

    const posted = await postSlackMessage({
      blocks: [{type: "section"}],
      channelId: "C012345678",
      mentionUserIds: ["U012ABCDEF"],
      text: "Update",
    });

    expect(posted).toEqual({channelId: "C012345678", messageTs: "1.2"});
    expect(mockAxiosPost.mock.calls[0]?.[1]).toEqual({
      blocks: [{type: "section"}],
      channel: "C012345678",
      text: "<@U012ABCDEF> Update",
    });
  });

  it("retries a rate-limited post and then succeeds", async () => {
    const rateLimited = Object.assign(new Error("429"), {
      isAxiosError: true,
      response: {headers: {"retry-after": "0"}, status: 429},
    });
    mockAxiosPost
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({data: {ok: true, ts: "9.9"}, status: 200});

    const posted = await postSlackMessage({channelId: "C012345678", text: "again"});
    expect(posted.messageTs).toBe("9.9");
    expect(mockAxiosPost.mock.calls.length).toBe(2);
  });

  it("finds a channel on a later page", async () => {
    mockAxiosGet
      .mockResolvedValueOnce({
        data: {
          channels: [{id: "C000000001", name: "other"}],
          ok: true,
          response_metadata: {next_cursor: "page-2"},
        },
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          channels: [{id: "C012345678", is_private: true, name_normalized: "case-123"}],
          ok: true,
          response_metadata: {next_cursor: ""},
        },
        status: 200,
      });

    const found = await findSlackChannelByName({name: "case-123"});
    expect(found).toEqual({channelId: "C012345678", isPrivate: true, name: "case-123"});
    const firstParams = mockAxiosGet.mock.calls[0]?.[1] as {params?: {types?: string}};
    expect(firstParams.params?.types).toBe("public_channel,private_channel");
  });

  it("returns undefined when no visible channel has that name", async () => {
    mockAxiosGet.mockResolvedValue({
      data: {channels: [], ok: true, response_metadata: {next_cursor: ""}},
      status: 200,
    });

    expect(await findSlackChannelByName({name: "missing"})).toBeUndefined();
  });

  it("throws when the bot token is missing", async () => {
    Reflect.deleteProperty(process.env, "SLACK_BOT_TOKEN");

    try {
      await postSlackMessage({channelId: "C012345678", text: "hi"});
      throw new Error("Expected postSlackMessage to throw");
    } catch (error) {
      expect(isAPIError(error)).toBe(true);
      expect((error as APIError).title).toBe("SLACK_BOT_TOKEN is not set");
    }
    expect(mockAxiosPost.mock.calls.length).toBe(0);
  });

  it("returns the channel without posting when there is no initial message", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {channel: {id: "C012345678", name: "case-123"}, ok: true},
      status: 200,
    });

    const created = await createSlackPrivateChannel({name: "case-123"});
    expect(created.messageTs).toBeUndefined();
    expect(mockAxiosPost.mock.calls.length).toBe(1);
  });

  it("rejects invites that contain no Slack member ids", async () => {
    await expect(
      createSlackPrivateChannel({name: "case-123", userIds: ["jane@example.com"]})
    ).rejects.toBeInstanceOf(APIError);
    await expect(
      inviteSlackUsersToChannel({channelId: "C012345678", userIds: ["jane"]})
    ).rejects.toBeInstanceOf(APIError);
    await expect(postSlackMessage({channelId: "not-a-channel", text: "hi"})).rejects.toBeInstanceOf(
      APIError
    );
    await expect(postSlackMessage({channelId: "C012345678", text: "  "})).rejects.toBeInstanceOf(
      APIError
    );
    expect(mockAxiosPost.mock.calls.length).toBe(0);
  });

  it("keeps the channel id when inviting into the new channel fails", async () => {
    mockAxiosPost.mockImplementation(async (url: string) => {
      if (String(url).endsWith("conversations.create")) {
        return {data: {channel: {id: "C012345678", name: "case-123"}, ok: true}, status: 200};
      }
      return {data: {error: "not_in_channel", ok: false}, status: 200};
    });

    try {
      await createSlackPrivateChannel({name: "case-123", userIds: ["U012ABCDEF"]});
      throw new Error("Expected createSlackPrivateChannel to throw");
    } catch (error) {
      expect((error as APIError).meta?.channelId).toBe("C012345678");
      expect((error as APIError).detail).toContain("not_in_channel");
    }
  });

  it("throws when Slack omits the new channel id or the message timestamp", async () => {
    mockAxiosPost.mockResolvedValueOnce({data: {channel: {}, ok: true}, status: 200});
    await expect(createSlackPrivateChannel({name: "case-123"})).rejects.toMatchObject({
      title: "Slack API request failed",
    });

    mockAxiosPost.mockResolvedValueOnce({data: {ok: true}, status: 200});
    await expect(postSlackMessage({channelId: "C012345678", text: "hi"})).rejects.toMatchObject({
      code: "slack-message-missing",
    });
  });

  it("counts partial invite results and skips blank error entries", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {
        errors: [
          {error: "already_in_channel", user: "U012ABCDEF"},
          {user: " "},
          {user: "W0ENTERPR1"},
        ],
        ok: true,
      },
      status: 200,
    });

    const result = await inviteSlackUsersToChannel({
      channelId: "C012345678",
      userIds: ["U012ABCDEF", "W0ENTERPR1", "U33333333", "jane"],
    });

    expect(result.alreadyMemberUserIds).toEqual(["U012ABCDEF"]);
    expect(result.failures).toEqual([
      {error: "invalid_user_id", userId: "jane"},
      {error: "unknown_error", userId: "W0ENTERPR1"},
    ]);
    expect(result.invitedUserIds).toEqual(["U33333333"]);
  });

  it("retries an HTTP 200 rate limit and a transport failure exhausts attempts", async () => {
    mockAxiosPost
      .mockResolvedValueOnce({
        data: {error: "ratelimited", ok: false},
        headers: {get: (name: string) => (name === "retry-after" ? "0.001" : undefined)},
        status: 200,
      })
      .mockResolvedValueOnce({data: {ok: true, ts: "4.4"}, status: 200});

    const posted = await postSlackMessage({
      channelId: "C012345678",
      mentionUserIds: ["not-an-id"],
      text: "later",
    });
    expect(posted.messageTs).toBe("4.4");

    mockAxiosPost.mockReset();
    mockAxiosPost.mockRejectedValue(new Error("network down"));
    await expect(postSlackMessage({channelId: "C012345678", text: "later"})).rejects.toMatchObject({
      code: "slack-transport-failed",
    });
    expect(
      (Sentry.captureException as Mock<typeof Sentry.captureException>).mock.calls.length
    ).toBeGreaterThan(0);
  });

  it("stops paging when Slack never ends the channel list", async () => {
    mockAxiosGet.mockResolvedValue({
      data: {channels: [{name: "other"}], ok: true, response_metadata: {next_cursor: "next"}},
      status: 200,
    });

    expect(await findSlackChannelByName({name: "case-123"})).toBeUndefined();
    expect(mockAxiosGet.mock.calls.length).toBe(25);
  });
});
