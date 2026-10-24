import {
  APIError,
  BackgroundTask,
  createScriptArgs,
  logger,
  type ScriptArgDef,
  type ScriptArgs,
  type ScriptArgValue,
  type ScriptContext,
  type ScriptResult,
  type ScriptRunner,
  TaskCancelledError,
} from "@terreno/api";
import {Job, type JobDefinition, type JobHandlerContext, tryGetJobsService} from "@terreno/jobs";
import {DateTime} from "luxon";

export interface AdminScriptJobTarget {
  args?: ScriptArgDef[];
  name: string;
  runner: ScriptRunner;
}

/** Durable job name for admin panel script runs. */
export const ADMIN_SCRIPT_JOB_NAME = "admin/script";

export interface AdminScriptJobPayload {
  args: Record<string, ScriptArgValue>;
  createdByName?: string;
  scriptName: string;
  taskId: string;
  wetRun: boolean;
}

export interface JobsDefineHost {
  define: (name: string, definition: JobDefinition) => unknown;
}

const isScriptArgValue = (value: unknown): value is ScriptArgValue => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => typeof entry === "string");
};

const parseAdminScriptJobPayload = (payload: unknown): AdminScriptJobPayload | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.scriptName !== "string" || record.scriptName.length === 0) {
    return undefined;
  }
  if (typeof record.taskId !== "string" || record.taskId.length === 0) {
    return undefined;
  }
  if (typeof record.wetRun !== "boolean") {
    return undefined;
  }
  const args: Record<string, ScriptArgValue> = {};
  if (record.args !== undefined) {
    if (!record.args || typeof record.args !== "object" || Array.isArray(record.args)) {
      return undefined;
    }
    for (const [key, value] of Object.entries(record.args as Record<string, unknown>)) {
      if (!isScriptArgValue(value)) {
        return undefined;
      }
      args[key] = value;
    }
  }
  const createdByName = typeof record.createdByName === "string" ? record.createdByName : undefined;
  return {
    args,
    createdByName,
    scriptName: record.scriptName,
    taskId: record.taskId,
    wetRun: record.wetRun,
  };
};

