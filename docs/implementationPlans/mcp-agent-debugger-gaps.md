# Implementation Plan: MCP Agent Debugger Gaps (Network, Dispatch, Storage, Native Logs, Dev Commands)

**Status:** Approved — defaults accepted (2026-11-05)  
**Parent IP:** [mcp-boost-parity.md](mcp-boost-parity.md) (extends the local stdio companion; does not repeat hosted docs/codegen work)  
**Roadmap:** Area=`mcp`, Target=`Next`, Impact=`Feature`  
**Created:** 2026-11-05  

## Goal

Close the remaining agent-debugging gaps compared to integrated RN debuggers (for example
Xerlock): **network traffic**, **structured Redux dispatch**, **local key-value storage
read/write**, **native platform logs**, and **app-registered dev commands**. Agents already get
merged console/backend logs, Mongo, SyncDB/RTK state, navigation, and web driving via
`terreno-mcp-local`; this plan adds the missing observe/act surfaces without building a
human debugger UI.

## Non-Goals

- On-device **SQLite** inspection outside SyncDB/TinyBase (partial overlap with
  `get_syncdb_state`; raw `expo-sqlite` is out of scope).
- **Push notification** simulation, **network throttle**, and **React component tree /
  profiler** MCP tools (human DevTools + screenshots + `get_client_state` remain the path).
- **Zustand** as a first-class framework integration (apps may expose Zustand via
  `registerTerrenoDevCommand` only).
- Taking **`metro-mcp`** as a dependency (implement on the existing CDP session in
  `metroDevSession.ts`).
- New **hosted** (`terreno-mcp`) tools — all work is **`terreno-mcp-local`** plus small
  **`@terreno/syncdb`** / bootstrap dev hooks.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Separate `read_network` tool vs extend `read_logs`? | **Extend `read_logs`** with source `network` (chronological merge with other sources when omitted). |
| D2 | Depend on `metro-mcp` vs in-house? | **In-house** on `mcp-server/src/local/metro/metroDevSession.ts` (same Hermes CDP connection as `app` / `evaluate`). |
| D3 | Writable local storage in v1? | **Yes** — `write_local_storage` requires `TERRENO_MCP_EVAL=1`; reads are always allowed. |
| D4 | Build order | **Network → dispatch + storage → native logs → dev commands → docs**. |
| D5 | React tree snapshot | **Defer** — not in this plan. |

## Architecture

### Tool surface (after this plan)

| Tool | Server | Purpose |
|------|--------|---------|
| `read_logs` | local | Existing sources `backend`, `browser`, `metro`, `app`; **add** `network`, `native`. |
| `last_error` | local | Unchanged; may surface errors from new sources when level is `error`. |
| `dispatch_client_action` | local | Dispatch a Redux action on `globalThis.__TERRENO_STORE__` via CDP (EVAL-gated). |
| `read_local_storage` | local | Read AsyncStorage keys (and opt-in SecureStore key names) via dev global adapter. |
| `write_local_storage` | local | Write one key (EVAL-gated); never writes SecureStore unless app registers an explicit allowlist entry. |
| `list_dev_commands` | local | List `{name, description, inputSchema}` from `globalThis.__TERRENO_DEV_COMMANDS__`. |
| `invoke_dev_command` | local | Run a registered handler by name (EVAL-gated). |

Existing tools (`get_client_state`, `syncdb_*`, `evaluate`, `navigate`, `browser`, …) are
unchanged.

### CDP network capture (D1, D2)

Extend `metroDevSession.ts`:

1. After attaching to the debug target, enable CDP domains **`Runtime`** (existing) and
   **`Network`**.
2. Maintain a ring buffer (same cap as console, default 2000) of normalized entries:
   - `timestamp`, `method`, `url`, `status`, `mimeType`, `durationMs` when available
   - Request/response **header maps** with **`Authorization`**, **`Cookie`**, and
     **`set-auth-token`** redacted
   - Optional truncated **response body** (text only, max 4 KiB per entry; skip binary)
3. `read_logs` with `sources: ["network"]` (or default merge) maps the ring into the same
   JSON shape as other sources, with `source: "network"`.
4. `connection` metadata reuses the existing CDP status block; document that enabling
   Network shares the single Hermes debugger slot with DevTools contention rules already
   documented for `app`.

