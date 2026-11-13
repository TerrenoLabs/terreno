import {afterEach, describe, expect, it, spyOn} from "bun:test";
import * as childProcess from "node:child_process";

import {snapshotNativeLogs} from "./nativeLogs.js";

type SpawnSyncMock = typeof childProcess.spawnSync;

const mockSpawnResult = (
  partial: Partial<Pick<ReturnType<SpawnSyncMock>, "error" | "status" | "stderr" | "stdout">>
): ReturnType<SpawnSyncMock> =>
  ({
    error: undefined,
    status: 0,
    stderr: "",
    stdout: "",
    ...partial,
  }) as unknown as ReturnType<SpawnSyncMock>;

describe("snapshotNativeLogs", () => {
  afterEach((): void => {
    Reflect.deleteProperty(process.env, "TERRENO_NATIVE_LOGS");
    Reflect.deleteProperty(process.env, "TERRENO_ADB_SERIAL");
  });

  it("returns disabled status when TERRENO_NATIVE_LOGS=0", async (): Promise<void> => {
    process.env.TERRENO_NATIVE_LOGS = "0";
    const result = await snapshotNativeLogs(50);
    expect(result.status).toContain("disabled");
  });

  it("returns a status string when platform tools are unavailable", async (): Promise<void> => {
    const result = await snapshotNativeLogs(10);
    expect(result.entries).toEqual([]);
    expect(result.status.length).toBeGreaterThan(0);
  });

  it("prefers android lines when adb succeeds", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(((cmd: string) => {
      if (cmd === "adb") {
        return mockSpawnResult({
          stdout:
            "I/tag info line\nW/tag warn line\nE/tag error line\nfatal crash\nother error here\n",
        });
      }
      return mockSpawnResult({error: new Error("ENOENT"), status: undefined});
    }) as SpawnSyncMock);
    const result = await snapshotNativeLogs(10);
    spawnSpy.mockRestore();
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.status).toContain("native android");
    const levels = result.entries.map((e) => e.level);
    expect(levels).toContain("warn");
    expect(levels).toContain("error");
    expect(levels).toContain("info");
  });

  it("reports adb spawn failure", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(((cmd: string) => {
      if (cmd === "adb") {
        return mockSpawnResult({error: new Error("not found"), status: undefined});
      }
      if (cmd === "xcrun") {
        return mockSpawnResult({error: new Error("no xcrun"), status: undefined});
      }
      return mockSpawnResult({error: new Error("?"), status: undefined});
    }) as SpawnSyncMock);
    const result = await snapshotNativeLogs(5);
    spawnSpy.mockRestore();
    expect(result.status).toContain("adb failed");
    expect(result.status).toContain("simctl failed");
  });

  it("reports adb non-zero exit", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(((cmd: string) => {
      if (cmd === "adb") {
        return mockSpawnResult({status: 2, stderr: "denied", stdout: ""});
      }
      if (cmd === "xcrun") {
        return mockSpawnResult({error: new Error("no"), status: undefined});
      }
      return mockSpawnResult({error: new Error("?"), status: undefined});
    }) as SpawnSyncMock);
    const result = await snapshotNativeLogs(3);
    spawnSpy.mockRestore();
    expect(result.status).toContain("adb exit 2");
  });

  it("falls back to ios when android stdout is empty", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(((cmd: string) => {
      if (cmd === "adb") {
        return mockSpawnResult({status: 0, stderr: "", stdout: "\n  \n"});
      }
      if (cmd === "xcrun") {
        return mockSpawnResult({status: 0, stderr: "", stdout: "ios one\nios two\n"});
      }
      return mockSpawnResult({error: new Error("?"), status: undefined});
    }) as SpawnSyncMock);
    const result = await snapshotNativeLogs(5);
    spawnSpy.mockRestore();
    expect(result.entries.length).toBe(2);
    expect(result.status).toContain("native ios");
  });

  it("reports ios stream failure when exit non-zero and no lines", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(((cmd: string) => {
      if (cmd === "adb") {
        return mockSpawnResult({status: 0, stderr: "", stdout: ""});
      }
      if (cmd === "xcrun") {
        return mockSpawnResult({status: 3, stderr: "", stdout: "\n"});
      }
      return mockSpawnResult({error: new Error("?"), status: undefined});
    }) as SpawnSyncMock);
    const result = await snapshotNativeLogs(2);
    spawnSpy.mockRestore();
    expect(result.entries).toEqual([]);
    expect(result.status).toContain("log stream failed");
  });

  it("uses TERRENO_ADB_SERIAL when set", async (): Promise<void> => {
    process.env.TERRENO_ADB_SERIAL = "emulator-5554";
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(((
      cmd: string,
      args?: readonly string[]
    ) => {
      if (cmd === "adb") {
        expect(args?.[0]).toBe("-s");
        expect(args?.[1]).toBe("emulator-5554");
        return mockSpawnResult({status: 0, stderr: "", stdout: "I x\n"});
      }
      return mockSpawnResult({error: new Error("skip"), status: 1});
    }) as SpawnSyncMock);
    const result = await snapshotNativeLogs(5);
    spawnSpy.mockRestore();
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("clamps maxLines to 1 minimum", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(((
      cmd: string,
      args?: readonly string[]
    ) => {
      if (cmd === "adb") {
        expect(args).toBeDefined();
        const argv = args as readonly string[];
        const tFlag = argv.indexOf("-t");
        expect(tFlag).toBeGreaterThanOrEqual(0);
        expect(argv[tFlag + 1]).toBe("1");
        return mockSpawnResult({status: 0, stderr: "", stdout: "only\n"});
      }
      return mockSpawnResult({error: new Error("skip"), status: undefined});
    }) as SpawnSyncMock);
    await snapshotNativeLogs(0);
    spawnSpy.mockRestore();
  });
});
