import {afterEach, describe, expect, it} from "bun:test";
import {createScriptArgs, type ScriptContext} from "@terreno/api";
import mongoose from "mongoose";

import {adminScripts} from "../adminScripts";
import {FakePatientChart} from "../models/fakePatientChart";
import {useReplicaSetConnection} from "../tests/harnessTestHelpers";
import {getExampleHarness, stopExampleHarness} from "./exampleHarness";
import {startClinicalIntake} from "./startClinicalIntake";

const contextWith = (values: Record<string, string>): ScriptContext => {
  const script = adminScripts.find(({name}) => name === "startClinicalIntake");
  const {args} = createScriptArgs({defs: script?.args ?? [], values});
  return {
    addLog: async () => {},
    args,
    checkCancellation: async () => {},
    updateProgress: async () => {},
  };
};

const tasksFor = (requestId: string) =>
  mongoose.connection.collection("harnesstasks").find({requestId}).toArray();

describe("startClinicalIntake on a replica set", () => {
  useReplicaSetConnection("terreno-example-start-clinical-intake-test");

  // The script opens the process-wide harness; forget it so other files see a closed one.
  afterEach(async () => {
    await stopExampleHarness();
  });

  it("opens the harness and creates one pending intake task per requestId", async () => {
    await FakePatientChart.create({dateOfBirth: "1990-01-01", name: "A", patientId: "p-1001"});

    const first = await startClinicalIntake(true, contextWith({}));
    expect(first.success).toBe(true);
    expect(getExampleHarness()).toBeDefined();
    const [task] = await tasksFor("intake-p-1001");
    expect(task).toMatchObject({name: "clinic.intakeSummary", status: "pending"});
    expect(first.results).toEqual([
      `clinic.intakeSummary task ${String(task._id)} for p-1001 is pending (requestId intake-p-1001, trace ${String(task.traceId)})`,
    ]);

    // A repeat with the same requestId returns the first run instead of starting another.
    const repeat = await startClinicalIntake(true, contextWith({}));
    expect(repeat).toEqual(first);
    expect(await tasksFor("intake-p-1001")).toHaveLength(1);

    const again = await startClinicalIntake(true, contextWith({requestId: "intake-p-1001-b"}));
    expect(again.success).toBe(true);
    const [second] = await tasksFor("intake-p-1001-b");
    expect(String(second._id)).not.toBe(String(task._id));
    expect(second.input).toEqual({patientId: "p-1001"});
  });
});