No separate MCP tool name.

### Redux dispatch (D3, D4 phase 2)

`dispatch_client_action`:

```typescript
// Input (strict JSON schema)
{
  type: string;           // required Redux action type
  payload?: unknown;      // optional JSON-serializable payload
}
```

Implementation:

1. Refuse unless `TERRENO_MCP_EVAL=1` (same posture as `evaluate` / `navigate`).
2. Prefer in-process read of `globalThis.__TERRENO_STORE__` when the MCP process shares the
   app heap (tests); otherwise CDP `Runtime.evaluate` with a fixed snippet that calls
   `globalThis.__TERRENO_STORE__?.dispatch({type, payload})` and returns `{ok, error?}`.
3. Validate `type` is a non-empty string; reject non-JSON-serializable payloads before evaluate.
4. Tool description tells agents to use `get_client_state` first, then dispatch, then
   `read_logs` / `get_client_state` again.

Requires `registerTerrenoDevStore(store)` in consumer apps (already in bootstrap /
`create-terreno-app`).

### Local storage (D3, D4 phase 2)

Dev-only adapter on the app (new **`@terreno/syncdb`** export, wired in bootstrap template and
`example-frontend`):

```typescript
registerTerrenoDevStorage({
  asyncStorage: true,              // default: wire AsyncStorage getAllKeys/getItem/setItem
  secureStoreKeyAllowlist?: string[]; // optional SecureStore keys readable/writable via MCP
});
```

Sets `globalThis.__TERRENO_DEV_STORAGE__` with `{listKeys, get, set}` in `__DEV__` only.

MCP tools:

- **`read_local_storage`**: `{keys?: string[], prefix?: string}` — returns key/value pairs;
  omit keys to return all keys from `listKeys()` (cap 200 keys, 8 KiB per value in output).
- **`write_local_storage`**: `{key, value}` — EVAL-gated; rejects keys not allowed (SecureStore
  keys not on allowlist).

MMKV and custom stores: apps register via `registerTerrenoDevCommand` or extend the adapter in
app code (document pattern; no MMKV in framework).

### Native logs (D4 phase 3)

Extend `read_logs` with source **`native`**:

| Platform | Mechanism | When unavailable |
|----------|-----------|------------------|
| Android emulator/device | `adb logcat -d -t <N>` subprocess; optional `TERRENO_ADB_SERIAL` | Clear status: `adb` not on PATH or no device |
| iOS Simulator | `xcrun simctl spawn booted log stream --style compact` with timeout/read cap | No booted sim or Xcode tools missing |

Entries use `source: "native"`, plain-text `raw`, parsed `level` when log line matches common
patterns. **Not** merged into `last_error` unless line matches error heuristics (document
behavior). Opt-in env **`TERRENO_NATIVE_LOGS=0`** disables subprocess collection (default on).

Web and Metro-only sessions: `native` source returns empty with status note.

### Dev commands (D4 phase 4)

App API ( **`@terreno/syncdb`** ):

```typescript
registerTerrenoDevCommand({
  name: "seedTodos",
  description: "Insert three fixture todos for the signed-in user",
  inputSchema: { type: "object", properties: { count: { type: "number" } } },
  handler: async ({count}) => ({created: count ?? 3}),
});
```

Registry: `globalThis.__TERRENO_DEV_COMMANDS__` — map of name → `{description, inputSchema,
handler}` (handlers run only inside the app via CDP evaluate, same as dispatch).

MCP:

- **`list_dev_commands`** — no args; JSON list of `{name, description, inputSchema}`.
- **`invoke_dev_command`** — `{name, arguments?}`; EVAL-gated; returns JSON-serializable
  result or structured error.

Example: register one command in `example-frontend` that toggles a feature flag in AsyncStorage
to prove the loop.

## Notifications

None.

## UI

No user-visible UI. Dev hooks are `__DEV__` only and no-op in production builds.

## Phases

