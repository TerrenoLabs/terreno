import type {HarnessCommit, HarnessTaskRuntime} from "../types/harness";
import type {HarnessCommitWrites} from "./commit";

/** Key of the engine-only runtime surface; never part of the public `rt`. */
export const HARNESS_INTERNAL_RUNTIME = Symbol("terreno.harness.internalRuntime");

/** Engine-only extras built-in tasks (the agent turn) need beyond the public runtime. */
export interface HarnessInternalRuntime {
  /** `rt.commit` plus extra rows written in the same transaction. */
  commitWithWrites: (
    next: HarnessCommit<unknown, unknown>,
    writes: HarnessCommitWrites
  ) => Promise<void>;
}

type RuntimeWithInternals = HarnessTaskRuntime<unknown, unknown> & {
  [HARNESS_INTERNAL_RUNTIME]?: HarnessInternalRuntime;
};

/** The internal surface of a runtime built by the engine. Throws for any other object. */
export const internalRuntime = (
  rt: HarnessTaskRuntime<unknown, unknown>
): HarnessInternalRuntime => {
  const internals = (rt as RuntimeWithInternals)[HARNESS_INTERNAL_RUNTIME];
  if (!internals) {
    throw new Error("This runtime was not built by the harness engine");
  }
  return internals;
};
