import {createRequire} from "node:module";

import {DateTime} from "luxon";

import type {JobDocument} from "../modelTypes";
import type {JobRunner, JobRunnerStartOptions} from "../types";

export interface GcpTimestamp {
  nanos?: number;
  seconds: number;
}

/** protobuf Duration (`google.protobuf.Duration`) — used by `@google-cloud/tasks`. */
export interface GcpDuration {
  nanos?: number;
  seconds: number;
}

export interface GcpHttpRequest {
  body?: string;
  headers?: Record<string, string>;
  httpMethod: "POST";
  oidcToken?: {
    audience?: string;
    serviceAccountEmail: string;
  };
  url: string;
}

export interface GcpTask {
  dispatchDeadline?: GcpDuration;
  httpRequest?: GcpHttpRequest;
  scheduleTime?: GcpTimestamp;
}

export interface GcpCreateTaskRequest {
  parent: string;
  task: GcpTask;
}

export interface GcpCreateTaskResponse {
  name?: string;
}

/** Narrow Cloud Tasks client seam — inject in tests; production loads `@google-cloud/tasks`. */
export interface GcpCloudTasksClient {
  createTask(request: GcpCreateTaskRequest): Promise<[GcpCreateTaskResponse]>;
  queuePath(project: string, location: string, queue: string): string;
}

/** Cloud Tasks HTTP `dispatchDeadline` bounds (15s–30min). Default 30min matches Cloud Run. */
export const GCP_HTTP_TASK_MIN_DISPATCH_DEADLINE_SECONDS = 15;
export const GCP_HTTP_TASK_MAX_DISPATCH_DEADLINE_SECONDS = 1_800;
export const GCP_HTTP_TASK_DEFAULT_DISPATCH_DEADLINE_SECONDS = 1_800;

export interface GcpCloudTasksRunnerConfig {
  basePath?: string;
  /** Injected client for tests. Production wiring loads `@google-cloud/tasks`. */
  client?: GcpCloudTasksClient;
  /**
   * Seconds Cloud Tasks waits for POST /jobs/execute before retrying.
   * HTTP range is 15–1800. Default 1800 so a 30-minute handler is not retried at 10 minutes.
   */
  dispatchDeadlineSeconds?: number;
  location: string;
  oidcAudience?: string;
  project: string;
  publicUrl: string;
  queue: string;
  serviceAccountEmail: string;
}

interface ResolvedGcpCloudTasksRunnerConfig {
  basePath: string;
  dispatchDeadline: GcpDuration;
  location: string;
  oidcAudience?: string;
  project: string;
  publicUrl: string;
  queue: string;
  serviceAccountEmail: string;
}

const nodeRequire = createRequire(__filename);

const requireNonEmpty = (value: string | undefined, label: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`GcpCloudTasksRunner requires ${label}`);
  }
  return trimmed;
};

// A loop instead of `/\/+$/` keeps trimming linear on inputs with long runs of slashes.
const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
};

const normalizePublicUrl = (publicUrl: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(publicUrl);
  } catch {
    throw new Error(
      `GcpCloudTasksRunner publicUrl must be an absolute http(s) URL, received: ${publicUrl}`
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`GcpCloudTasksRunner publicUrl must use http or https, received: ${publicUrl}`);
  }

  return trimTrailingSlashes(parsed.toString());
};

const normalizeBasePath = (basePath: string | undefined): string => {
  const trimmed = (basePath ?? "/jobs").trim();
  if (!trimmed.startsWith("/")) {
    throw new Error(`GcpCloudTasksRunner basePath must start with "/", received: ${basePath}`);
  }
  return trimTrailingSlashes(trimmed) || "/";
};

const validateDispatchDeadlineSeconds = (dispatchDeadlineSeconds: number | undefined): number => {
  if (dispatchDeadlineSeconds === undefined) {
    return GCP_HTTP_TASK_DEFAULT_DISPATCH_DEADLINE_SECONDS;
  }

  if (
    !Number.isFinite(dispatchDeadlineSeconds) ||
    dispatchDeadlineSeconds < GCP_HTTP_TASK_MIN_DISPATCH_DEADLINE_SECONDS ||
    dispatchDeadlineSeconds > GCP_HTTP_TASK_MAX_DISPATCH_DEADLINE_SECONDS
  ) {
    throw new Error(
      `GcpCloudTasksRunner dispatchDeadlineSeconds must be between ${GCP_HTTP_TASK_MIN_DISPATCH_DEADLINE_SECONDS} and ${GCP_HTTP_TASK_MAX_DISPATCH_DEADLINE_SECONDS} seconds`
    );
  }

  return dispatchDeadlineSeconds;
};

