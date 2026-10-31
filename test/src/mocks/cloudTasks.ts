import {type Mock, mock} from "bun:test";
import type express from "express";
import supertest from "supertest";

import {createMockGroup} from "./mockGroup";

/** protobuf Timestamp / Duration as `@google-cloud/tasks` accepts them. */
export interface CloudTasksTime {
  nanos?: number | null;
  seconds?: number | string | null;
}

export interface CloudTasksHttpRequest {
  /** Base64 string (what the REST surface sends) or raw bytes. */
  body?: string | Uint8Array | null;
  headers?: Record<string, string> | null;
  /** `"POST"` or the numeric `protos.google.cloud.tasks.v2.HttpMethod` value. */
  httpMethod?: string | number | null;
  oidcToken?: {audience?: string | null; serviceAccountEmail?: string | null} | null;
  url?: string | null;
}

export interface CloudTasksTask {
  dispatchDeadline?: CloudTasksTime | null;
  httpRequest?: CloudTasksHttpRequest | null;
  name?: string | null;
  scheduleTime?: CloudTasksTime | null;
}

export interface CloudTasksCreateTaskRequest {
  parent?: string | null;
  task?: CloudTasksTask | null;
}

/** A task the mock accepted, with its body decoded. */
export interface EnqueuedCloudTask {
  /** Body parsed as JSON; the decoded string when it is not JSON; undefined when absent. */
  body: unknown;
  headers: Record<string, string>;
  httpMethod: string;
  name: string;
  parent: string;
  /** The decoded body text before JSON parsing. */
  rawBody?: string;
  request: CloudTasksCreateTaskRequest;
  url?: string;
}

export interface DrainCloudTasksOptions {
  app: express.Application;
  /** Exact status every dispatch must return, `"2xx"` (default), or `"any"` to skip the check. */
  expectStatus?: number | "2xx" | "any";
  /** Only dispatch matching tasks; the rest stay enqueued. */
  filter?: (task: EnqueuedCloudTask) => boolean;
  /** Extra request headers (e.g. an auth header your execute route checks). */
  headers?: Record<string, string> | ((task: EnqueuedCloudTask) => Record<string, string>);
  /** Rounds to drain tasks enqueued by dispatched tasks. Default 10; throws if work remains. */
  maxRounds?: number;
  /** Request path. Default: the path and query of the task's `httpRequest.url`. */
  path?: string | ((task: EnqueuedCloudTask) => string);
}

export interface DrainedCloudTask {
  response: supertest.Response;
  task: EnqueuedCloudTask;
}

export interface CloudTasksMockClient {
  createTask: Mock<
    (request: CloudTasksCreateTaskRequest) => Promise<[CloudTasksTask & {name: string}]>
  >;
  deleteTask: Mock<(request: {name?: string | null}) => Promise<[Record<string, never>]>>;
  queuePath: Mock<(project: string, location: string, queue: string) => string>;
}

export interface CloudTasksMock extends CloudTasksMockClient {
  /** Constructor registered as `CloudTasksClient`; every instance is `client`. */
  CloudTasksClient: Mock<() => CloudTasksMockClient>;
  client: CloudTasksMockClient;
  /** Dispatches enqueued tasks to `app` with supertest, in enqueue order. */
  drainTasks: (options: DrainCloudTasksOptions) => Promise<DrainedCloudTask[]>;
  /** Tasks created and not yet drained or deleted. */
  getEnqueuedTasks: () => EnqueuedCloudTask[];
  /** Clears calls, drained state, and overrides. */
  reset: () => void;
}

const HTTP_METHODS_BY_NUMBER: Record<number, string> = {
  1: "POST",
  2: "GET",
  3: "HEAD",
  4: "PUT",
  5: "DELETE",
  6: "PATCH",
  7: "OPTIONS",
};

type SupertestMethod = "delete" | "get" | "head" | "options" | "patch" | "post" | "put";

const SUPPORTED_METHODS = new Set<string>([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
]);

const CLOUD_TASKS_PROTOS = {
  google: {
    cloud: {
      tasks: {
        v2: {
          HttpMethod: {
            DELETE: 5,
            GET: 2,
            HEAD: 3,
            HTTP_METHOD_UNSPECIFIED: 0,
            OPTIONS: 7,
            PATCH: 6,
            POST: 1,
            PUT: 4,
          },
        },
      },
    },
  },
} as const;

/** Decodes a Cloud Tasks HTTP body (base64 string or bytes) and parses it as JSON when it can. */
export const decodeCloudTaskBody = (
  body: string | Uint8Array | null | undefined
): {body: unknown; rawBody?: string} => {
  if (body === null || body === undefined) {
    return {body: undefined};
  }
  const rawBody =
    typeof body === "string"
      ? Buffer.from(body, "base64").toString("utf8")
      : Buffer.from(body).toString("utf8");
  try {
    return {body: JSON.parse(rawBody), rawBody};
  } catch {
    return {body: rawBody, rawBody};
  }
};

const resolveHttpMethod = (httpMethod: string | number | null | undefined): string => {
  if (typeof httpMethod === "number") {
    return HTTP_METHODS_BY_NUMBER[httpMethod] ?? "POST";
  }
  return httpMethod ? httpMethod.toUpperCase() : "POST";
};

const defaultTaskName = (parent: string, index: number): string =>
  `${parent}/tasks/mock-task-${index + 1}`;

