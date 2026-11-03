import {beforeEach, describe, expect, it} from "bun:test";
import express from "express";

import {decodeCloudTaskBody, registerCloudTasksMock} from "./cloudTasks";

const cloudTasks = registerCloudTasksMock();

interface TasksModule {
  CloudTasksClient: new () => {
    createTask: (request: unknown) => Promise<[{name: string}]>;
    deleteTask: (request: {name: string}) => Promise<unknown>;
    queuePath: (project: string, location: string, queue: string) => string;
  };
  default: {protos: {google: {cloud: {tasks: {v2: {HttpMethod: {POST: number}}}}}}};
  protos: {google: {cloud: {tasks: {v2: {HttpMethod: {GET: number; POST: number}}}}}};
}

// Not a dependency of this package: the specifier is a variable so tsc does not resolve it,
// and the registered mock serves the import.
const TASKS_MODULE: string = "@google-cloud/tasks";

const loadTasksModule = async (): Promise<TasksModule> =>
  (await import(TASKS_MODULE)) as TasksModule;

const base64Json = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64");

const buildApp = (): {app: express.Application; received: Array<Record<string, unknown>>} => {
  const received: Array<Record<string, unknown>> = [];
  const app = express();
  app.use(express.json());
  app.use(express.text({type: "text/plain"}));
  app.all("/tasks/{*rest}", (req, res) => {
    received.push({
      auth: req.headers.authorization,
      body: req.body,
      method: req.method,
      path: req.originalUrl,
    });
    if (req.path === "/tasks/fail") {
      res.status(500).json({error: "boom"});
      return;
    }
    res.json({ok: true});
  });
  return {app, received};
};

