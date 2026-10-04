import {describe, expect, it} from "bun:test";
import {createScriptArgs, type ScriptContext} from "@terreno/api";

import {adminScripts} from "../adminScripts";
import {getExampleHarness} from "./exampleHarness";
import {startApprovalDemo} from "./startApprovalDemo";

const contextWith = (values: Record<string, number | string>): ScriptContext => {
  const script = adminScripts.find(({name}) => name === "startHarnessApprovalDemo");
  const {args} = createScriptArgs({defs: script?.args ?? [], values});
  return {
    addLog: async () => {},
    args,
    checkCancellation: async () => {},
    updateProgress: async () => {},
  };
};

describe("startHarnessApprovalDemo admin script", () => {
  it("is registered for the admin script runner", () => {
    const script = adminScripts.find(({name}) => name === "startHarnessApprovalDemo");
    expect(script?.runner).toBe(startApprovalDemo);
  });

  it("reports a dry run with the default count", async () => {
    const result = await startApprovalDemo(false, contextWith({}));
    expect(result).toEqual({
      results: ["Dry run: would start 2 demo.approvalDemo task(s)"],
      success: true,
    });
  });

  it("reports the requested count and ignores a blank prefix", async () => {
    const result = await startApprovalDemo(false, contextWith({count: 3, prefix: "  "}));
    expect(result.results).toEqual(["Dry run: would start 3 demo.approvalDemo task(s)"]);
  });

  it("rejects a count outside 1-20", async () => {
    const result = await startApprovalDemo(true, contextWith({count: 0}));
    expect(result.success).toBe(false);
    expect(result.results[0]).toContain("count must be an integer from 1 to 20");
  });

  // The example-backend preload connects a standalone memory server, which this relies on.
  it("fails clearly when MongoDB is not a replica set", async () => {
    const result = await startApprovalDemo(true, contextWith({count: 1}));
    expect(result).toEqual({
      results: ["The harness needs MongoDB running as a replica set"],
      success: false,
    });
    expect(getExampleHarness()).toBeUndefined();
  });
});