const toEnqueuedTask = (request: CloudTasksCreateTaskRequest, index: number): EnqueuedCloudTask => {
  const parent = request.parent ?? "";
  const httpRequest = request.task?.httpRequest ?? undefined;
  return {
    ...decodeCloudTaskBody(httpRequest?.body),
    headers: {...(httpRequest?.headers ?? {})},
    httpMethod: resolveHttpMethod(httpRequest?.httpMethod),
    name: request.task?.name ?? defaultTaskName(parent, index),
    parent,
    request,
    url: httpRequest?.url ?? undefined,
  };
};

const resolveTaskPath = (task: EnqueuedCloudTask, path: DrainCloudTasksOptions["path"]): string => {
  if (typeof path === "function") {
    return path(task);
  }
  if (path) {
    return path;
  }
  if (!task.url) {
    throw new Error(`Cloud task ${task.name} has no httpRequest.url; pass drainTasks({path})`);
  }
  const url = new URL(task.url, "http://localhost");
  return `${url.pathname}${url.search}`;
};

const assertStatus = (
  task: EnqueuedCloudTask,
  response: supertest.Response,
  expectStatus: NonNullable<DrainCloudTasksOptions["expectStatus"]>
): void => {
  if (expectStatus === "any") {
    return;
  }
  const isExpected =
    expectStatus === "2xx"
      ? response.status >= 200 && response.status < 300
      : response.status === expectStatus;
  if (!isExpected) {
    throw new Error(
      `Cloud task ${task.name} returned ${response.status} (expected ${expectStatus}): ${JSON.stringify(response.body)}`
    );
  }
};

const dispatchTask = async ({
  options,
  task,
}: {
  options: DrainCloudTasksOptions;
  task: EnqueuedCloudTask;
}): Promise<supertest.Response> => {
  const path = resolveTaskPath(task, options.path);
  const extraHeaders =
    typeof options.headers === "function" ? options.headers(task) : (options.headers ?? {});
  const method = task.httpMethod.toLowerCase();
  if (!SUPPORTED_METHODS.has(method)) {
    throw new Error(`Cloud task ${task.name} uses unsupported method ${task.httpMethod}`);
  }
  const agent = supertest(options.app);
  const start = agent[method as SupertestMethod].bind(agent);
  const headers = {...task.headers, ...extraHeaders};
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (!hasContentType && task.rawBody !== undefined && task.body !== task.rawBody) {
    headers["Content-Type"] = "application/json";
  }
  const request = start(path).set(headers);
  if (task.rawBody === undefined) {
    return request;
  }
  return request.send(task.rawBody);
};

/**
 * Registers `mock.module("@google-cloud/tasks", ...)`. Call once (e.g. in a preload), call
 * `reset()` in `beforeEach`, and inject nothing: code that does `new CloudTasksClient()` gets
 * the shared `client`. `@google-cloud/tasks` does not need to be installed.
 */
export const registerCloudTasksMock = (): CloudTasksMock => {
  const group = createMockGroup();
  const consumed = new Set<number>();

  const createTask = group.fn(
    async (request: CloudTasksCreateTaskRequest): Promise<[CloudTasksTask & {name: string}]> => {
      const index = createTask.mock.calls.length - 1;
      const name = request.task?.name ?? defaultTaskName(request.parent ?? "", index);
      return [{...(request.task ?? {}), name}];
    }
  );

  const getEnqueuedEntries = (): Array<{index: number; task: EnqueuedCloudTask}> =>
    createTask.mock.calls
      .map(([request], index) => ({index, task: toEnqueuedTask(request, index)}))
      .filter(({index}) => !consumed.has(index));

  const deleteTask = group.fn(
    async (request: {name?: string | null}): Promise<[Record<string, never>]> => {
      for (const entry of getEnqueuedEntries()) {
        if (entry.task.name === request.name) {
          consumed.add(entry.index);
        }
      }
      return [{}];
    }
  );

  const queuePath = group.fn(
    (project: string, location: string, queue: string): string =>
      `projects/${project}/locations/${location}/queues/${queue}`
  );

  const client: CloudTasksMockClient = {createTask, deleteTask, queuePath};
  const CloudTasksClient = group.fn((): CloudTasksMockClient => client);

  const drainTasks = async (options: DrainCloudTasksOptions): Promise<DrainedCloudTask[]> => {
    const maxRounds = options.maxRounds ?? 10;
    const expectStatus = options.expectStatus ?? "2xx";
    const matches = (): Array<{index: number; task: EnqueuedCloudTask}> =>
      getEnqueuedEntries().filter(({task}) => (options.filter ? options.filter(task) : true));
    const drained: DrainedCloudTask[] = [];

    for (let round = 0; ; round += 1) {
      const batch = matches();
      if (batch.length === 0) {
        return drained;
      }
      if (round >= maxRounds) {
        throw new Error(
          `drainTasks stopped after ${maxRounds} rounds with ${batch.length} task(s) still enqueued`
        );
      }
      for (const {index, task} of batch) {
        consumed.add(index);
        const response = await dispatchTask({options, task});
        assertStatus(task, response, expectStatus);
        drained.push({response, task});
      }
    }
  };

  const reset = (): void => {
    group.reset();
    consumed.clear();
  };

  const moduleExports = {
    CloudTasksClient,
    protos: CLOUD_TASKS_PROTOS,
    v2: {CloudTasksClient},
  };
  mock.module("@google-cloud/tasks", () => ({...moduleExports, default: moduleExports}));

  return {
    CloudTasksClient,
    client,
    createTask,
    deleteTask,
    drainTasks,
    getEnqueuedTasks: (): EnqueuedCloudTask[] => getEnqueuedEntries().map(({task}) => task),
    queuePath,
    reset,
  };
};
