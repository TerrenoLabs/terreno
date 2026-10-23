import {describe, expect, it} from "bun:test";

import {
  registerExpoPushToken,
  registerExpoPushTokenSafely,
  releaseExpoPushToken,
  releaseExpoPushTokenSafely,
} from "./registerExpoPushToken";

describe("registerExpoPushToken", () => {
  it("skips web platforms without fetching a token", async () => {
    let fetched = false;
    const result = await registerExpoPushToken({
      getToken: async () => {
        fetched = true;
        return {data: "ExponentPushToken[x]"};
      },
      platform: "web",
      postToken: async () => {
        throw new Error("should not post");
      },
    });
    expect(result).toBe("skipped");
    expect(fetched).toBe(false);
  });

  it("skips when the Expo token is empty", async () => {
    const posts: unknown[] = [];
    const result = await registerExpoPushToken({
      getToken: async () => ({data: ""}),
      platform: "ios",
      postToken: async (body) => {
        posts.push(body);
      },
    });
    expect(result).toBe("skipped");
    expect(posts).toEqual([]);
  });

  it("posts an iOS token after login", async () => {
    const posts: Array<{platform: string; token: string}> = [];
    const result = await registerExpoPushToken({
      getToken: async () => ({data: "ExponentPushToken[abc]"}),
      platform: "ios",
      postToken: async (body) => {
        posts.push(body);
      },
    });
    expect(result).toBe("registered");
    expect(posts).toEqual([{platform: "ios", token: "ExponentPushToken[abc]"}]);
  });

  it("posts an Android token after login", async () => {
    const posts: Array<{platform: string; token: string}> = [];
    const result = await registerExpoPushToken({
      getToken: async () => ({data: "ExponentPushToken[android]"}),
      platform: "android",
      postToken: async (body) => {
        posts.push(body);
      },
    });
    expect(result).toBe("registered");
    expect(posts).toEqual([{platform: "android", token: "ExponentPushToken[android]"}]);
  });
});

describe("registerExpoPushTokenSafely", () => {
  it("returns skipped and warns when registration throws", async () => {
    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const result = await registerExpoPushTokenSafely({
        getToken: async () => {
          throw new Error("network");
        },
        platform: "ios",
        postToken: async () => undefined,
      });
      expect(result).toBe("skipped");
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("releaseExpoPushToken", () => {
  it("skips when this session registered no token", async () => {
    const deleted: string[] = [];
    const result = await releaseExpoPushToken({
      deleteToken: async (id) => {
        deleted.push(id);
      },
    });
    expect(result).toBe("skipped");
    expect(deleted).toEqual([]);
  });

  it("deletes the token this session registered, once", async () => {
    await registerExpoPushToken({
      getToken: async () => ({data: "ExponentPushToken[release]"}),
      platform: "ios",
      postToken: async () => ({data: {_id: "push-token-1"}}),
    });
    const deleted: string[] = [];
    const deleteToken = async (id: string): Promise<void> => {
      deleted.push(id);
    };

    expect(await releaseExpoPushToken({deleteToken})).toBe("released");
    expect(await releaseExpoPushToken({deleteToken})).toBe("skipped");
    expect(deleted).toEqual(["push-token-1"]);
  });

  it("reads the id from an unwrapped response and does not throw on a failed delete", async () => {
    await registerExpoPushToken({
      getToken: async () => ({data: "ExponentPushToken[unwrapped]"}),
      platform: "android",
      postToken: async () => ({_id: "push-token-2"}),
    });

    const result = await releaseExpoPushTokenSafely({
      deleteToken: async () => {
        throw new Error("network down");
      },
    });

    expect(result).toBe("skipped");
  });
});
