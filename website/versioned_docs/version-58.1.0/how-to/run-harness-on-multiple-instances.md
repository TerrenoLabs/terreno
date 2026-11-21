# Run the harness on multiple instances

Run durable harness tasks on every instance of a scaled-out backend (for example several
Cloud Run instances). Swap the default `InProcessRunner`, where one process drains every
task, for `JobsRunner`, which runs each phase as a `@terreno/jobs` job. API:
[AI harness reference → JobsRunner](../reference/ai-harness.md#jobsrunner). Why it is safe:
[Durable agent harness → Runners](../explanation/durable-agent-harness.md#runners).

You need a working harness (see [Build a durable workflow](build-a-durable-workflow.md)) and
a MongoDB replica set. Task data does not change, so you can switch runners without a
migration.

## 1. Install the jobs package (1 minute)

`@terreno/jobs` is an optional peer of `@terreno/ai`. Add it to the app:

```bash
bun add @terreno/jobs
```

## 2. Open the harness with a JobsRunner (5 minutes)

Create the `JobsApp` first, hand it to the runner, and register it on the app. Build the
app before the harness starts: `harness.start()` throws when no `JobsApp` is registered.
The runner defines the `terreno.harness.phase` job on it.

```typescript
import {Harness} from "@terreno/ai/harness";
import {JobsRunner} from "@terreno/ai/harness/jobsRunner";
import {TerrenoApp} from "@terreno/api";
import {JobsApp} from "@terreno/jobs";

const jobs = new JobsApp();
const harness = await Harness.open({
  registry: [intakeSummary, summarizer],
  runner: new JobsRunner({jobs}),
});

const app = new TerrenoApp({userModel: User}).register(jobs);
// ...register HarnessApp and your routes, then build or start the server.
app.start();

await harness.start();
await jobs.startWorker();
```

Shut down in the reverse order so phases in flight finish:

```typescript
await harness.stop(); // stops dispatching, waits for this instance's phases
await jobs.stopWorker();
```

## 3. Run the same code on every instance

Every instance runs the same startup. Each one:

- scans for runnable tasks and enqueues one job per runnable phase (duplicates collapse on
  the job's idempotency key),
- runs phase jobs from the shared jobs queue, and
- sweeps task leases that expired because an instance died.

No instance is special, and none waits on standby.

## 4. Check it works (2 minutes)

1. Start two backend processes against the same database (different `PORT`s).
2. Create a task (for the example backend, run `startClinicalIntake`).
3. Open the admin **Jobs** screen. Each phase shows as its own `terreno.harness.phase` job
   with payload `{taskId}`.
4. Kill one process mid-phase. Within one lease (`leaseDuration`, default 30 s) the other
   process replays a `replay: "safe"` phase, or parks any other phase as `interrupted`.

## Tune it

| Want | Set |
| --- | --- |
| Faster pickup of new work | `new JobsRunner({jobs, pollInterval: {milliseconds: 200}})` and `new JobsApp({pollIntervalMs: 200})` |
| Faster crash recovery | A shorter `leaseDuration` with `heartbeatInterval` about a third of it |
| Phases longer than the jobs lock TTL | Nothing: the task lease, renewed by heartbeats, decides who commits |

## Troubleshoot

- **Jobs fail with `harness-runner-stopped`.** A jobs worker runs on an instance whose
  harness is not started. Start the harness before `jobs.startWorker()`. The jobs worker
  retries the job, so no task is lost.
- **`harness.start()` throws "JobsRunner needs a registered JobsApp".** The dispatcher
  enqueues through the registered jobs service, and `TerrenoApp` registers plugins when it
  builds. Call `app.start()` (or `build()`) before `harness.start()`.
- **A task stays `pending`.** Check that its `name@version` is in the registry of the
  running instances. A runner only dispatches registered versions.
- **Pick one runner per database.** Mixing them is safe (every claim and commit is fenced),
  but an `InProcessRunner` owner then claims tasks itself and runs them to a stop.
