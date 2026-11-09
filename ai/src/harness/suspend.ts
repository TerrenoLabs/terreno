/**
 * Unwinds a phase that committed `waiting`; the runner stops the task without failing it.
 * Code that wraps user callbacks (hooks, tools) must rethrow it untouched.
 */
export class HarnessSuspendSignal extends Error {
  constructor(taskId: string) {
    super(`Harness task ${taskId} is waiting; the phase re-runs when the wait is satisfied`);
    this.name = "HarnessSuspendSignal";
  }
}

export const isHarnessSuspendSignal = (error: unknown): error is HarnessSuspendSignal =>
  error instanceof HarnessSuspendSignal;