describe("registerCloudTasksMock", () => {
  beforeEach((): void => {
    cloudTasks.reset();
  });

  it("records createTask calls with decoded bodies and default names", async (): Promise<void> => {
    const {CloudTasksClient} = await loadTasksModule();
    const client = new CloudTasksClient();
    const parent = client.queuePath("proj", "us-central1", "jobs");
    expect(parent).toBe("projects/proj/locations/us-central1/queues/jobs");

    const [created] = await client.createTask({
      parent,
      task: {
        httpRequest: {body: base64Json({jobId: "j1"}), httpMethod: "POST", url: "https://x/jobs"},
      },
    });
    await client.createTask({parent, task: {name: `${parent}/tasks/named`}});

    expect(created.name).toBe(`${parent}/tasks/mock-task-1`);
    expect(cloudTasks.CloudTasksClient).toHaveBeenCalledTimes(1);
    expect(cloudTasks.createTask).toHaveBeenCalledTimes(2);
    const tasks = cloudTasks.getEnqueuedTasks();
    expect(tasks.map((task) => task.name)).toEqual([
      `${parent}/tasks/mock-task-1`,
      `${parent}/tasks/named`,
    ]);
    expect(tasks[0]?.body).toEqual({jobId: "j1"});
    expect(tasks[0]?.httpMethod).toBe("POST");
    expect(tasks[1]?.body).toBeUndefined();
    expect(tasks[1]?.parent).toBe(parent);
  });

  it("exposes HttpMethod protos and a default export", async (): Promise<void> => {
    const tasksModule = await loadTasksModule();
    expect(tasksModule.protos.google.cloud.tasks.v2.HttpMethod.POST).toBe(1);
    expect(tasksModule.default.protos.google.cloud.tasks.v2.HttpMethod.POST).toBe(1);
  });

  it("deleteTask removes a task from the queue", async (): Promise<void> => {
    await cloudTasks.client.createTask({parent: "q", task: {name: "q/tasks/a"}});
    await cloudTasks.client.createTask({parent: "q", task: {name: "q/tasks/b"}});
    await cloudTasks.client.deleteTask({name: "q/tasks/a"});
    expect(cloudTasks.getEnqueuedTasks().map((task) => task.name)).toEqual(["q/tasks/b"]);
  });

  it("drains tasks to an Express app, including tasks enqueued while draining", async (): Promise<void> => {
    const {app, received} = buildApp();
    await cloudTasks.client.createTask({
      parent: "q",
      task: {
        httpRequest: {
          body: base64Json({step: 1}),
          headers: {"Content-Type": "application/json"},
          httpMethod: "POST",
          url: "https://api.example.com/tasks/run?source=test",
        },
      },
    });
    await cloudTasks.client.createTask({
      parent: "q",
      task: {
        httpRequest: {
          body: new TextEncoder().encode(JSON.stringify({step: 2})),
          httpMethod: 1,
          url: "https://api.example.com/tasks/run",
        },
      },
    });

    let enqueuedFollowUp = false;
    const drained = await cloudTasks.drainTasks({
      app,
      headers: (task) => {
        if (!enqueuedFollowUp) {
          enqueuedFollowUp = true;
          void cloudTasks.client.createTask({
            parent: "q",
            task: {httpRequest: {httpMethod: 2, url: "https://api.example.com/tasks/follow-up"}},
          });
        }
        return {Authorization: `Bearer ${task.name}`};
      },
    });

    expect(drained).toHaveLength(3);
    expect(received).toEqual([
      {
        auth: "Bearer q/tasks/mock-task-1",
        body: {step: 1},
        method: "POST",
        path: "/tasks/run?source=test",
      },
      {auth: "Bearer q/tasks/mock-task-2", body: {step: 2}, method: "POST", path: "/tasks/run"},
      {
        auth: "Bearer q/tasks/mock-task-3",
        body: undefined,
        method: "GET",
        path: "/tasks/follow-up",
      },
    ]);
    expect(cloudTasks.getEnqueuedTasks()).toHaveLength(0);
    expect(await cloudTasks.drainTasks({app})).toEqual([]);
  });

  it("drains with an explicit path, static headers, and a filter", async (): Promise<void> => {
    const {app, received} = buildApp();
    await cloudTasks.client.createTask({
      parent: "q",
      task: {httpRequest: {body: Buffer.from("plain").toString("base64"), httpMethod: "PUT"}},
    });
    await cloudTasks.client.createTask({parent: "q", task: {name: "q/tasks/skip"}});

    await cloudTasks.drainTasks({
      app,
      filter: (task) => task.name !== "q/tasks/skip",
      headers: {Authorization: "Bearer static", "Content-Type": "text/plain"},
      path: "/tasks/custom",
    });
    await cloudTasks.drainTasks({
      app,
      filter: (task) => task.name === "q/tasks/skip",
      path: (task) => `/tasks/${task.name.split("/").pop()}`,
    });

    expect(received).toEqual([
      {auth: "Bearer static", body: "plain", method: "PUT", path: "/tasks/custom"},
      {auth: undefined, body: undefined, method: "POST", path: "/tasks/skip"},
    ]);
  });

  it("checks response status unless told not to", async (): Promise<void> => {
    const {app} = buildApp();
    const failing = {
      parent: "q",
      task: {httpRequest: {url: "https://api.example.com/tasks/fail"}},
    };
    await cloudTasks.client.createTask(failing);
    await expect(cloudTasks.drainTasks({app})).rejects.toThrow(/returned 500 \(expected 2xx\)/);

    await cloudTasks.client.createTask(failing);
    await expect(cloudTasks.drainTasks({app, expectStatus: 201})).rejects.toThrow(/expected 201/);

    await cloudTasks.client.createTask(failing);
    const [result] = await cloudTasks.drainTasks({app, expectStatus: "any"});
    expect(result?.response.status).toBe(500);

    await cloudTasks.client.createTask({
      parent: "q",
      task: {httpRequest: {url: "https://api.example.com/tasks/ok"}},
    });
    const [ok] = await cloudTasks.drainTasks({app, expectStatus: 200});
    expect(ok?.response.status).toBe(200);
  });

  it("rejects tasks without a URL or with an unknown method", async (): Promise<void> => {
    const {app} = buildApp();
    await cloudTasks.client.createTask({parent: "q", task: {name: "q/tasks/no-url"}});
    await expect(cloudTasks.drainTasks({app})).rejects.toThrow(/has no httpRequest.url/);

    await cloudTasks.client.createTask({
      parent: "q",
      task: {httpRequest: {httpMethod: "TRACE", url: "https://x/tasks/a"}},
    });
    await expect(cloudTasks.drainTasks({app})).rejects.toThrow(/unsupported method TRACE/);

    await cloudTasks.client.createTask({
      parent: "q",
      task: {httpRequest: {httpMethod: 99, url: "https://x/tasks/a"}},
    });
    const [fallback] = await cloudTasks.drainTasks({app});
    expect(fallback?.task.httpMethod).toBe("POST");
  });

  it("throws when tasks keep enqueueing past maxRounds", async (): Promise<void> => {
    const {app} = buildApp();
    const enqueue = (): Promise<unknown> =>
      cloudTasks.client.createTask({
        parent: "q",
        task: {httpRequest: {url: "https://x/tasks/loop"}},
      });
    await enqueue();
    await expect(
      cloudTasks.drainTasks({
        app,
        headers: () => {
          void enqueue();
          return {};
        },
        maxRounds: 2,
      })
    ).rejects.toThrow(/stopped after 2 rounds with 1 task/);
  });

  it("reset clears calls, drained state, and overrides", async (): Promise<void> => {
    cloudTasks.createTask.mockResolvedValueOnce([{name: "override"}]);
    const [overridden] = await cloudTasks.client.createTask({parent: "q", task: {}});
    expect(overridden.name).toBe("override");
    cloudTasks.queuePath.mockReturnValue("custom");
    expect(cloudTasks.client.queuePath("a", "b", "c")).toBe("custom");

    cloudTasks.reset();

    expect(cloudTasks.createTask).toHaveBeenCalledTimes(0);
    expect(cloudTasks.getEnqueuedTasks()).toEqual([]);
    expect(cloudTasks.client.queuePath("a", "b", "c")).toBe("projects/a/locations/b/queues/c");
  });
});

describe("decodeCloudTaskBody", () => {
  it("decodes base64 JSON, raw bytes, plain text, and missing bodies", (): void => {
    expect(decodeCloudTaskBody(base64Json({a: 1}))).toEqual({body: {a: 1}, rawBody: '{"a":1}'});
    expect(decodeCloudTaskBody(new TextEncoder().encode("hi"))).toEqual({
      body: "hi",
      rawBody: "hi",
    });
    expect(decodeCloudTaskBody(null)).toEqual({body: undefined});
    expect(decodeCloudTaskBody(undefined)).toEqual({body: undefined});
  });
});
