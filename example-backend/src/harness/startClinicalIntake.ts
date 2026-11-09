import type {ScriptContext, ScriptResult} from "@terreno/api";

import {FakePatientChart} from "../models/fakePatientChart";
import {getExampleClinicalIntake, getExampleHarness, openExampleHarness} from "./exampleHarness";

/** First chart `bun run seed` creates; the default patient for a demo run. */
export const DEFAULT_INTAKE_PATIENT_ID = "p-1001";

/**
 * Admin script runner: start one `clinic.intakeSummary` run for `patientId` (default
 * `p-1001`). The run is idempotent on `requestId` (default `intake-<patientId>`): a repeat
 * returns the first run, so pass a new `requestId` to summarize the same patient again.
 * From the CLI the runner is never started; the API process's runner claims the task.
 */
export const startClinicalIntake = async (
  wetRun: boolean,
  ctx?: ScriptContext
): Promise<ScriptResult> => {
  const patientId =
    ctx?.args.getString("patientId", DEFAULT_INTAKE_PATIENT_ID)?.trim() ||
    DEFAULT_INTAKE_PATIENT_ID;
  const requestId = ctx?.args.getString("requestId", "")?.trim() || `intake-${patientId}`;
  if (!wetRun) {
    return {
      results: [`Dry run: would start clinic.intakeSummary for ${patientId} (${requestId})`],
      success: true,
    };
  }
  if (!(await FakePatientChart.exists({patientId}))) {
    return {
      results: [`No chart for patient ${patientId}; run \`bun run seed\` or pass a seeded id`],
      success: false,
    };
  }
  const harness = getExampleHarness() ?? (await openExampleHarness());
  const clinicalIntake = getExampleClinicalIntake();
  if (!harness || !clinicalIntake) {
    return {results: ["The harness needs MongoDB running as a replica set"], success: false};
  }
  const task = await harness.createTask(clinicalIntake.intakeSummary, {patientId}, {requestId});
  return {
    results: [
      `clinic.intakeSummary task ${String(task._id)} for ${patientId} is ${task.status} (requestId ${requestId}, trace ${String(task.traceId)})`,
    ],
    success: true,
  };
};
