# Task List: MCP Agent Debugger Gaps

See: [`docs/implementationPlans/mcp-agent-debugger-gaps.md`](../implementationPlans/mcp-agent-debugger-gaps.md)

## Instructions for the implementing agent

- Implement in phase order (1 → 5). Phases 2 and 3 may overlap after Phase 1 lands CDP Network
  enablement.
- Every tool and `read_logs` source documented in `docs/reference/mcp-server.md` must be exercised
  in Task 5.1; paste **real** JSON/text into the docs (no fabricated examples).
- State-changing tools (`dispatch_client_action`, `write_local_storage`, `invoke_dev_command`)
  must refuse when `TERRENO_MCP_EVAL` is unset, matching `evaluate` / `navigate`.
- Run `bun run mcp:build`, `bun run compile`, and `bun run lint` before each commit. Run tests
  under `mcp-server/` and any touched package (`syncdb`, `create-terreno-app`).
- Update docs in the same slice as code (`update-docs` skill conventions).

## Phase 1: CDP network capture

- [x] **Task 1.1**: Enable Network domain on the Metro CDP session
  - Description: In `metroDevSession.ts`, after the debugger WebSocket attaches, send
    `Network.enable` alongside `Runtime.enable`. Handle `Network.requestWillBeSent`,
    `Network.responseReceived`, and optionally `Network.loadingFailed`. Push normalized entries
    onto a dedicated ring with redaction for sensitive headers and truncated text bodies. Export
    `snapshotNetworkRing()` for `readLogs`. Add unit tests with mocked WebSocket messages.
  - Files: `mcp-server/src/local/metro/metroDevSession.ts`, `mcp-server/src/local/metro/metroDevSession.test.ts`
  - Depends on: —
  - Acceptance: tests cover at least one request/response pair and header redaction; ring respects
    max size.

- [x] **Task 1.2**: Wire `network` into `read_logs` and connection status
  - Description: Extend `readLogs.ts` to include source `network` in default merge and in
    `sources` filtering. Include network buffer status in the JSON `connection` block (same
    pattern as `app` / metro events). Ensure `last_error` does not treat HTTP 4xx as error
    unless the captured entry level is `error` (network entries default to `info`).
  - Files: `mcp-server/src/local/tools/readLogs.ts`, tests beside readLogs or metro session
  - Depends on: Task 1.1
  - Acceptance: `read_logs` with `sources: ["network"]` returns entries after a mocked CDP
    response; merged output sorts by timestamp with other sources.

- [x] **Task 1.3**: Local server E2E for network source
  - Description: Extend `localServer.e2e.test.ts` (or dedicated test) so the MCP client calls
    `read_logs` and receives a `network`-sourced line from the test harness CDP mock — satisfies
    E1 in the IP.
  - Files: `mcp-server/src/local/localServer.e2e.test.ts`
  - Depends on: Task 1.2
  - Acceptance: E1 passes in CI; `bun run mcp:build` succeeds.

## Phase 2: Dispatch and local storage

- [x] **Task 2.1**: `registerTerrenoDevStorage` in `@terreno/syncdb`
  - Description: Add dev-only registry on `globalThis.__TERRENO_DEV_STORAGE__` with AsyncStorage
    wiring and optional SecureStore allowlist. Export from `@terreno/syncdb` and
    `@terreno/syncdb/devMcpRegistry` (concrete path per no-barrel rules). Tests with mocked
    AsyncStorage. No-op when not `__DEV__`.
  - Files: `syncdb/src/devMcpRegistry.ts` (or split), `syncdb/src/index.ts`, tests
  - Depends on: —
  - Acceptance: tests prove list/get/set; production guard no-ops.

- [x] **Task 2.2**: `registerTerrenoDevCommand` in `@terreno/syncdb`
  - Description: Dev-only map on `globalThis.__TERRENO_DEV_COMMANDS__` with register/list
    metadata and serializable `inputSchema` (JSON Schema subset). Handler invocation only through
    a single `runTerrenoDevCommand(name, args)` used by MCP evaluate path. Tests for register,
    duplicate name error, and invoke.
  - Files: same module as Task 2.1, tests
  - Depends on: Task 2.1 (same file OK)
  - Acceptance: handler runs in test via direct call; registry cleared between tests.

- [x] **Task 2.3**: MCP tools `dispatch_client_action`, `read_local_storage`, `write_local_storage`
  - Description: Add tools in `localTools.ts` and handlers under `mcp-server/src/local/tools/`.
    Implement CDP evaluate fallbacks mirroring `get_client_state` / `evaluate`. Gate writes and
    dispatch on `TERRENO_MCP_EVAL=1`. Register schemas and descriptions (when to use vs
    `syncdb_action`).
  - Files: `mcp-server/src/local/localTools.ts`, new tool modules, `localTools.test.ts`
  - Depends on: Task 1.1 (CDP), Task 2.1
  - Acceptance: unit tests for EVAL gate, dispatch success/failure, storage read cap, write
    rejection without EVAL.

