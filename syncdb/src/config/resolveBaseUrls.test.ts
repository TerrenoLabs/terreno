import {describe, expect, it} from "bun:test";

import {
  DEFAULT_DEV_API_PORT,
  resolveBaseUrls,
  resolveDevApiPort,
  SAME_ORIGIN_SENTINEL,
} from "./resolveBaseUrls";

describe("resolveBaseUrls", () => {
  it("treats an empty envApiUrl as unset and falls back to localhost", () => {
    const urls = resolveBaseUrls({
      envApiUrl: "",
      expoConstants: {expoConfig: {extra: {}}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe(`http://localhost:${DEFAULT_DEV_API_PORT}`);
    expect(urls.baseWebsocketsUrl).toBe(`ws://localhost:${DEFAULT_DEV_API_PORT}/`);
    expect(urls.baseTasksUrl).toBe(`http://localhost:${DEFAULT_DEV_API_PORT}/tasks`);
  });

  it("treats an empty BASE_URL extra as unset and falls back to localhost in non-dev", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {BASE_URL: ""}}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("http://localhost:4000");
  });

  it("uses env override when provided", () => {
    const urls = resolveBaseUrls({
      envApiUrl: "https://api.example.com",
      expoConstants: {expoConfig: {extra: {}}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("https://api.example.com");
    expect(urls.baseWebsocketsUrl).toBe("https://ws.example.com/");
    expect(urls.baseTasksUrl).toBe("https://tasks.example.com/tasks");
  });

  it("uses hostUri in dev mode", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {}, hostUri: "10.0.0.12:8081"}},
      isDev: true,
    });
    expect(urls.baseUrl).toBe("http://10.0.0.12:4000");
    expect(urls.baseWebsocketsUrl).toBe("ws://10.0.0.12:4000/");
    expect(urls.baseTasksUrl).toBe("http://10.0.0.12:4000/tasks");
  });

  it("falls back to experienceUrl in dev mode when hostUri missing", () => {
    const urls = resolveBaseUrls({
      expoConstants: {
        experienceUrl: "exp://192.168.1.20:19000",
        expoConfig: {extra: {}},
      },
      isDev: true,
    });
    expect(urls.baseUrl).toBe("http://192.168.1.20:4000");
    expect(urls.baseWebsocketsUrl).toBe("ws://192.168.1.20:4000/");
    expect(urls.baseTasksUrl).toBe("http://192.168.1.20:4000/tasks");
  });

  it("falls back to localhost in dev mode when nothing else is available", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {}}},
      isDev: true,
    });
    expect(urls.baseUrl).toBe(`http://localhost:${DEFAULT_DEV_API_PORT}`);
    expect(urls.baseWebsocketsUrl).toBe(`ws://localhost:${DEFAULT_DEV_API_PORT}/`);
    expect(urls.baseTasksUrl).toBe(`http://localhost:${DEFAULT_DEV_API_PORT}/tasks`);
  });

  it("uses BASE_URL from extra when not in dev mode", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {BASE_URL: "https://api.prod.com"}}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("https://api.prod.com");
    expect(urls.baseWebsocketsUrl).toBe("https://ws.prod.com/");
    expect(urls.baseTasksUrl).toBe("https://tasks.prod.com/tasks");
  });

  it("falls back to hostUri when BASE_URL absent in non-dev", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {}, hostUri: "172.16.0.3:8081"}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("http://172.16.0.3:4000");
    expect(urls.baseWebsocketsUrl).toBe("ws://172.16.0.3:4000/");
    expect(urls.baseTasksUrl).toBe("http://172.16.0.3:4000/tasks");
  });

  it("falls back to experienceUrl in non-dev when hostUri absent", () => {
    const urls = resolveBaseUrls({
      expoConstants: {
        experienceUrl: "exp://10.1.2.3:19000",
        expoConfig: {extra: {}},
      },
      isDev: false,
    });
    expect(urls.baseUrl).toBe("http://10.1.2.3:4000");
  });

  it("defaults to localhost in non-dev when nothing is configured", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {}}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("http://localhost:4000");
  });

  it("envApiUrl takes priority over BASE_URL in non-dev", () => {
    const urls = resolveBaseUrls({
      envApiUrl: "https://api.override.com",
      expoConstants: {expoConfig: {extra: {BASE_URL: "https://api.from-extra.com"}}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("https://api.override.com");
  });

  it("envApiUrl takes priority over hostUri in dev mode", () => {
    const urls = resolveBaseUrls({
      envApiUrl: "https://api.override.com",
      expoConstants: {expoConfig: {extra: {}, hostUri: "10.0.0.5:8081"}},
      isDev: true,
    });
    expect(urls.baseUrl).toBe("https://api.override.com");
    expect(urls.baseWebsocketsUrl).toBe("https://ws.override.com/");
    expect(urls.baseTasksUrl).toBe("https://tasks.override.com/tasks");
  });

  it("falls back to localhost when expoConfig is undefined", () => {
    const urls = resolveBaseUrls({
      expoConstants: {},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("http://localhost:4000");
  });

  it("ignores BASE_URL from extra in dev mode and uses hostUri instead", () => {
    const urls = resolveBaseUrls({
      expoConstants: {
        expoConfig: {extra: {BASE_URL: "https://api.prod.com"}, hostUri: "192.168.0.10:8081"},
      },
      isDev: true,
    });
    expect(urls.baseUrl).toBe("http://192.168.0.10:4000");
    expect(urls.baseWebsocketsUrl).toBe("ws://192.168.0.10:4000/");
    expect(urls.baseTasksUrl).toBe("http://192.168.0.10:4000/tasks");
  });

  it("falls back to experienceUrl when hostUri is empty string", () => {
    const urls = resolveBaseUrls({
      expoConstants: {
        experienceUrl: "exp://10.0.0.5:19000",
        expoConfig: {extra: {}, hostUri: ""},
      },
      isDev: true,
    });
    expect(urls.baseUrl).toBe("http://10.0.0.5:4000");
  });

  it("replaces 'api.' subdomain with 'tasks.' and 'ws.' for envApiUrl", () => {
    const urls = resolveBaseUrls({
      envApiUrl: "https://api.staging.example.io",
      expoConstants: {expoConfig: {extra: {}}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("https://api.staging.example.io");
    expect(urls.baseWebsocketsUrl).toBe("https://ws.staging.example.io/");
    expect(urls.baseTasksUrl).toBe("https://tasks.staging.example.io/tasks");
  });

  it("handles envApiUrl without 'api.' subdomain gracefully", () => {
    const urls = resolveBaseUrls({
      envApiUrl: "https://backend.example.com",
      expoConstants: {expoConfig: {extra: {}}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("https://backend.example.com");
    expect(urls.baseWebsocketsUrl).toBe("https://backend.example.com/");
    expect(urls.baseTasksUrl).toBe("https://backend.example.com/tasks");
  });

  it("resolves the same-origin sentinel to the window origin (https -> wss)", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {BASE_URL: SAME_ORIGIN_SENTINEL}}},
      isDev: false,
      windowOrigin: "https://api.example.com",
    });
    expect(urls.baseUrl).toBe("https://api.example.com");
    expect(urls.baseWebsocketsUrl).toBe("wss://api.example.com/");
    expect(urls.baseTasksUrl).toBe("https://api.example.com/tasks");
  });

  it("resolves the same-origin sentinel to the window origin (http -> ws)", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {BASE_URL: SAME_ORIGIN_SENTINEL}}},
      isDev: false,
      windowOrigin: "http://admin.test:8080",
    });
    expect(urls.baseUrl).toBe("http://admin.test:8080");
    expect(urls.baseWebsocketsUrl).toBe("ws://admin.test:8080/");
    expect(urls.baseTasksUrl).toBe("http://admin.test:8080/tasks");
  });

  it("resolves the same-origin sentinel even in dev mode when a window origin exists", () => {
    const urls = resolveBaseUrls({
      expoConstants: {
        expoConfig: {extra: {BASE_URL: SAME_ORIGIN_SENTINEL}, hostUri: "10.0.0.5:8081"},
      },
      isDev: true,
      windowOrigin: "https://admin.example.com",
    });
    expect(urls.baseUrl).toBe("https://admin.example.com");
    expect(urls.baseWebsocketsUrl).toBe("wss://admin.example.com/");
  });

  it("falls back to existing resolution when the sentinel is set but no window origin", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {BASE_URL: SAME_ORIGIN_SENTINEL}}},
      isDev: false,
    });
    expect(urls.baseUrl).toBe("http://localhost:4000");
    expect(urls.baseWebsocketsUrl).toBe("ws://localhost:4000/");
  });

  it("does not treat the sentinel as a literal base URL when a window origin is absent", () => {
    const urls = resolveBaseUrls({
      expoConstants: {
        expoConfig: {extra: {BASE_URL: SAME_ORIGIN_SENTINEL}, hostUri: "172.16.0.3:8081"},
      },
      isDev: false,
    });
    // Sentinel ignored -> falls through to hostUri resolution, not the literal "__SAME_ORIGIN__".
    expect(urls.baseUrl).toBe("http://172.16.0.3:4000");
  });

  it("leaves a non-sentinel BASE_URL unchanged when a window origin is present", () => {
    const urls = resolveBaseUrls({
      expoConstants: {expoConfig: {extra: {BASE_URL: "https://api.prod.com"}}},
      isDev: false,
      windowOrigin: "https://some-other-origin.com",
    });
    expect(urls.baseUrl).toBe("https://api.prod.com");
    expect(urls.baseWebsocketsUrl).toBe("https://ws.prod.com/");
  });

  it("uses a custom devApiPort for hostUri resolution in dev mode", () => {
    const urls = resolveBaseUrls({
      devApiPort: 9000,
      expoConstants: {expoConfig: {extra: {}, hostUri: "10.0.0.12:8081"}},
      isDev: true,
    });
    expect(urls.baseUrl).toBe("http://10.0.0.12:9000");
    expect(urls.baseWebsocketsUrl).toBe("ws://10.0.0.12:9000/");
    expect(urls.baseTasksUrl).toBe("http://10.0.0.12:9000/tasks");
  });

  it("uses a custom devApiPort for the localhost fallback", () => {
    const urls = resolveBaseUrls({
      devApiPort: 3000,
      expoConstants: {expoConfig: {extra: {}}},
      isDev: true,
    });
    expect(urls.baseUrl).toBe("http://localhost:3000");
    expect(urls.baseWebsocketsUrl).toBe("ws://localhost:3000/");
    expect(urls.baseTasksUrl).toBe("http://localhost:3000/tasks");
  });
});

