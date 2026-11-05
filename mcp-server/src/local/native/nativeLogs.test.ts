import {describe, expect, it} from "bun:test";
import {snapshotNativeLogs} from "./nativeLogs.js";

describe("snapshotNativeLogs", () => {
  it("returns disabled status when TERRENO_NATIVE_LOGS=0", async (): Promise<void> => {
    process.env.TERRENO_NATIVE_LOGS = "0";
    const result = await snapshotNativeLogs(50);
    expect(result.status).toContain("disabled");
    Reflect.deleteProperty(process.env, "TERRENO_NATIVE_LOGS");
  });

  it("returns a status string when platform tools are unavailable", async (): Promise<void> => {
    Reflect.deleteProperty(process.env, "TERRENO_NATIVE_LOGS");
    const result = await snapshotNativeLogs(10);
    expect(result.entries).toEqual([]);
    expect(result.status.length).toBeGreaterThan(0);
  });
});
