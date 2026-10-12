# Build a durable workflow

Build a multi-step task that survives restarts, asks a person to sign off, and performs its
side effect exactly once. The one worked example is the example backend's clinical tracer,
`clinic.intakeSummary`: fetch a chart, summarize it with an agent, wait for a clinician,
file a note. API: [AI harness reference](../reference/ai-harness.md). Why it is shaped this
way: [Durable agent harness](../explanation/durable-agent-harness.md).

| File | What it holds |
| --- | --- |
| `example-backend/src/harness/clinicalIntake.ts` | The task, the summarizer agent, the approvers |
| `example-backend/src/harness/fakeEhr.ts` | The EHR client (`getChart`, `writeNote`) over `FakePatientChart` / `FakeClinicalNote` |
| `example-backend/src/harness/clinicModels.ts` | Model resolver: Gemini when configured, else the demo model |
| `example-backend/src/harness/clinicDemoModel.ts` | Deterministic local `LanguageModel` for dev and e2e |
| `example-backend/src/harness/exampleHarness.ts` | `Harness.open` + runner, started in the API process |
| `example-backend/src/harness/startClinicalIntake.ts` | Admin script that starts a run |

## Try it (5 minutes)

1. Start a replica-set `mongod`, the backend (`bun run backend:dev`), and the frontend
   (`bun run frontend:web`). Steps: [Run tests locally](run-tests-locally.md).
2. Seed: `bun run backend:seed`. It creates charts `p-1001`, `p-1002`, `p-1003`, the admin
   `admin@example.com`, and the clinician `clinician@example.com` (password
   `testpassword123`).
3. Start a run: `cd example-backend && bun run script startClinicalIntake --wet --patientId p-1001`,
   or run `startClinicalIntake` from the admin **Scripts** screen.
4. Sign in as the admin and open **AI Harness → Approvals**
   (`http://localhost:8082/admin/harness-approvals`). Open the item and approve it.
5. Open **AI Observability → Traces**: the newest `clinic.intakeSummary@1` trace shows every
   phase, the summarizer with its model call, and the sign-off.

## 1. Define the task

Split the work at every point where a crash would need a different answer. Each phase is a
checkpoint; `replay` says what to do when a phase is cut off.

| Phase | `replay` | Work | Why that policy |
| --- | --- | --- | --- |
| `fetch` | `safe` | `ehr.getChart(patientId)`; no chart fails the task | A read; running it twice is harmless |
| `summarize` | `safe` | `rt.runAgent(summarizer, {input: chart, output: IntakeSummarySchema})` | A replay finds the same subagent turn; finished model calls are not repeated |
| `review` | `safe` | `rt.approval("clinician-signoff", {...})`; branch on the decision | A replay finds the same approval row |
| `write` | default (`never`) | `ehr.writeNote(..., {idempotencyKey: \`note-${task.id}\`})` | A write cut off mid-call needs a person to check the EHR |

```typescript
const intakeSummary = defineTask<IntakeSummaryInput, IntakeSummaryState, IntakeSummaryResult>({
  name: "clinic.intakeSummary",
  version: 1,
  approvals: {"clinician-signoff": {approvers: [isAdminOrClinician]}},
  initial: () => ({phase: "fetch", state: {}}),
  retry: {maxAttempts: 3},
  phases: {
    fetch: {
      replay: "safe",
      run: async (task, rt) => {
        const chart = await ehr.getChart(task.input.patientId);
        if (!chart) {
          await rt.commit({terminal: {status: "failed", error: `No chart for patient ${task.input.patientId}`}});
          return;
        }
        await rt.commit({phase: "summarize", state: {chart}});
      },
    },
    // summarize, review, write: see the sections below
  },
});
```

Keep `state` plain JSON: it is stored on every checkpoint. Bump `version` when phases or
state change: [Ship a new task version](ship-a-new-task-version.md).

## 2. Add the agent

```typescript
const summarizer = defineAgent({
  name: "clinic.summarizer",
  model, // {provider: "google", modelId: "gemini-2.5-flash"} or the demo model
  fallbackModels,
  instructions: CLINIC_SUMMARIZER_INSTRUCTIONS, // a named constant, never inline
  tools: [],
});

summarize: {
  replay: "safe",
  run: async (task, rt) => {
    const summary = await rt.runAgent<NoteContent>(summarizer, {
      input: task.state.chart,
      output: IntakeSummarySchema, // {summary, risk, sources}
    });
    await rt.commit({phase: "review", state: {...task.state, summary}});
  },
},
```

`Harness.open({models})` turns the agent's `{provider, modelId}` into a model. The example
resolver (`resolveExampleModel`) maps:

| Ref | Model |
| --- | --- |
| `google/*` | The server's Gemini / Vertex model (`GEMINI_API_KEY` or `GOOGLE_VERTEX_PROJECT`) |
| `demo/clinic-summarizer-demo` | The demo model: derives the summary from the chart by fixed rules, prefixes it `[Demo model: no LLM was called]`, calls no network |

The summarizer uses the demo model when no provider is configured or `CLINIC_DEMO_MODEL=true`,
so dev and e2e runs need no API key. Its `LLM` spans are named `demo/clinic-summarizer-demo`.

## 3. Ask for approval

Declare approvers on the definition, keyed by the approval key. Approvers in one list are
ANDed, so "admin **or** clinician" is one approver:

