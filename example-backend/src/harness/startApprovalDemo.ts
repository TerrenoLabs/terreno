import type {ScriptContext, ScriptResult} from "@terreno/api";

import {approvalDemo} from "./approvalDemo";
import {getExampleHarness, openExampleHarness} from "./exampleHarness";

const MAX_DEMO_COUNT = 20;
const DEFAULT_PREFIX = "Demo approval";

/**
 * Admin script runner: create `count` (default 2) `demo.approvalDemo` tasks titled
 * `<prefix> <n> of <count>` (default prefix "Demo approval"). Each one waits
 * in the admin approvals inbox. From the CLI the harness is opened without a runner; the
 * API process's runner claims the tasks.
 */
export const startApprovalDemo = async (
  wetRun: boolean,
  ctx?: ScriptContext
): Promise<ScriptResult> => {
  const count = ctx?.args.getNumber("count", 2) ?? 2;
  const prefix = ctx?.args.getString("prefix", DEFAULT_PREFIX)?.trim() || DEFAULT_PREFIX;
  if (!Number.isInteger(count) || count < 1 || count > MAX_DEMO_COUNT) {
    return {results: [`count must be an integer from 1 to ${MAX_DEMO_COUNT}`], success: false};
  }
  if (!wetRun) {
    return {results: [`Dry run: would start ${count} demo.approvalDemo task(s)`], success: true};
  }
  const harness = getExampleHarness() ?? (await openExampleHarness());
  if (!harness) {
    return {results: ["The harness needs MongoDB running as a replica set"], success: false};
  }
  const results: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const title = `${prefix} ${index} of ${count}`;
    const task = await harness.createTask(approvalDemo, {
      payload: {index, requestedFrom: "startHarnessApprovalDemo"},
      title,
    });
    results.push(`Started demo.approvalDemo task ${String(task._id)}: "${title}"`);
  }
  return {results, success: true};
};