- [x] **Task 2.4**: Wire bootstrap and example app
  - Description: Call `registerTerrenoDevStorage({asyncStorage: true})` from bootstrap template
    and `example-frontend/app/_layout.tsx` (with `registerTerrenoDevStore` already present).
    Update `create-terreno-app` generated store if it duplicates layout wiring.
  - Files: `mcp-server/src/docs/templates/bootstrap/frontend/app/_layout.template.tsx`,
    `example-frontend/app/_layout.tsx`, `create-terreno-app/src/generate.ts` if needed
  - Depends on: Task 2.1, Task 2.3
  - Acceptance: example app compiles; manual smoke: `read_local_storage` returns persist keys
    after login.

## Phase 3: Native platform logs

- [x] **Task 3.1**: Native log collectors
  - Description: Add `mcp-server/src/local/native/` (or under `tools/`) with
    `snapshotNativeLogs({entries})` using adb and simctl as in the IP. Respect
    `TERRENO_NATIVE_LOGS=0` and `TERRENO_ADB_SERIAL`. Return structured `{lines, status}`.
  - Files: new module + tests with mocked spawn
  - Depends on: —
  - Acceptance: tests cover happy path, missing adb, missing sim; line cap enforced.

- [x] **Task 3.2**: `read_logs` source `native`
  - Description: Integrate Task 3.1 into `readLogs.ts`; document platform requirements in tool
    JSON output when empty.
  - Files: `readLogs.ts`, tests
  - Depends on: Task 3.1
  - Acceptance: `read_logs` with `sources: ["native"]` returns entries or explicit status.

## Phase 4: Dev command MCP surface

- [x] **Task 4.1**: MCP tools `list_dev_commands` and `invoke_dev_command`
  - Description: List metadata from registry via in-process or CDP read. Invoke via evaluate
    calling `runTerrenoDevCommand` (EVAL-gated). Wire in `localTools.ts`.
  - Files: `mcp-server/src/local/tools/devCommands.ts`, `localTools.ts`, tests
  - Depends on: Task 2.2, Task 2.3
  - Acceptance: list returns registered commands; invoke runs example handler in test mock.

- [x] **Task 4.2**: Example dev command
  - Description: Register one command in `example-frontend` (for example clear a dev-only
    AsyncStorage key or flip a debug flag) and document it in how-to as the sample invoke.
  - Files: `example-frontend/**` (small module + `_layout` import)
  - Depends on: Task 4.1, Task 2.4
  - Acceptance: with `TERRENO_MCP_EVAL=1`, invoke succeeds and effect observable via
    `read_local_storage` or `get_client_state`.

## Phase 5: Documentation and verification

- [x] **Task 5.1**: Capture real tool output
  - Description: Run example backend + frontend + Metro. Record verbatim output for: `read_logs`
    with `network` and `native` (or status when native unavailable), `dispatch_client_action`,
    `read_local_storage`, `write_local_storage`, `list_dev_commands`, `invoke_dev_command`.
    Save transcripts under `/opt/cursor/artifacts/` or `.terreno/pipeline/` for doc authors.
  - Files: none (evidence bundle)
  - Depends on: Tasks 1.3, 3.2, 4.2
  - Acceptance: evidence file paths referenced in PR body; every new surface has at least one
    captured sample.

- [x] **Task 5.2**: Update reference and explainer docs
  - Description: Update `docs/reference/mcp-server.md` (tool tables, env vars,
    can/cannot-see), `docs/how-to/debug-with-mcp.md` (symptom → tool table rows for wrong API
    data, auth token in storage, native-only crash), `docs/explanation/ai-development-loop.md`
    (Observe stage + cannot-see adjustments), `docs/reference/environment-variables.md`,
    `mcp-server/README.md`. Use Task 5.1 outputs only.
  - Files: listed above
  - Depends on: Task 5.1
  - Acceptance: grep for new tool names in reference matches `localTools.ts`; loop diagram
    mentions `network` and `native` sources.

- [x] **Task 5.3**: Browser E2E or documented CI skip
  - Description: Add `example-frontend/e2e/mcp-network-debug.spec.ts` per E2 if feasible; if Metro
    CDP is not available in CI, document skip in spec comment and IP Activity Log; ensure E1
    still satisfies automated proof.
  - Files: `example-frontend/e2e/mcp-network-debug.spec.ts` (optional)
  - Depends on: Task 5.2
  - Acceptance: E2 runs in `bun run frontend:e2e` or IP records why not.
