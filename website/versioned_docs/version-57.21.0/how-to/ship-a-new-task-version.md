# Ship a new task version

Change a durable harness task without breaking runs that already started on the old code.
Rules: [Versioning](../reference/ai-harness.md#versioning). Why:
[Version pinning](../explanation/durable-agent-harness.md#version-pinning).

## When to bump `version`

Bump it on any change an in-flight task could notice:

- A phase is renamed, removed, or added between existing phases.
- The shape of `state`, `input`, or the result changes.
- A phase's side effects or `replay` policy change.

A fix that keeps the same phases, state shape, and side effects can ship under the same
version.

## Steps

1. Copy the definition and bump `version`. Keep the old one unchanged.

   ```typescript
   export const intakeV1 = defineTask<IntakeInput, IntakeStateV1, IntakeResult>({
     name: "clinic.intake",
     version: 1,
     // ...the old phases, untouched
   });

   export const intakeV2 = defineTask<IntakeInput, IntakeStateV2, IntakeResult>({
     name: "clinic.intake",
     version: 2,
     // ...the new phases
   });
   ```

2. Register both versions. Point new work at v2.

   ```typescript
   const harness = await Harness.open({registry: [intakeV1, intakeV2]});
   await harness.start();

   await harness.createTask(intakeV2, {patientId});
   ```

   Tasks created on v1 finish on v1's phases and v1's `abort` handler. New tasks run on
   v2. Parent tasks that call `rt.createTask(intakeV1, ...)` keep making v1 children
   until you change that call.

3. Deploy. Every process that runs the harness needs the same registry.

4. Wait until no v1 task is left in flight. Check in a Mongo shell:

   ```javascript
   db.harnesstasks.countDocuments({
     name: "clinic.intake",
     version: 1,
     status: {$in: ["pending", "running", "waiting", "interrupted"]},
   });
   ```

   Resolve stuck `interrupted` v1 tasks with `harness.resolveInterrupted`, or stop them
   with `harness.abort`.

5. When the count is 0, remove `intakeV1` from the registry and deploy again.

## If you remove a version too early

`Harness.start()` throws an `APIError` with code `harness-config-invalid` and claims
nothing. Its `detail` reads:

```text
Harness.start: in-flight tasks use task versions this registry does not register: clinic.intake@1 (4 tasks). Register those definitions (keep old versions until their tasks finish) or resolve the tasks first.
```

Fix: add the old definition back to `registry` and redeploy. Its tasks resume from their
last checkpoint.
