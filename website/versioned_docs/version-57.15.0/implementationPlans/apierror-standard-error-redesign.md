# APIError redesign — standards-first extension of Error

**Status:** Complete
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1080
**Branch:** cursor/apierror-standard-error-redesign-e24a
**Owner:** TBD
**Created:** 2026-07-28

## Goal

Redesign `APIError` (`api/src/errors.ts`) so the **standard `Error` fields carry the standard
meaning** — `name` is the error type, `message` is the stable human-readable summary, `stack` is
the capture site, and `cause` is the wrapped original error — and the JSONAPI extension fields
(`status`, `code`, `detail`, `source`, `meta`, `links`, `id`) only carry the *extra* API context.

The motivating symptom: tools like Sentry derive the issue headline from `error.name` and the
subtitle from `error.message`, and walk `error.cause` for linked exceptions. Because every
`APIError` has `name === "APIError"` and a `message` polluted with an embedded stack trace,
unrelated errors all show up as **"APIError"** and group together, while the actual wrapped error
is invisible to Sentry.

## Non-Goals

- Changing the client-facing wire format beyond clarifying `disableExternalErrorTracking` (see
  Decisions). Frontends (`ui/src/Utilities.tsx` `isAPIError`/`printAPIError`, RTK error
  middleware, `example-frontend/store/errors.ts`) keep reading `data.title`, `data.detail`,
  `data.status`, `data.meta.fields`, and `data.disableExternalErrorTracking` when present.
- Replacing the JSONAPI error model. The extension fields stay; only their relationship to the
  standard `Error` fields changes.
- A general error-taxonomy overhaul for consuming apps (Flourish, etc.). They get better behavior
  for free; adopting `code`/subclasses is opt-in.

## Evaluation of the current design

What `APIError` does today (`api/src/errors.ts`):

| Standard field | Current use | Problem |
|---|---|---|
| `name` | Hardcoded `"APIError"` | Every Sentry issue headline is "APIError". A 403 admin check and a 500 integration failure are indistinguishable at a glance, and type-based grouping collapses. |
| `message` | `` `${title}: ${detail}\n${wrappedError.stack}` `` | Embedding a per-occurrence stack makes `message` unstable (defeats message-based grouping) and unreadable as a Sentry subtitle. It duplicates data Sentry would render natively from a `cause` chain. |
| `stack` | Default (capture site) | Fine — but for framework-wrapped errors (e.g. the `preCreate hook error:` re-wraps in `api.ts`), the top frames are framework code, so unrelated app errors share a stack and group together. |
| `cause` | Not used; a non-standard `error: unknown` field instead | Sentry's default `linkedErrors` integration walks `error.cause` and shows the chain as linked exceptions. The `error` field is invisible to it. |

Additional design issues:

1. **Constructor side effects.** Every construction calls `logger.error`/`logger.warn`, even when
   the error is caught and handled, converted, or expected. Reporting belongs at the handling
   boundary (`apiErrorMiddleware`), not at construction.
2. **Internal config on the wire.** `getAPIErrorBody` serializes
   `disableExternalErrorTracking` into the HTTP response body when true (needed for client-side
   Sentry suppression). It is omitted when false/undefined.
3. **Brittle type guard.** `isAPIError` checks `error.name === "APIError"`, which forbids ever
   making `name` meaningful (the fix for the Sentry headline) and only exists to survive duplicate
   `@terreno/api` instances across packages.
4. **No `toJSON`.** `getAPIErrorBody` manually iterates a key list; the class should own its wire
   serialization.
5. **`title` is documented as stable per problem type (JSONAPI) but the framework violates it** —
   e.g. `title: errorMessage(error)` and `` title: `preCreate hook error: ${errorMessage(error)}` ``
   in `api.ts` interpolate per-occurrence text into `title`.
6. **Sentry capture has no grouping hints.** `apiErrorMiddleware` calls
   `Sentry.captureException(err)` bare — no fingerprint, no tags, no context from the JSONAPI
   fields.

## Decisions