describe("resolveDevApiPort", () => {
  it("defaults to DEFAULT_DEV_API_PORT when nothing is configured", () => {
    expect(resolveDevApiPort({expoConstants: {expoConfig: {extra: {}}}})).toBe(
      DEFAULT_DEV_API_PORT
    );
  });

  it("reads the port from expoConfig.extra.DEV_API_PORT", () => {
    expect(resolveDevApiPort({expoConstants: {expoConfig: {extra: {DEV_API_PORT: "3000"}}}})).toBe(
      3000
    );
  });

  it("prefers EXPO_PUBLIC_DEV_API_PORT over extra.DEV_API_PORT", () => {
    expect(
      resolveDevApiPort({
        envDevApiPort: "9000",
        expoConstants: {expoConfig: {extra: {DEV_API_PORT: "3000"}}},
      })
    ).toBe(9000);
  });

  it("falls back to the default for empty or invalid values", () => {
    expect(resolveDevApiPort({envDevApiPort: "", expoConstants: {}})).toBe(DEFAULT_DEV_API_PORT);
    expect(resolveDevApiPort({envDevApiPort: "not-a-number", expoConstants: {}})).toBe(
      DEFAULT_DEV_API_PORT
    );
    expect(resolveDevApiPort({envDevApiPort: "-5", expoConstants: {}})).toBe(DEFAULT_DEV_API_PORT);
  });
});

describe("SAME_ORIGIN_SENTINEL", () => {
  it("is the literal string __SAME_ORIGIN__", () => {
    expect(SAME_ORIGIN_SENTINEL).toBe("__SAME_ORIGIN__");
  });
});
