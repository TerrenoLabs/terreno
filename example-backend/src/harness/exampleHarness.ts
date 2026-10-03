import {createLocalObservabilityPlugin} from "@terreno/ai";
import {Harness, InProcessRunner, type InProcessRunnerOptions} from "@terreno/ai/harness";
import {logger} from "@terreno/api";

import {approvalDemo} from "./approvalDemo";
import {type ClinicalIntake, createClinicalIntake} from "./clinicalIntake";
import {clinicSummarizerModels, resolveExampleModel} from "./clinicModels";

let exampleHarness: Harness | undefined;
let exampleClinicalIntake: ClinicalIntake | undefined;

/**
 * `HARNESS_LEASE_SECONDS` (default 30): owner and task lease length, with heartbeats every
 * third of it. A crashed process's work is taken over once its leases expire, so a short
 * lease (the crash test uses 3) makes recovery fast; keep the default in production.
 */
export const exampleRunnerOptions = (): InProcessRunnerOptions => {
  const seconds = Number(process.env.HARNESS_LEASE_SECONDS ?? "");
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return {};
  }
  return {
    heartbeatInterval: {milliseconds: Math.floor((seconds * 1000) / 3)},
    leaseDuration: {seconds},
  };
};

const isMissingReplicaSet = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("requires a MongoDB replica set");

/**
 * Open the process-wide example harness once. Returns `undefined` (and logs) when Mongo is
 * not a replica set, so a standalone `mongod` (unit tests, quick local runs) still boots
 * without the harness routes. Registers the local observability models (the audit log)
 * itself, so scripts outside the API process can open it too.
 */
export const openExampleHarness = async (): Promise<Harness | undefined> => {
  if (exampleHarness) {
    return exampleHarness;
  }
  createLocalObservabilityPlugin();
  const clinicalIntake = createClinicalIntake(clinicSummarizerModels());
  try {
    exampleHarness = await Harness.open({
      models: resolveExampleModel,
      registry: [approvalDemo, clinicalIntake.intakeSummary, clinicalIntake.summarizer],
      runner: new InProcessRunner(exampleRunnerOptions()),
    });
  } catch (error: unknown) {
    if (!isMissingReplicaSet(error)) {
      throw error;
    }
    logger.warn("Harness disabled: MongoDB is not a replica set");
    return undefined;
  }
  exampleClinicalIntake = clinicalIntake;
  logger.info(
    `[harness] clinic.summarizer uses ${clinicalIntake.summarizer.model.provider}/${clinicalIntake.summarizer.model.modelId}`
  );
  return exampleHarness;
};

/** The harness opened by `openExampleHarness`, or `undefined` when it is not open. */
export const getExampleHarness = (): Harness | undefined => exampleHarness;

/** The clinical tracer definitions registered in the open harness. */
export const getExampleClinicalIntake = (): ClinicalIntake | undefined => exampleClinicalIntake;

/** Stop the runner (waiting for the phase in flight) and forget the harness. */
const stopExampleHarness = async (): Promise<void> => {
  const harness = exampleHarness;
  exampleHarness = undefined;
  exampleClinicalIntake = undefined;
  await harness?.stop();
};

/**
 * Start the runner of the opened harness and stop it on SIGTERM/SIGINT, so a phase in
 * flight finishes and its lease is released. Call once per process, after
 * `openExampleHarness`. No-op when the harness is not open.
 */
export const startExampleHarness = async (): Promise<void> => {
  if (!exampleHarness) {
    return;
  }
  await exampleHarness.start();
  logger.info("[harness] Runner started in API process");
  const shutdown = (signal: string): void => {
    logger.info(`[harness] Received ${signal}, stopping runner`);
    stopExampleHarness().catch((error: unknown) => {
      logger.error(`[harness] Runner shutdown failed: ${String(error)}`);
    });
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      shutdown(signal);
    });
  }
};