| Phase | Scope | Depends on |
|-------|-------|------------|
| 1. Network via CDP | `metroDevSession` Network domain + `read_logs` `network` source | — |
| 2. Dispatch + storage | `dispatch_client_action`, storage adapter, read/write tools, bootstrap + example | 1 (shares CDP) |
| 3. Native logs | `read_logs` `native` source, adb/simctl collectors | — (parallel with 2 after 1) |
| 4. Dev commands | Registry API, `list_dev_commands`, `invoke_dev_command`, example command | 2 (same evaluate path) |
| 5. Documentation | Reference, how-to, explainer updates; real captured outputs | 1–4 |

## Feature Flags & Migrations

- No data migrations.
- All new app hooks are stripped or no-op when `!__DEV__`.
- `TERRENO_MCP_EVAL=1` remains opt-in; bootstrap must not enable it by default.
- New env vars: `TERRENO_NATIVE_LOGS` (default on), `TERRENO_ADB_SERIAL` (optional).

## Risks

- **CDP load**: Enabling Network increases traffic on the single Hermes session; keep ring caps
  and body truncation strict.
- **Secret leakage**: Redact auth headers; never log request bodies that look like JWTs (regex
  heuristic in normalizer).
- **Storage writes**: Mis-invoked `write_local_storage` can corrupt auth tokens; tool description
  and docs warn to prefer `syncdb_action` for synced data.
- **Native log volume**: Cap lines per `read_logs` call; default `entries` applies per source.
- **`invoke_dev_command`**: Arbitrary app code — same trust model as `evaluate`; dev-only registry.

## Not Included / Future Work

- SQLite file browser, notification dispatcher, network throttling, React tree/profiler MCP
  tools, first-party MMKV adapter.

## Files to Create / Modify

| Area | Files |
|------|--------|
| CDP | `mcp-server/src/local/metro/metroDevSession.ts`, tests |
| Logs | `mcp-server/src/local/tools/readLogs.ts`, tests |
| Runtime tools | `mcp-server/src/local/tools/runtime.ts` or new `clientDispatch.ts`, `localStorage.ts`, `devCommands.ts` |
| Registry | `syncdb/src/devMcpRegistry.ts` (or split files), `syncdb/src/index.ts`, tests |
| Bootstrap | `mcp-server/src/docs/templates/bootstrap/frontend/**`, `create-terreno-app` store bootstrap |
| Example | `example-frontend/app/_layout.tsx`, optional `devCommands.ts` |
| Docs | `docs/reference/mcp-server.md`, `docs/how-to/debug-with-mcp.md`, `docs/explanation/ai-development-loop.md`, `docs/reference/environment-variables.md`, `mcp-server/README.md` |

## Task List

See [`docs/tasks/mcp-agent-debugger-gaps.md`](../tasks/mcp-agent-debugger-gaps.md).

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `mcp-server/src/local/localServer.e2e.test.ts` (extend) | process | `read_logs` returns at least one `network` entry after CDP mock emits `Network.responseReceived` | Task 1.3 |
| E2 | `example-frontend/e2e/mcp-network-debug.spec.ts` | browser | A failing API call produces a 403/404 visible via agent workflow documented in how-to (page triggers fetch; test asserts backend log + optional network source when Metro attached in CI) | Task 5.2 |

If CI cannot attach Metro CDP reliably, Task 5.2 records `None — Metro CDP not in CI` and E2
becomes a manual evidence step in Task 5.1 only; unit/E1 coverage remains required.

## Regression cases

None — no hard-to-automate change

## User guide

None — operator/agent documentation only; no end-user workflow change

## Acceptance Criteria

- [ ] `read_logs` documents and returns entries with `source: "network"` when the app performs
  fetch/XHR over CDP, with auth headers redacted in captured output.
- [ ] `read_logs` documents and returns entries with `source: "native"` on Android (adb) and
  iOS Simulator when tools are available, with clear status when not.
- [ ] `dispatch_client_action` dispatches a known action in `example-frontend` under
  `TERRENO_MCP_EVAL=1` and `get_client_state` reflects the new state.
- [ ] `read_local_storage` / `write_local_storage` round-trip a key in `example-frontend` dev
  build; write refused without `TERRENO_MCP_EVAL=1`.
- [ ] `list_dev_commands` / `invoke_dev_command` list and run the example-frontend registered
  command with EVAL gate on invoke only.
- [ ] Reference and how-to pages list every new tool and source with real output captured in
  Task 5.1.
- [ ] `bun run mcp:build`, affected package tests, and `bun run lint` pass.
