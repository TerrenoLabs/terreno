import {describe, expect, it} from "bun:test";

import {withVercelManifest} from "./vercelBuild";

const appJson = {
  expo: {
    extra: {apiBaseUrl: "http://localhost:4000", authProvider: "better-auth", BASE_URL: "x"},
    name: "frontend",
  },
};

describe("withVercelManifest", (): void => {
  it("sets the manifest URL keys and websocket-only sockets, keeping the rest", (): void => {
    const result = withVercelManifest({apiUrl: "https://terreno-backend.vercel.app", appJson});
    expect(result.expo.extra).toEqual({
      apiBaseUrl: "https://terreno-backend.vercel.app",
      authProvider: "better-auth",
      BASE_URL: "https://terreno-backend.vercel.app",
      SOCKET_TRANSPORTS: "websocket",
    });
    expect(result.expo.name).toBe("frontend");
  });

  it("normalizes a URL with a path or trailing slash to its origin", (): void => {
    const result = withVercelManifest({apiUrl: "https://api.example.com/", appJson});
    expect(result.expo.extra?.BASE_URL).toBe("https://api.example.com");
  });

  it("rejects plain http for a deployed backend", (): void => {
    expect(() => withVercelManifest({apiUrl: "http://api.example.com", appJson})).toThrow(
      "must be https"
    );
  });

  it("rejects a value that is not a URL", (): void => {
    expect(() => withVercelManifest({apiUrl: "terreno-backend.vercel.app", appJson})).toThrow();
  });
});
