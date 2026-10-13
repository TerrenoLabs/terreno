> **createFeatureFlaggedLogger**(`options`): [`ScopedLogger`](../interfaces/ScopedLogger.md)

Wraps a [ScopedLogger](../interfaces/ScopedLogger.md) so all `debug` / `info` / `warn` / `error` traffic is dropped while
`isEnabled()` returns false. Use it to keep verbose diagnostics in the code but silent until a
flag turns them on — no redeploy required.

`isEnabled` is evaluated on **every** call, so it can read any feature-flag source: an
environment variable, a cached/remote flag map, or a call into `@terreno/feature-flags` from your
app. (`@terreno/api` deliberately does not import `@terreno/feature-flags` to avoid a package
cycle — you supply the predicate.)

## Parameters

### options

[`CreateFeatureFlaggedLoggerOptions`](../interfaces/CreateFeatureFlaggedLoggerOptions.md)

The `isEnabled` predicate plus an optional `target` logger and `gateCatch`.

## Returns

[`ScopedLogger`](../interfaces/ScopedLogger.md)

A scoped logger that forwards to `target` only while the flag is enabled.

## See

[createScopedLogger](createScopedLogger.md) for the usual `target`.

## Examples

**Gate a scoped logger behind an env var (flips live, no restart)**

```typescript
import {createFeatureFlaggedLogger, createScopedLogger} from "@terreno/api";

const jobLog = createFeatureFlaggedLogger({
  isEnabled: () => process.env.JOB_TRACE_LOGS === "true",
  target: createScopedLogger({prefix: "[Job]", labels: {jobName: "nightly-sync"}}),
});

jobLog.info("step 1"); // silent unless JOB_TRACE_LOGS=true
```

**Drive it from \`@terreno/feature-flags\` in app code**

```typescript
const debugLog = createFeatureFlaggedLogger({
  isEnabled: () => flags.isEnabled("debug.billing"),
  target: createScopedLogger({prefix: "[Billing]"}),
  gateCatch: true, // also silence `catch` while the flag is off (default: false)
});
```
