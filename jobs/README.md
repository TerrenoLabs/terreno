# @terreno/jobs

Durable background jobs for Terreno backends — Mongo-backed queues with pluggable
runners, retries, schedules, dead letters, and admin operations.

## Install

```bash
bun add @terreno/jobs
```

Peer dependency: `mongoose ^8.0.0 || ^9.0.0`. Optional peers for cloud runners:
`@google-cloud/tasks`, `@vercel/queue`.

## Quick start

```typescript
import {JobsApp, MongoJobRunner, getJobsService} from "@terreno/jobs";
import {TerrenoApp} from "@terreno/api";
import {User} from "./models/user";

const jobsApp = new JobsApp({runner: new MongoJobRunner()});

jobsApp.define("my/task", {
  handler: async (_payload, ctx) => {
    ctx.log.info("running");
  },
});

new TerrenoApp({userModel: User}).register(jobsApp).start();

await jobsApp.startWorker();
await getJobsService().enqueue({name: "my/task", payload: {}});
```

`JobsApp.register()` does not start a worker. Call `startWorker()` from the API
process or a dedicated worker entrypoint.

## What's included

- `JobsApp` — TerrenoPlugin for definitions, admin routes, and optional execute HTTP
- `MongoJobRunner` — default in-process poll loop over MongoDB
- `GcpCloudTasksRunner` — `@terreno/jobs/runners/gcpCloudTasks`
- `VercelQueuesRunner` — `@terreno/jobs/runners/vercelQueues`
- Admin list/detail, retry, requeue, cancel, stats, and schedules
- Retries with backoff, delayed enqueue, cron schedules, and dead-letter rows

## Documentation

Full API reference: [docs/reference/jobs.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/jobs.md)

Operator guide: [docs/how-to/background-jobs.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/background-jobs.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
