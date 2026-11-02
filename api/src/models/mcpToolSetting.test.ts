import {afterEach, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {DateTime} from "luxon";

import {setupDb} from "../tests";
import {McpToolSetting} from "./mcpToolSetting";

describe("McpToolSetting.disabledNames", () => {
  const restores: Array<() => void> = [];

  beforeEach(async () => {
    await setupDb();
    await McpToolSetting.deleteMany({});
  });

  afterEach(() => {
    for (const restore of restores.splice(0)) {
      restore();
    }
  });

  it("reuses the cached set until a write through the model clears it", async () => {
    await McpToolSetting.create({enabled: false, name: "a", source: "custom"});
    expect([...(await McpToolSetting.disabledNames())]).toEqual(["a"]);

    // A write that bypasses the model's hooks is not seen until the cache expires.
    await McpToolSetting.collection.updateOne({name: "a"}, {$set: {enabled: true}});
    expect([...(await McpToolSetting.disabledNames())]).toEqual(["a"]);

    await McpToolSetting.updateOne({name: "a"}, {$set: {enabled: false}});
    await McpToolSetting.collection.updateOne({name: "a"}, {$set: {enabled: true}});
    await McpToolSetting.updateOne({name: "b"}, {$set: {enabled: false}});
    expect([...(await McpToolSetting.disabledNames())]).toEqual([]);
  });

  it("reads again after the TTL", async () => {
    await McpToolSetting.create({enabled: false, name: "a", source: "custom"});
    expect((await McpToolSetting.disabledNames()).size).toBe(1);
    await McpToolSetting.collection.updateOne({name: "a"}, {$set: {enabled: true}});

    const later = DateTime.now().plus({seconds: 10});
    const now = spyOn(DateTime, "now").mockReturnValue(later);
    restores.push(() => now.mockRestore());

    expect((await McpToolSetting.disabledNames()).size).toBe(0);
  });

  it("keeps the last known switches when a read fails, and fails closed with none", async () => {
    await McpToolSetting.create({enabled: false, name: "a", source: "custom"});
    expect((await McpToolSetting.disabledNames()).size).toBe(1);

    const later = DateTime.now().plus({seconds: 10});
    const now = spyOn(DateTime, "now").mockReturnValue(later);
    restores.push(() => now.mockRestore());
    const find = spyOn(McpToolSetting, "find").mockImplementation(() => {
      throw new Error("mongo down");
    });
    restores.push(() => find.mockRestore());

    expect([...(await McpToolSetting.disabledNames())]).toEqual(["a"]);

    find.mockRestore();
    await McpToolSetting.deleteMany({});
    const failing = spyOn(McpToolSetting, "find").mockImplementation(() => {
      throw new Error("mongo down");
    });
    restores.push(() => failing.mockRestore());
    await expect(McpToolSetting.disabledNames()).rejects.toThrow("mongo down");
  });
});