const toProtobufDuration = (dispatchDeadlineSeconds: number): GcpDuration => ({
  seconds: dispatchDeadlineSeconds,
});

const resolveConfig = (config: GcpCloudTasksRunnerConfig): ResolvedGcpCloudTasksRunnerConfig => ({
  basePath: normalizeBasePath(config.basePath),
  dispatchDeadline: toProtobufDuration(
    validateDispatchDeadlineSeconds(config.dispatchDeadlineSeconds)
  ),
  location: requireNonEmpty(config.location, "location"),
  oidcAudience: config.oidcAudience?.trim() || undefined,
  project: requireNonEmpty(config.project, "project"),
  publicUrl: normalizePublicUrl(requireNonEmpty(config.publicUrl, "publicUrl")),
  queue: requireNonEmpty(config.queue, "queue"),
  serviceAccountEmail: requireNonEmpty(config.serviceAccountEmail, "serviceAccountEmail"),
});

const loadCloudTasksClient = (): (new () => GcpCloudTasksClient) => {
  try {
    const module = nodeRequire("@google-cloud/tasks") as {
      CloudTasksClient: new () => GcpCloudTasksClient;
    };
    return module.CloudTasksClient;
  } catch {
    throw new Error(
      "GcpCloudTasksRunner requires optional peer dependency @google-cloud/tasks. " +
        "Install it with: bun add @google-cloud/tasks"
    );
  }
};

const buildExecuteUrl = (publicUrl: string, basePath: string): string =>
  `${publicUrl}${basePath}/execute`;

const buildScheduleTime = (runAt: Date): GcpTimestamp | undefined => {
  const scheduled = DateTime.fromJSDate(runAt, {zone: "utc"});
  const now = DateTime.utc();
  if (scheduled <= now) {
    return undefined;
  }

  return {
    nanos: (scheduled.toMillis() % 1000) * 1_000_000,
    seconds: Math.floor(scheduled.toSeconds()),
  };
};

const waitForAbortOrTimeout = (signal: AbortSignal, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, timeoutMs);

    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };

    signal.addEventListener("abort", onAbort, {once: true});
  });

const DEFAULT_SCHEDULE_POLL_INTERVAL_MS = 1_000;

/**
 * Dispatch-only runner that enqueues Cloud Tasks HTTP POST callbacks to
 * `{publicUrl}{basePath}/execute` with an OIDC token.
 *
 * `start()` ticks Mongo schedules so cron rows enqueue Cloud Tasks. It does not
 * claim job rows — execution happens on POST /jobs/execute.
 */
export class GcpCloudTasksRunner implements JobRunner {
  readonly id = "gcp-cloud-tasks";
  readonly requiresExecuteRoute = true;

  private readonly client: GcpCloudTasksClient;
  private readonly config: ResolvedGcpCloudTasksRunnerConfig;
  private pollIntervalMs = DEFAULT_SCHEDULE_POLL_INTERVAL_MS;
  private running = false;
  private stopResolve: (() => void) | undefined;

  constructor(config: GcpCloudTasksRunnerConfig) {
    this.config = resolveConfig(config);
    this.client = config.client ?? new (loadCloudTasksClient())();
  }

  async enqueue(job: JobDocument): Promise<void> {
    const executeUrl = buildExecuteUrl(this.config.publicUrl, this.config.basePath);
    const body = Buffer.from(JSON.stringify({jobId: job._id.toString()})).toString("base64");
    const task: GcpTask = {
      dispatchDeadline: this.config.dispatchDeadline,
      httpRequest: {
        body,
        headers: {
          "Content-Type": "application/json",
        },
        httpMethod: "POST",
        oidcToken: {
          audience: this.config.oidcAudience ?? executeUrl,
          serviceAccountEmail: this.config.serviceAccountEmail,
        },
        url: executeUrl,
      },
    };

    const scheduleTime = buildScheduleTime(job.runAt);
    if (scheduleTime) {
      task.scheduleTime = scheduleTime;
    }

    const parent = this.client.queuePath(
      this.config.project,
      this.config.location,
      this.config.queue
    );

    await this.client.createTask({parent, task});
  }

  async start(options: JobRunnerStartOptions): Promise<void> {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_SCHEDULE_POLL_INTERVAL_MS;
    this.running = true;

    try {
      while (!options.signal.aborted) {
        await options.jobs.reconcileSchedulesIfDirty();
        await options.jobs.tickSchedules();
        if (options.signal.aborted) {
          break;
        }
        await waitForAbortOrTimeout(options.signal, this.pollIntervalMs);
      }
    } finally {
      this.running = false;
      this.stopResolve?.();
      this.stopResolve = undefined;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
  }
}
