import {afterAll, beforeAll, describe, expect, it, setDefaultTimeout} from "bun:test";
import {createScriptArgs, type ScriptContext} from "@terreno/api";
import {startMongoServer, stopMongoServer} from "@terreno/test";
import mongoose from "mongoose";

import {adminScripts} from "../adminScripts";
import {getExampleHarness, openExampleHarness, startExampleHarness} from "./exampleHarness";
import {startApprovalDemo} from "./startApprovalDemo";

setDefaultTimeout(120_000);

const scriptContext = (values: Record<string, number | string>): ScriptContext => {
  const script = adminScripts.find(({name}) => name === "startHarnessApprovalDemo");
  const {args} = createScriptArgs({defs: script?.args ?? [], values});
  return {
    addLog: async () => {},
    args,
    checkCancellation: async () => {},
    updateProgress: async () => {},
  };
};

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The harness needs a replica set, but the example-backend preload connects a standalone
 * memory server. This file swaps the default connection to a single-node replica set for
 * its own tests and restores the original afterwards.
 */
describe("demo.approvalDemo on a replica set", () => {
  let originalUri: string;
  let harnessSignalHooks: Array<(...args: unknown[]) => void> = [];

  beforeAll(async () => {
    const {host, name, port} = mongoose.connection;
    originalUri = `mongodb://${host}:${port}/${name}`;
    await mongoose.disconnect();
    await startMongoServer({
      baseDatabaseName: "terreno-example-harness-test",
      externalUriEnvVar: "TERRENO_EXAMPLE_HARNESS_TEST_MONGODB_URI",
      useReplSet: true,
    });
  });

  afterAll(async () => {
    // Call only the hooks startExampleHarness added; emitting SIGTERM would also fire
    // listeners other suites registered in this shared test process.
    harnessSignalHooks[0]?.("SIGTERM");
    for (const hook of harnessSignalHooks) {
      process.removeListener("SIGTERM", hook);
      process.removeListener("SIGINT", hook);
    }
    for (let attempt = 0; attempt < 100 && getExampleHarness(); attempt += 1) {
      await Bun.sleep(20);
    }
    await stopMongoServer();
    await mongoose.connect(originalUri);
  });

  // One test for the whole runner lifecycle: the preload wipes every collection after each
  // test, which must not happen under a live runner.
  it("opens one harness, waits for approvals, and completes with each decision", async () => {
    await startExampleHarness();
    expect(getExampleHarness()).toBeUndefined();
    const harness = await openExampleHarness();
    if (!harness) {
      throw new Error("harness not open");
    }
    expect(await openExampleHarness()).toBe(harness);
    const before = new Set([...process.listeners("SIGTERM"), ...process.listeners("SIGINT")]);
    await startExampleHarness();
    harnessSignalHooks = [...process.listeners("SIGTERM"), ...process.listeners("SIGINT")].filter(
      (listener) => !before.has(listener)
    ) as Array<(...args: unknown[]) => void>;
    expect(harnessSignalHooks).toHaveLength(2);

    const result = await startApprovalDemo(true, scriptContext({count: 2, prefix: "Sign off"}));
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toContain('"Sign off 1 of 2"');

    const approvals = mongoose.connection.collection("harnessapprovals");
    for (let attempt = 0; attempt < 250; attempt += 1) {
      if ((await approvals.countDocuments({status: "pending"})) === 2) {
        break;
      }
      await Bun.sleep(20);
    }
    const pending = await approvals.find({status: "pending"}).sort({title: 1}).toArray();
    expect(pending.map((approval) => approval.title)).toEqual([
      "Sign off 1 of 2",
      "Sign off 2 of 2",
    ]);
    expect(pending[0].definitionKey).toBe("demo.approvalDemo@1:demo-signoff");
    expect(pending[0].summary).toContain("**Approve**");
    expect(plain(pending[0].payload)).toEqual({
      index: 1,
      requestedFrom: "startHarnessApprovalDemo",
    });

    const userId = new mongoose.Types.ObjectId();
    await harness.decideApproval(pending[0]._id, {approved: true, userId});
    await harness.decideApproval(pending[1]._id, {
      approved: false,
      reason: "Wrong patient",
      userId,
    });

    const approved = await harness.waitForTask(pending[0].taskId, {timeout: {seconds: 30}});
    const rejected = await harness.waitForTask(pending[1].taskId, {timeout: {seconds: 30}});
    expect(plain(approved.outcome?.result)).toEqual({
      decidedBy: String(userId),
      status: "approved",
    });
    expect(plain(rejected.outcome?.result)).toEqual({
      decidedBy: String(userId),
      reason: "Wrong patient",
      status: "rejected",
    });
  });
});
