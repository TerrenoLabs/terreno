import {describe, expect, it} from "bun:test";

import {parseHeaderFlags, parseJsonValue, parseNameValuePairs} from "./flagValues";
import {runAppRestCli} from "./runAppRestCli";

describe("flagValues", () => {
  it("parses name=value pairs and headers", () => {
    expect(parseNameValuePairs(["id=1", "q=hi there"])).toEqual({id: "1", q: "hi there"});
    expect(parseHeaderFlags(["X-Request-Id: abc"])).toEqual({"X-Request-Id": "abc"});
    expect(parseJsonValue('{"a":1}')).toEqual({a: 1});
    expect(parseJsonValue(undefined)).toBeUndefined();
  });
});

describe("runAppRestCli", () => {
  const specText = JSON.stringify({
    info: {title: "Demo", version: "1"},
    openapi: "3.0.0",
    paths: {
      "/items": {get: {operationId: "item_list", summary: "List"}},
    },
    servers: [{url: "https://demo.test"}],
  });

  it("lists operations", async () => {
    const logs: string[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    const code = await runAppRestCli({
      argv: ["list"],
      binName: "demo",
      specText,
      title: "Demo",
    });
    console.info = originalInfo;
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("item_list");
  });

  it("prints help when argv is empty", async () => {
    const logs: string[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    const code = await runAppRestCli({
      argv: [],
      binName: "demo",
      specText,
      title: "Demo",
    });
    console.info = originalInfo;
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("Usage: demo");
  });
});