const isAbortLike = (error: unknown): boolean => {
  if (error instanceof TaskCancelledError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || error.name === "TaskCancelledError";
};

/**
 * Run an admin script against its BackgroundTask row. `requirePending` makes the run conditional
 * on winning the task's pending -> running transition, so a durable job delivered twice never
 * starts the script twice. The in-process path creates its task already running and omits it.
 */
export const runRegisteredScriptTask = async ({
  args,
  requirePending = false,
  script,
  signal,
  taskId,
  wetRun,
}: {
  args: ScriptArgs;
  requirePending?: boolean;
  script: AdminScriptJobTarget;
  signal?: AbortSignal;
  taskId: string;
  wetRun: boolean;
}): Promise<void> => {
  const now = DateTime.now().toJSDate();
  const started = await BackgroundTask.findOneAndUpdate(
    {_id: taskId, status: requirePending ? "pending" : {$in: ["pending", "running"]}},
    {
      $set: {
        progress: {message: "Starting...", percentage: 0, stage: "Running"},
        startedAt: now,
        status: "running",
      },
    }
  );

  if (!started && requirePending) {
    const current = await BackgroundTask.findById(taskId);
    if (current?.status === "cancelled") {
      return;
    }
    throw new APIError({
      detail: `Task ${taskId} is ${current?.status ?? "missing"}`,
      status: 409,
      title: "Admin script task already started",
    });
  }

  const ctx: ScriptContext = {
    addLog: async (level, message) => {
      const current = await BackgroundTask.findById(taskId);
      if (current) {
        await current.addLog(level, message);
      }
    },
    args,
    checkCancellation: async () => {
      if (signal?.aborted) {
        throw new TaskCancelledError(taskId);
      }
      await BackgroundTask.checkCancellation(taskId);
    },
    updateProgress: async (percentage, stage, message) => {
      const current = await BackgroundTask.findById(taskId);
      if (current) {
        await current.updateProgress(percentage, stage, message);
      }
    },
  };

  try {
    await ctx.checkCancellation();
    const result: ScriptResult = await script.runner(wetRun, ctx);
    await BackgroundTask.findOneAndUpdate(
      {_id: taskId, status: "running"},
      {
        $set: {
          completedAt: DateTime.now().toJSDate(),
          progress: {message: "Done", percentage: 100, stage: "Complete"},
          result: result.results,
          status: result.success ? "completed" : "failed",
        },
      }
    );
  } catch (err: unknown) {
    if (isAbortLike(err)) {
      await BackgroundTask.findOneAndUpdate(
        {_id: taskId, status: {$in: ["pending", "running"]}},
        {
          $set: {
            completedAt: DateTime.now().toJSDate(),
            status: "cancelled",
          },
        }
      );
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Script ${script.name} failed: ${message}`);
    await BackgroundTask.findOneAndUpdate(
      {_id: taskId, status: "running"},
      {
        $set: {
          completedAt: DateTime.now().toJSDate(),
          error: message,
          result: [message],
          status: "failed",
        },
      }
    );
  }
};

const createAdminScriptHandler = (
  getScript: (name: string) => AdminScriptJobTarget | undefined
): JobDefinition["handler"] => {
  return async (payload: unknown, ctx: JobHandlerContext): Promise<void> => {
    const parsed = parseAdminScriptJobPayload(payload);
    if (!parsed) {
      throw new APIError({status: 400, title: "Invalid admin/script job payload"});
    }

    const script = getScript(parsed.scriptName);
    if (!script) {
      const message = `Script not found: ${parsed.scriptName}`;
      await BackgroundTask.findOneAndUpdate(
        {_id: parsed.taskId, status: {$in: ["pending", "running"]}},
        {
          $set: {
            completedAt: DateTime.now().toJSDate(),
            error: message,
            result: [message],
            status: "failed",
          },
        }
      );
      throw new APIError({status: 404, title: message});
    }

    const {args, errors} = createScriptArgs({
      defs: script.args ?? [],
      values: parsed.args,
    });
    if (errors.length > 0) {
      throw new APIError({status: 400, title: errors.join("; ")});
    }

    await runRegisteredScriptTask({
      args,
      requirePending: true,
      script,
      signal: ctx.signal,
      taskId: parsed.taskId,
      wetRun: parsed.wetRun,
    });
  };
};

/** Register the shared `admin/script` handler (maxAttempts 1 — scripts are not assumed idempotent). */
export const defineAdminScriptJob = (
  jobs: JobsDefineHost,
  getScript: (name: string) => AdminScriptJobTarget | undefined
): void => {
  jobs.define(ADMIN_SCRIPT_JOB_NAME, {
    handler: createAdminScriptHandler(getScript),
    retry: {maxAttempts: 1},
  });
};

export const tryEnqueueAdminScriptJob = async (
  payload: AdminScriptJobPayload
): Promise<{id: string} | undefined> => {
  const jobs = tryGetJobsService();
  if (!jobs?.getDefinition(ADMIN_SCRIPT_JOB_NAME)) {
    return undefined;
  }
  const job = await jobs.enqueue({
    idempotencyKey: `admin-script:${payload.taskId}`,
    name: ADMIN_SCRIPT_JOB_NAME,
    payload,
  });
  return {id: String(job._id)};
};

export const tryCancelAdminScriptJob = async (taskId: string): Promise<void> => {
  const jobs = tryGetJobsService();
  if (!jobs) {
    return;
  }
  const job = await Job.findOneOrNone({
    name: ADMIN_SCRIPT_JOB_NAME,
    "payload.taskId": taskId,
  });
  if (!job) {
    return;
  }
  try {
    await jobs.adminCancelJob(String(job._id));
  } catch {
    // Job may already be terminal; BackgroundTask cancel is the operator contract.
  }
};