```typescript
const isAdminOrClinician = anyApprover(
  Permissions.IsAdmin,
  access.permission({clinicalIntake: ["signoff"]}) // RBAC: the `clinician` role grants it
);

review: {
  replay: "safe",
  run: async (task, rt) => {
    const decision = await rt.approval("clinician-signoff", {
      title: `Sign off intake summary for ${chart.name}`,
      summary: signoffSummary(chart, summary), // markdown shown in the inbox
      payload: {patientId: chart.patientId, ...summary},
      timeout: {hours: 24},
    });
    if (!decision.approved) {
      const reason = decision.expired
        ? "Sign-off expired before anyone decided"
        : (decision.reason ?? "Rejected");
      await rt.commit({terminal: {status: "completed", result: {status: "rejected", reason}}});
      return;
    }
    await rt.commit({phase: "write", state: {...task.state, signedOffBy: decision.decidedBy}});
  },
},
```

The example adds the `clinicalIntake.signoff` statement and a `clinician` role
(`example-backend/src/access.ts`, `rbacRoles.ts`). Admins decide in the admin inbox.
Clinicians without admin access decide over HTTP (`GET /harness/approvals`,
`POST /harness/approvals/:id/approve`) or in a `HarnessApprovalInbox` mounted outside the
admin shell ([admin-frontend](../reference/admin-frontend.md#ai-harness-approvals-inbox)).

## 4. Perform the side effect once

Leave the side-effecting phase at the default `replay: "never"` and pass an idempotency key
the EHR enforces:

```typescript
write: {
  run: async (task, rt) => {
    rt.signal.throwIfAborted();
    const note = await ehr.writeNote(task.input.patientId, task.state.summary, {
      idempotencyKey: `note-${task.id}`,
      signedOffBy: task.state.signedOffBy,
      taskId: task.id,
    });
    await rt.commit({terminal: {status: "completed", result: {status: "filed", noteId: String(note._id)}}});
  },
},
```

`FakeClinicalNote.idempotencyKey` is unique, so even a retried write returns the first note.

## 5. Register and run

```typescript
const harness = await Harness.open({
  models: resolveExampleModel,
  registry: [intakeSummary, summarizer],
  runner: new InProcessRunner(exampleRunnerOptions()),
});
terraApp.register(new HarnessApp({harness})); // before AdminApp: adds the approvals inbox
await harness.start();                         // after listen: the runner claims work

await harness.createTask(intakeSummary, {patientId}, {requestId: `intake-${patientId}`});
```

`requestId` makes starting idempotent: the script returns the first run for a repeated key
(pass `--requestId` to start another). Every process that runs or decides tasks registers
the same definitions.

## 6. Observe

| Where | What you see |
| --- | --- |
| **AI Harness → Approvals** | The pending sign-off: title, markdown summary, payload |
| **AI Observability → Traces** (`/admin/ai-trace-detail?id=<traceId>`) | The span waterfall |
| `GET /ai/observability/traces/:traceId` | The same tree as JSON (admin) |
| `GET /harness/tasks/:id/events` | Live `task.status` and `approval.*` events (SSE) |

`HarnessTask.traceId` links a run to its trace. A completed run's tree:

```
CHAIN clinic.intakeSummary@1
├── CHAIN fetch
├── CHAIN summarize                          (waiting on the summarizer)
├── AGENT clinic.summarizer
│   ├── CHAIN request
│   └── LLM   demo/clinic-summarizer-demo
├── CHAIN summarize                          (summary committed)
├── CHAIN review                             (waiting on sign-off)
├── CHAIN wait:terreno.approval:clinician-signoff:<step>:0
├── CHAIN approval:clinician-signoff         (decision, decidedBy)
├── CHAIN review
└── CHAIN write
```

## 7. Recover an interrupted run

| Cut off during | What happens | You do |
| --- | --- | --- |
| `fetch`, `summarize`, `review` | After the lease expires (`HARNESS_LEASE_SECONDS`, default 30), the next runner replays the phase. A cut-off model request is re-requested; an error `request` span records the interruption. | Nothing |
| `write` | The task goes `interrupted`. | Check the EHR for `note-<taskId>`, then `POST /harness/tasks/:id/resolveInterrupted` with `{action: "retry" \| "complete" \| "abort", reason}` |

The proof is `example-backend/src/harness/clinicalIntake.crash.test.ts`. It starts the real
API process (`bun run src/index.ts`) against a replica set with
`CLINIC_DEMO_MODEL_DELAY_MS=600000`, starts a run, waits until the summarizer's model
request is in flight, sends `SIGKILL`, starts a fresh process, approves, and asserts:
the run ends `filed`, exactly one `FakeClinicalNote` exists, and the trace has one `LLM`
span plus an interruption span naming the dead process's lease. Run it with
`cd example-backend && bun test src/harness/clinicalIntake.crash.test.ts` (about 50 s).
The Playwright spec `example-frontend/e2e/harness-intake.spec.ts` covers approve-in-inbox →
`filed` → span tree in the Traces screen.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `GEMINI_API_KEY` / `GOOGLE_VERTEX_PROJECT` | unset | When set, the summarizer uses `google/gemini-2.5-flash` (fallback `gemini-2.5-flash-lite`) |
| `CLINIC_DEMO_MODEL` | unset | `true` forces the demo model even with a provider |
| `CLINIC_DEMO_MODEL_DELAY_MS` | `0` | Demo model waits this long per request (crash drills) |
| `HARNESS_LEASE_SECONDS` | `30` | Owner and task lease; heartbeat is a third of it. Short values speed up crash recovery in tests |
