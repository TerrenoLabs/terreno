import {describe, expect, it} from "bun:test";
import {createScriptArgs, type ScriptContext} from "@terreno/api";

import {adminScripts} from "../adminScripts";
import {FakePatientChart} from "../models/fakePatientChart";
import {exampleRunnerOptions, getExampleHarness} from "./exampleHarness";
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

describe("startClinicalIntake admin script", () => {
  it("is registered for the admin script runner", () => {
    const script = adminScripts.find(({name}) => name === "startClinicalIntake");
    expect(script?.runner).toBe(startClinicalIntake);
    expect(script?.args?.map((arg) => arg.name)).toEqual(["patientId", "requestId"]);
  });

  it("reports a dry run for the default patient and request id", async () => {
    expect(await startClinicalIntake(false, contextWith({}))).toEqual({
      results: ["Dry run: would start clinic.intakeSummary for p-1001 (intake-p-1001)"],
      success: true,
    });
    expect(
      (await startClinicalIntake(false, contextWith({patientId: " p-7 ", requestId: "again"})))
        .results
    ).toEqual(["Dry run: would start clinic.intakeSummary for p-7 (again)"]);
  });

  it("refuses a patient without a chart", async () => {
    expect(await startClinicalIntake(true, contextWith({patientId: "p-404"}))).toEqual({
      results: ["No chart for patient p-404; run `bun run seed` or pass a seeded id"],
      success: false,
    });
  });

  // The example-backend preload connects a standalone memory server, which this relies on.
  it("fails clearly when MongoDB is not a replica set", async () => {
    await FakePatientChart.create({dateOfBirth: "1990-01-01", name: "A", patientId: "p-1001"});
    expect(await startClinicalIntake(true)).toEqual({
      results: ["The harness needs MongoDB running as a replica set"],
      success: false,
    });
    expect(getExampleHarness()).toBeUndefined();
  });
});

describe("exampleRunnerOptions", () => {
  it("uses the runner defaults unless HARNESS_LEASE_SECONDS is a positive number", () => {
    expect(exampleRunnerOptions()).toEqual({});
    process.env.HARNESS_LEASE_SECONDS = "abc";
    expect(exampleRunnerOptions()).toEqual({});
    process.env.HARNESS_LEASE_SECONDS = "-1";
    expect(exampleRunnerOptions()).toEqual({});
    process.env.HARNESS_LEASE_SECONDS = "3";
    expect(exampleRunnerOptions()).toEqual({
      heartbeatInterval: {milliseconds: 1000},
      leaseDuration: {seconds: 3},
    });
  });
});
