import {afterEach, describe, expect, it, mock} from "bun:test";

describe("clientDev CDP fallbacks", () => {
  afterEach((): void => {
    Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
  });

  it("readLocalStorage uses Runtime.evaluate when storage is only on device", async (): Promise<void> => {
    mock.module("../metro/metroDevSession.js", () => ({
      cdpRuntimeEvaluate: mock(async () => ({
        value: {count: 1, entries: {k: "from-device"}},
      })),
      ensureCdpConnected: mock(async () => ({detail: "cdp ok", ok: true})),
      getCdpConnectionStatus: () => "CDP: ok",
    }));
    const {readLocalStorage} = await import(`./clientDev.js?t=cdpread-${Date.now()}`);
    const text = await readLocalStorage({keys: ["k"]});
    expect(text).toContain("from-device");
  });

  it("readLocalStorage CDP path returns error when evaluate fails", async (): Promise<void> => {
    mock.module("../metro/metroDevSession.js", () => ({
      cdpRuntimeEvaluate: mock(async () => ({error: "read err"})),
      ensureCdpConnected: mock(async () => ({detail: "cdp ok", ok: true})),
      getCdpConnectionStatus: () => "CDP: read-down",
    }));
    const {readLocalStorage} = await import(`./clientDev.js?t=cdpreaderr-${Date.now()}`);
    const text = await readLocalStorage({keys: ["a"]});
    expect(text).toContain("read err");
    expect(text).toContain("CDP: read-down");
  });

  it("writeLocalStorage uses Runtime.evaluate when storage is only on device", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    mock.module("../metro/metroDevSession.js", () => ({
      cdpRuntimeEvaluate: mock(async () => ({
        value: {key: "x", ok: true},
      })),
      ensureCdpConnected: mock(async () => ({detail: "cdp ok", ok: true})),
      getCdpConnectionStatus: () => "CDP: ok",
    }));
    const {writeLocalStorage} = await import(`./clientDev.js?t=cdpwrite-${Date.now()}`);
    const text = await writeLocalStorage({key: "x", value: "y"});
    expect(text).toContain("x");
  });

  it("writeLocalStorage CDP path returns error when evaluate fails", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    mock.module("../metro/metroDevSession.js", () => ({
      cdpRuntimeEvaluate: mock(async () => ({error: "write err"})),
      ensureCdpConnected: mock(async () => ({detail: "cdp ok", ok: true})),
      getCdpConnectionStatus: () => "CDP: write-down",
    }));
    const {writeLocalStorage} = await import(`./clientDev.js?t=cdpwriteerr-${Date.now()}`);
    const text = await writeLocalStorage({key: "k", value: "v"});
    expect(text).toContain("write err");
    expect(text).toContain("CDP: write-down");
  });
});