| Question | Decision |
|----------|----------|
| What does `message` hold? | Exactly `title` — a stable, human-readable summary of the problem type. `detail`, `fields`, and the cause stack are **never** concatenated into `message`. `title` becomes a getter aliasing `message` so the extension field and the standard field cannot drift. |
| What does `name` hold? | The error *type*, by precedence: subclass name (via `new.target.name`) → PascalCased `code` (`"update-admin-error"` → `UpdateAdminError`) → status-derived name (`BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `InternalServerError`, …) → `APIError`. |
| How is the wrapped error attached? | Standard ES2022 `cause`: `super(title, {cause})`. The old `error` option is kept as a deprecated alias that feeds `cause`. Sentry then renders the chain as linked exceptions with the original stack. |
| Where does logging happen? | In `apiErrorMiddleware`, not the constructor: `warn` for 4xx, `error` for 5xx (5xx are bugs/ops issues; 4xx are mostly client mistakes). Non-HTTP boundaries (websockets, scripts) already log via `logger.catch`/`captureException`. |
| Is `disableExternalErrorTracking` still sent to clients? | Only when `true`. It lets the frontend suppress duplicate Sentry reporting (`example-frontend/store/errors.ts`). Omitted from the wire body when false/undefined. Still suppresses server-side Sentry capture in `apiErrorMiddleware` when set. |
| How does `isAPIError` work? | Brand property `isTerrenoAPIError = true` set in the constructor (survives duplicate package instances), with a transition fallback for `name === "APIError"`. |
| Does Sentry still capture 4xx APIErrors? | Unchanged for now: capture everything unless `disableExternalErrorTracking`. But capture gains a fingerprint and context (below) so 4xx noise at least groups correctly. A follow-up may default 4xx to log-only. |
| Wire body shape? | `{status, title, detail?, code?, id?, links?, source?, meta?, disableExternalErrorTracking?}`. The last field is present only when `true`. `meta.fields` unchanged. |

## Architecture

### New class shape (`api/src/errors.ts`)

```typescript
export interface APIErrorOptions {
  /** Stable, human-readable summary of the problem TYPE (JSONAPI title). Becomes Error.message. */
  title: string;
  /** HTTP status, 400–599. Defaults to 500; out-of-range values are coerced to 500 with a warn. */
  status?: number;
  /** Application-specific stable error code (kebab-case). Also drives Error.name when set. */
  code?: string;
  /** Human-readable, per-occurrence explanation. NOT folded into message. */
  detail?: string;
  /** Field-level messages for forms; folded into meta.fields on the wire (unchanged). */
  fields?: {[id: string]: string};
  /** The original error being wrapped. Standard ES2022 Error cause. */
  cause?: unknown;
  /** @deprecated Use `cause`. */
  error?: unknown;
  id?: string;
  links?: {about?: string; type?: string};
  source?: {pointer?: string; parameter?: string; header?: string};
  meta?: {[id: string]: unknown};
  /** When true, skip Sentry capture in apiErrorMiddleware. Never serialized to clients. */
  disableExternalErrorTracking?: boolean;
}

export class APIError extends Error {
  /** Brand for cross-package instanceof-free detection. */
  readonly isTerrenoAPIError = true as const;

  readonly status: number;
  readonly code: string | undefined;
  readonly detail: string | undefined;
  readonly id: string | undefined;
  readonly links: {about?: string; type?: string} | undefined;
  readonly source: {pointer?: string; parameter?: string; header?: string} | undefined;
  readonly meta: {[id: string]: unknown};
  readonly disableExternalErrorTracking: boolean | undefined;

  constructor(options: APIErrorOptions) {
    // message = title, nothing else. cause = the wrapped error, natively understood by Sentry.
    super(options.title, {cause: options.cause ?? options.error});
    this.status = normalizeStatus(options.status); // 500 default, 400–599 enforced
    this.code = options.code;
    // name precedence: subclass > code > status. `new.target` keeps subclass names automatically.
    this.name =
      new.target !== APIError
        ? new.target.name
        : (options.code ? pascalCase(options.code) : nameForStatus(this.status));
    this.detail = options.detail;
    this.id = options.id;
    this.links = options.links;
    this.source = options.source;
    this.meta = {...options.meta, ...(options.fields ? {fields: options.fields} : {})};
    this.disableExternalErrorTracking = options.disableExternalErrorTracking;
    // No logging here. Reporting happens where the error is handled.
  }

  /** JSONAPI title === Error.message; a getter so the two can never drift. */
  get title(): string {
    return this.message;
  }

  /** Client-facing JSONAPI body. Excludes name/stack/cause; includes disableExternalErrorTracking when true. */
  toJSON(): APIErrorBody {
    ...
  }
}
```

`nameForStatus` maps common statuses (`400 BadRequestError`, `401 UnauthorizedError`,
`403 ForbiddenError`, `404 NotFoundError`, `409 ConflictError`, `422 ValidationError`,
`429 TooManyRequestsError`, `500 InternalServerError`, `502/503/504` gateway names) and falls back
to `APIError` for anything unmapped.

### What Sentry sees, before vs. after

```text
Before:  APIError
         Only an admin can update that!: You must be an admin...\nError: inner\n  at ...

After:   ForbiddenError            (or UpdateAdminError when code is set)
         Only an admin can update that!
         └─ caused by TypeError: Cannot read properties of undefined   (linked exception, own stack)
```

### Middleware changes (`apiErrorMiddleware`)

```typescript
if (isAPIError(err)) {
  const logMessage = `${err.name}(${err.status}): ${err.message}${err.detail ? ` — ${err.detail}` : ""}`;
  if (err.status >= 500) {
    logger.error(logMessage);   // moved here from the constructor
  } else {
    logger.warn(logMessage);
  }
  if (!err.disableExternalErrorTracking) {
    Sentry.withScope((scope) => {
      // Group by logical error type, not by whichever framework frame constructed it.
      scope.setFingerprint([err.name, err.code ?? err.message, String(err.status)]);
      scope.setTag("http.status_code", String(err.status));
      if (err.code) {
        scope.setTag("api_error.code", err.code);
      }
      scope.setContext("apiError", err.toJSON()); // detail, source, meta.fields, etc.
      Sentry.captureException(err);
    });
  }
  res.status(err.status).json(err.toJSON());
  return;
}
```

The explicit fingerprint fixes the second half of the reported problem: today all framework-thrown
`APIError`s share near-identical construction stacks inside `api.ts`, so Sentry's default
stack-trace grouping lumps unrelated errors together. Fingerprinting on
`name + (code ?? title) + status` groups by problem type instead, while the `cause` chain
preserves each occurrence's real origin stack for debugging.

### Optional convenience subclasses (phase 2)

For the most common statuses, thin subclasses give static `name`s, less boilerplate, and free
`instanceof` narrowing. They are sugar only — everything works with plain `APIError`:

```typescript
export class NotFoundError extends APIError {
  constructor(options: Omit<APIErrorOptions, "status"> | string) {
    super(typeof options === "string" ? {status: 404, title: options} : {...options, status: 404});
  }
}
// BadRequestError, UnauthorizedError, ForbiddenError, ConflictError, ValidationError, InternalError
```

`mongooseErrorToAPIError` would return `ValidationError` instances (name "ValidationError",
status 400) instead of generic `APIError({title: "Validation failed"})`.

### Framework call-site cleanup (`api/src/api.ts`)

The re-wrap sites currently interpolate the inner message into `title`. With `cause`, `title`
becomes stable and per-occurrence text moves to `detail`:

```typescript
// Before
throw new APIError({title: `preCreate hook error: ${errorMessage(error)}`, error, status: 400, ...});

// After
throw new APIError({
  cause: error,
  code: "pre-create-hook-error",       // -> name PreCreateHookError
  detail: errorMessage(error),
  disableExternalErrorTracking: getDisableExternalErrorTracking(error),
  status: 400,
  title: "preCreate hook failed",
});
```

Same pattern for `preUpdate`/`preDelete`/`postCreate`/`postUpdate`, `Populate error`,
`responseHandler error`, and `Query filter error` sites.

## Models

No model changes. `errorsPlugin` (the `apiErrors` subdocument schema) already stores only the
JSONAPI extension fields and is unaffected.

## APIs

- **Wire format:** `disableExternalErrorTracking` is included in the body only when `true`.
- **Public exports:** `APIError`, `APIErrorOptions` (new; `APIErrorConstructor` kept as a
  deprecated alias), `isAPIError`, `errorMessage`, `errorStack`,
  `getDisableExternalErrorTracking`, `mongooseErrorToAPIError`, middlewares — all keep their
  names. `getAPIErrorBody` becomes a deprecated wrapper around `error.toJSON()`.
- **`isAPIError`:** checks the `isTerrenoAPIError` brand (plus a transition-period fallback for
  `name === "APIError"` to accept instances from older `@terreno/api` versions in mixed
  node_modules).

## Notifications

None.

## UI

No UI changes required. `ui/src/Utilities.tsx` `isAPIError` (checks `data.title`) and
`printAPIError` (reads `data.title`/`data.detail`) continue to work; `title` remains the stable
summary and `detail` the occurrence-specific text.

## Phases

1. **Core class** — rewrite `APIError` (message=title, name derivation, `cause`, brand, `toJSON`,
   no constructor logging); update `isAPIError`, deprecate `getAPIErrorBody`; move logging +
   Sentry scope/fingerprint into    `apiErrorMiddleware`; update `errors.test.ts`, `api.hooks.test.ts` (assert
   `res.body.disableExternalErrorTracking` when the flag is set),
   `api.errors.test.ts`, `permissions.middleware.test.ts`, `docLoader.test.ts`.
2. **Framework call sites** — stabilize `title` + move per-occurrence text to `detail`/`cause` in
   `api.ts`, `openApiValidator.ts`, `permissions.ts`, `auth.ts`, `plugins.ts`, and add `code`
   where a stable identity helps grouping. Introduce the convenience subclasses and use
   `ValidationError` in `mongooseErrorToAPIError`.
3. **Downstream packages** — `admin-backend`, `feature-flags`, `ai`, `example-backend`: swap
   `error:` for `cause:` and adopt `code`/subclasses opportunistically. Regenerate website
   reference docs (`update-docs` skill).

## Feature Flags & Migrations

None. No stored data changes. The behavior changes (Sentry titles/grouping, log level for 4xx,
dropped response flag) ship with a minor version bump and a changelog entry; consuming apps need
no code changes unless they asserted on the removed response field or the exact `name` string.

## Activity Log & User Updates

N/A.

## Not Included / Future Work

- Defaulting 4xx APIErrors to log-only (no Sentry capture) unless opted in.
- An RFC 9457 (`application/problem+json`) response mode. The JSONAPI error object is close
  (`title`/`detail`/`status` align); `links.about` ≈ `type`. Not worth a wire break now.
- Client-side (RTK) typed error codes generated from the OpenAPI spec.

## Files to Create / Modify

As implemented:

- `api/src/errors.ts` — core redesign (class, name/status maps, subclasses, `toJSON`, middleware).
- `api/tsconfig.json` — add `es2022.error` to `lib` for the standard `ErrorOptions`/`cause` types.
- `api/src/api.ts`, `api/src/transformers.ts`, `api/src/httpClient.ts`, `api/src/config.ts`,
  `api/src/docLoader.ts` — stable titles, `cause`, `code` at every wrap site (phase 2).
  `permissions.ts`, `auth.ts`, `plugins.ts`, and `openApiValidator.ts` needed no changes — they
  already used stable titles without wrapped errors.
- Tests: `api/src/errors.test.ts`, `api/src/api.errors.test.ts`, `api/src/api.hooks.test.ts`,
  `api/src/api.test.ts`, `api/src/api.errorPaths.test.ts`, `api/src/notifiers/*.test.ts`,
  `ai/src/langfuseRoutesMiddleware.test.ts` — updated expectations plus new coverage for name
  derivation, `cause`, subclasses, `toJSON`, and the Sentry fingerprint.
- Downstream packages had no `error:` usages, so phase 3 required no code changes.
- Docs: `.rulesync/rules/api/00-api.md` error-handling section (mirrors regenerated with
  `bun run rules`).

## Task List

Implemented directly on this branch (all three phases); no separate tasks file.

## Acceptance Criteria

- [x] `new APIError({status: 404, title: "Todo not found"})` has `name === "NotFoundError"`,
      `message === "Todo not found"`, `title === "Todo not found"`, and a clean single-line message.
- [x] `new APIError({title: "X", cause: inner})` exposes `error.cause === inner` and Sentry shows
      the inner error as a linked exception with its own stack.
- [x] Sentry issue headline shows the derived/subclass name (never a bare "APIError" for errors
      with a mapped status or code), and two errors with different `name`/`code` never share an
      issue (fingerprint on `name + code + status`, falling back to `name` when `code` is absent).
- [x] Constructing an APIError produces no log output; handling one through `apiErrorMiddleware`
      logs `warn` (4xx) or `error` (5xx) exactly once.
- [x] Response bodies keep `{status, title, detail, code, meta.fields, ...}`; include
      `disableExternalErrorTracking` only when `true`; never include `name`, `stack`, or `cause`.
- [x] `isAPIError` returns true across duplicate `@terreno/api` copies and for subclasses.
- [x] `bun run api:test` passes; `bun run lint` passes for all touched packages (the pre-existing
      `@terreno/ui` `ConsentNavigator.tsx` floating-promise failures are unrelated).
