import {afterEach, describe, expect, it, spyOn} from "bun:test";
import * as childProcess from "node:child_process";

import {snapshotNativeLogs} from "./nativeLogs.js";

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
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      (cmd: string): ReturnType<typeof childProcess.spawnSync> => {
        if (cmd === "adb") {
          return {
            error: undefined,
            status: 0,
            stderr: "",
            stdout:
              "I/tag info line\nW/tag warn line\nE/tag error line\nfatal crash\nother error here\n",
          } as ReturnType<typeof childProcess.spawnSync>;
        }
        return {
          error: new Error("ENOENT"),
          status: undefined,
          stderr: "",
          stdout: "",
        } as ReturnType<typeof childProcess.spawnSync>;
      }
    );
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
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      (cmd: string): ReturnType<typeof childProcess.spawnSync> => {
        if (cmd === "adb") {
          return {
            error: new Error("not found"),
            status: undefined,
            stderr: "",
            stdout: "",
          } as ReturnType<typeof childProcess.spawnSync>;
        }
        if (cmd === "xcrun") {
          return {
            error: new Error("no xcrun"),
            stderr: "",
            stdout: "",
          } as ReturnType<typeof childProcess.spawnSync>;
        }
        return {error: new Error("?"), stderr: "", stdout: ""} as ReturnType<
          typeof childProcess.spawnSync
        >;
      }
    );
    const result = await snapshotNativeLogs(5);
    spawnSpy.mockRestore();
    expect(result.status).toContain("adb failed");
    expect(result.status).toContain("simctl failed");
  });

  it("reports adb non-zero exit", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      (cmd: string): ReturnType<typeof childProcess.spawnSync> => {
        if (cmd === "adb") {
          return {
            error: undefined,
            status: 2,
            stderr: "denied",
            stdout: "",
          } as ReturnType<typeof childProcess.spawnSync>;
        }
        if (cmd === "xcrun") {
          return {
            error: new Error("no"),
            stderr: "",
            stdout: "",
          } as ReturnType<typeof childProcess.spawnSync>;
        }
        return {error: new Error("?"), stderr: "", stdout: ""} as ReturnType<
          typeof childProcess.spawnSync
        >;
      }
    );
    const result = await snapshotNativeLogs(3);
    spawnSpy.mockRestore();
    expect(result.status).toContain("adb exit 2");
  });

  it("falls back to ios when android stdout is empty", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      (cmd: string): ReturnType<typeof childProcess.spawnSync> => {
        if (cmd === "adb") {
          return {error: undefined, status: 0, stderr: "", stdout: "\n  \n"} as ReturnType<
            typeof childProcess.spawnSync
          >;
        }
        if (cmd === "xcrun") {
          return {
            error: undefined,
            status: 0,
            stderr: "",
            stdout: "ios one\nios two\n",
          } as ReturnType<typeof childProcess.spawnSync>;
        }
        return {error: new Error("?"), stderr: "", stdout: ""} as ReturnType<
          typeof childProcess.spawnSync
        >;
      }
    );
    const result = await snapshotNativeLogs(5);
    spawnSpy.mockRestore();
    expect(result.entries.length).toBe(2);
    expect(result.status).toContain("native ios");
  });

  it("reports ios stream failure when exit non-zero and no lines", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      (cmd: string): ReturnType<typeof childProcess.spawnSync> => {
        if (cmd === "adb") {
          return {error: undefined, status: 0, stderr: "", stdout: ""} as ReturnType<
            typeof childProcess.spawnSync
          >;
        }
        if (cmd === "xcrun") {
          return {
            error: undefined,
            status: 3,
            stderr: "",
            stdout: "\n",
          } as ReturnType<typeof childProcess.spawnSync>;
        }
        return {error: new Error("?"), stderr: "", stdout: ""} as ReturnType<
          typeof childProcess.spawnSync
        >;
      }
    );
    const result = await snapshotNativeLogs(2);
    spawnSpy.mockRestore();
    expect(result.entries).toEqual([]);
    expect(result.status).toContain("no booted simulator");
  });

  it("uses TERRENO_ADB_SERIAL when set", async (): Promise<void> => {
    process.env.TERRENO_ADB_SERIAL = "emulator-5554";
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      (cmd: string, args?: readonly string[]): ReturnType<typeof childProcess.spawnSync> => {
        if (cmd === "adb") {
          expect(args?.[0]).toBe("-s");
          expect(args?.[1]).toBe("emulator-5554");
          return {error: undefined, status: 0, stderr: "", stdout: "I x\n"} as ReturnType<
            typeof childProcess.spawnSync
          >;
        }
        return {error: new Error("skip"), status: 1, stderr: "", stdout: ""} as ReturnType<
          typeof childProcess.spawnSync
        >;
      }
    );
    const result = await snapshotNativeLogs(5);
    spawnSpy.mockRestore();
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("clamps maxLines to 1 minimum", async (): Promise<void> => {
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      (cmd: string, args?: readonly string[]): ReturnType<typeof childProcess.spawnSync> => {
        if (cmd === "adb") {
          const tFlag = args?.indexOf("-t");
          expect(tFlag).toBeGreaterThanOrEqual(0);
          expect(args?.[tFlag + 1]).toBe("1");
          return {error: undefined, status: 0, stderr: "", stdout: "only\n"} as ReturnType<
            typeof childProcess.spawnSync
          >;
        }
        return {error: new Error("skip"), stderr: "", stdout: ""} as ReturnType<
          typeof childProcess.spawnSync
        >;
      }
    );
    await snapshotNativeLogs(0);
    spawnSpy.mockRestore();
  });
});
