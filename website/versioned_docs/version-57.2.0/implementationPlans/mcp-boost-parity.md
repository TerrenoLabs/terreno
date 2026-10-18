# Implementation Plan: MCP Server — Boost Parity (Docs Search, Local Runtime Tools, Per-Package Guidelines, Upgrade Prompts)

**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1085
*When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team. Once you have finished or you make any changes, tag Josh with the @ symbol so he can review. Also tag anyone else that needs to be notified, has conflicting work, etc.*

## Overview

[laravel/boost](https://github.com/laravel/boost) is Laravel's MCP server for AI-assisted development. Its value comes from runtime context: it runs *inside* each app (stdio) and gives agents database schema, logs, last error, browser console output, and version-aware doc search. Terreno's MCP server is the opposite shape — a hosted, stateless codegen/docs service with no visibility into the consuming app.

This plan closes the gap with five additions, ordered by value:

1. **Docs search tools** on the hosted server (`terreno_search_docs`, `terreno_get_component_docs`) — agents call tools; they rarely read passive MCP resources.
2. **A local stdio companion** (`@terreno/mcp`, `terreno-mcp-local` bin) that runs inside consumer apps and exposes runtime introspection: package versions, Mongo schema, read-only queries, backend logs, last error.
3. **Unified log capture (backend + app + bundler)** — one `read_logs` tool merging backend winston logs, the running app's console output (read over Chrome DevTools Protocol from Metro — no app code changes), Metro build errors, and a POST-based fallback logger for cases CDP can't reach. Boost's most original feature, and arguably more valuable for React Native where agents can't see the simulator.
4. **Per-package guidelines and skills** — move AI guideline content out of the monolithic `mcp-server/src/bootstrap.ts` (~2,900 lines) into each package's `.ai/` directory, composed at build time and shipped in published npm packages.
5. **Upgrade prompts** — per-release upgrade notes plus a `terreno_upgrade` prompt. Frontend/Expo SDK work delegates to the official [`upgrading-expo` skill](https://github.com/expo/skills/tree/main/plugins/expo/skills/upgrading-expo) from `expo/skills`; the prompt handles the Terreno-specific parts (`@terreno/ui`, `@terreno/rtk`, `@terreno/api`).
6. **Simulator/web app control** — compose existing MCP servers (official `expo-mcp` for simulator tap/screenshot, Playwright MCP for web, Maestro for E2E flows) via bootstrap wiring rather than building UI automation ourselves, and add a small set of Terreno-differentiated runtime tools (RTK state inspection, expo-router navigation, opt-in JS evaluate) over CDP. See the ecosystem survey in Phase 6.

**Key design decisions:**

- The hosted server stays stateless and unauthenticated; everything project-specific lives in the new local stdio server.
- `mcp-server` becomes a published package (`@terreno/mcp`) so consumers can run `bunx terreno-mcp-local` — it joins the nine lockstep-versioned packages in `publish-on-tag.yml`.
- Search is in-process BM25 (e.g. `minisearch`) over markdown chunked by heading — no external search service, works on Cloud Run with the index built at startup from bundled docs.
- The local server never imports consumer code. It reads `package.json`/`bun.lock`, connects to Mongo via the consumer's `.env`, and tails log files. This avoids version conflicts between the MCP's dependencies and the app's.
- Mongo query tool is read-only by allowlist (`find`, `aggregate` without `$out`/`$merge`, `countDocuments`, `distinct`), mirroring Boost's SQL allowlist.
- Log tools require `@terreno/api` to gain an opt-out dev-only file transport (`.terreno/logs/app.log`) since the winston logger is currently console-only (`api/src/logger.ts`).
- App console logs are read over the Chrome DevTools Protocol that Metro already exposes (`/json/list` + `/inspector/debug` from `@react-native/dev-middleware`) instead of patching `console` in app code. This is zero-instrumentation and also unlocks `Runtime.evaluate` for the control tools in Phase 6. A POST-to-backend fallback logger covers what CDP can't reach (web browsers when not driven by Playwright, non-dev builds on physical devices).
- For UI automation we compose existing MCP servers (official `expo-mcp`, Playwright MCP, Maestro) instead of building tap/screenshot tools — that space is mature and Expo now ships it first-party. We only build runtime tools where Terreno has an information advantage: we control store creation (`generateAuthSlice`) and routing conventions, so RTK state inspection and expo-router navigation can be reliable rather than heuristic.

**Related work:** `docs/implementationPlans/model-router-mcp.md` adds MCP tools to consumer apps' own APIs — that is the *app's* MCP surface; this plan is about the *development-time* MCP surface. The companion plan `docs-site-and-versioning.md` covers versioned documentation, which `terreno_search_docs` will consume once it exists.

## Phase 1: Docs Search Tools (hosted server)

### New files

```
mcp-server/src/search/
├── chunker.ts      # Split markdown into heading-level chunks with breadcrumb titles
├── index.ts        # Build minisearch index at startup from docs dir
└── search.ts       # Query API: multi-query, score merge, token-limited markdown output
```

### Tools (added in `mcp-server/src/tools.ts`)

```typescript
terreno_search_docs({
  queries: string[];      // multiple queries, like Boost ("toggle" vs "switch")
  packages?: string[];    // filter to @terreno/api, @terreno/ui, etc.
  tokenLimit?: number;    // default 3000, capped
})
// Returns ranked markdown chunks with source attribution.

terreno_get_component_docs({
  component: string;      // e.g. "Button"
})
// Returns the full props table for one @terreno/ui component from
// ui-types-documentation.json, plus any matching markdown docs.
```

### Corpus

- `mcp-server/src/docs/resources/*.md` (existing five bundles)
- `docs/**/*.md` from the monorepo (Diátaxis tree) — extend the `sync-ui-docs` script in `mcp-server/package.json` into a `sync-docs` script that copies both
- `ui-types-documentation.json` component entries, rendered to markdown chunks (one per component)

### Notes

- Update tool descriptions to instruct agents: "use this tool before guessing at Terreno APIs" (Boost's `search-docs` description does this aggressively and it works).
- Keep the existing static resources; they cost nothing.
- Tests in `mcp-server/src/__tests__/search.test.ts`: chunking, ranking sanity ("button" finds Button component), token truncation, package filtering.

## Phase 2: Per-Package Guidelines & Skills

### Structure

Each published package gains an `.ai/` directory:

```
api/.ai/
├── guidelines/core.md          # modelRouter, permissions, TerrenoApp patterns
└── skills/mongoose-schema-safety/SKILL.md   # moved from .rulesync/skills (consumer-relevant parts)
ui/.ai/guidelines/core.md
rtk/.ai/guidelines/core.md
admin-backend/.ai/guidelines/core.md
...
```

- Add `.ai` to each package's `files` in `package.json` so guidelines ship to `node_modules` (the Boost pattern: vendor packages carry their own guidelines).
- `mcp-server` gains a build step (`sync-package-guidelines`) that collects `*/.ai/**` into `src/docs/guidelines/<package>/`.

### Behavior changes

- `terreno_bootstrap_ai_rules` composes its output from the collected per-package files instead of inline strings in `bootstrap.ts`. Add an optional `packages` input (the agent passes the consumer's `@terreno/*` deps from `package.json`) so apps without e.g. `admin-backend` don't get admin guidelines.
- `bootstrap.ts` shrinks to orchestration + app-scaffold templates; guideline content lives next to the code it describes and is reviewed in the same PRs.
- The `improve-rulesync` skill should be updated to point contributors at the per-package `.ai/` dirs.

### Versioned guidelines (forward-looking)

Boost keys guidelines by package major version (`.ai/laravel/11/`, `12/`). Terreno releases in lockstep, so a flat `core.md` is fine until a breaking release; at that point add `.ai/guidelines/<major>/core.md` and have the composer pick by the consumer's installed version.

## Phase 3: Local Stdio Companion (`terreno-mcp-local`)

### Packaging

- Rename/publish `mcp-server` as `@terreno/mcp` with two bins:
  - `terreno-mcp` — existing HTTP entry (`src/index.ts`), unchanged
  - `terreno-mcp-local` — new stdio entry (`src/local/index.ts`) using `StdioServerTransport`
- Add to `publish-on-tag.yml` (depends on `publish-api` since it imports the logger).
- `terreno_bootstrap_app` writes both servers into the generated `.cursor/mcp.json`:

```jsonc
{
  "mcpServers": {
    "terreno": { "type": "http", "url": "https://mcp.terreno.flourish.health/mcp" },
    "terreno-local": { "command": "bunx", "args": ["terreno-mcp-local"] }
  }
}
```

### Tools

```
src/local/tools/
├── applicationInfo.ts   # application_info
├── databaseSchema.ts    # database_schema
├── databaseQuery.ts     # database_query
├── readLogs.ts          # read_logs, last_error (Phase 4)
└── runtime.ts           # evaluate, get_rtk_state, navigate (Phase 6, CDP)
```

- **`application_info`** — parse the consumer's root + workspace `package.json` and `bun.lock`; report `@terreno/*` versions, expo, react-native, mongoose, bun. Tool description copies Boost's trick: *"Use this tool at the start of each chat and write version-specific code."*
- **`database_schema`** — connect using `MONGO_URI` from the consumer backend's `.env`; list collections, indexes, and document counts; additionally parse `backend/src/models/*.ts` (static, no imports) to report declared fields, types, refs, and plugins. Summary mode + name filter, like Boost.
- **`database_query`** — read-only allowlist: `find`, `aggregate` (rejecting `$out`/`$merge`/`$function`), `countDocuments`, `distinct`. Hard result cap (default 50 docs), JSON output.

### Required `@terreno/api` change

`api/src/logger.ts` gains a dev-only file transport: when `NODE_ENV !== "production"` (or `TERRENO_LOG_FILE` is set), winston also writes JSONL to `.terreno/logs/app.log` with rotation (cap ~5MB). `.terreno/` is added to the generated app's `.gitignore` by bootstrap.

### Project-root discovery

The local server resolves the consumer project root by walking up from `cwd` to the nearest `package.json` with a `backend`/`frontend` workspace (the bootstrap layout), with a `TERRENO_PROJECT_ROOT` override.

## Phase 4: Unified Log Capture (backend + app + bundler)

One tool instead of Boost's three (`read-log-entries`, `browser-logs`, `last-error` split):

- **`read_logs({ sources?, entries, level?, since? })`** — merges entries chronologically across sources, each tagged with its origin:
  - `backend` — `.terreno/logs/app.log` JSONL written by the winston file transport (Phase 3), including request logs from `@terreno/api`'s request logging middleware.
  - `app` — console output from the running native app, captured over CDP (below).
  - `metro` — bundler build errors (`build_failed`, `bundling_error`) from Metro's `/events` WebSocket.
  - `browser` — fallback file `.terreno/logs/browser.log` fed by the POST logger (below).
- **`last_error({ sources? })`** — most recent `error`-level entry with stack across backend and app sources. The agent's first stop after "it broke".

### App console capture via CDP (primary, zero app code)

Metro exposes the Chrome DevTools Protocol through `@react-native/dev-middleware`: `GET /json/list` returns debuggable targets with a `webSocketDebuggerUrl`; attaching and enabling the `Runtime` domain streams `Runtime.consoleAPICalled` events (all console levels, with stack traces, symbolicated via the source map). `terreno-mcp-local` keeps a ring buffer of these events. This is the approach proven by [`metro-mcp`](https://github.com/steve228uk/metro-mcp) and [`expo-metro-mcp`](https://github.com/synnode/expo-metro-mcp).

**Hermes constraint:** Hermes accepts a single CDP debugger connection. Opening React Native DevTools (pressing `j` in Metro) steals it. v1 mitigation: connect lazily, buffer, and release cleanly, with the connection status reported by the tool; if contention proves painful, adopt metro-mcp's CDP-proxy multiplexing approach (or take `metro-mcp` as a dependency) rather than building our own proxy first.

### POST fallback logger (secondary, covers CDP gaps)

CDP reaches dev builds connected to Metro. It does not cover web browsers (when the agent isn't driving them via Playwright, which exposes console messages itself) or device builds not attached to a dev server. For those, a `DevConsoleLogger` module (no-op unless `__DEV__`): patches `console.error`/`console.warn`, registers `ErrorUtils.setGlobalHandler` (native) and `window.onerror` + `unhandledrejection` (web), batches entries to the backend. `TerrenoApp` auto-registers `POST /__terreno/browser-logs` only when `NODE_ENV === "development"`, appending JSONL to `.terreno/logs/browser.log` (route 404s in production). Wired into the bootstrap frontend template; existing apps add one import.

## Phase 5: Upgrade Prompts

### Upgrade notes as release artifacts

- New directory `mcp-server/src/docs/upgrades/<version>.md` — one note per release that has breaking or notable changes (what changed, codemod-style instructions, before/after snippets).
- Update `.rulesync/skills/release/SKILL.md`: when the release skill flags breaking changes, writing `upgrades/<version>.md` becomes a required step before tagging.

### Prompt and tool

- **Tool `terreno_get_upgrade_guide({ fromVersion, toVersion })`** — concatenates all upgrade notes in the version range (lockstep versioning makes the range unambiguous). Usable by agents without prompt support.
- **Prompt `terreno_upgrade({ targetVersion? })`** — workflow:
  1. Determine current `@terreno/*` versions (local `application_info` or `package.json`).
  2. Call `terreno_get_upgrade_guide` for current → target.
  3. **Backend:** apply note instructions; bump `@terreno/api`, `@terreno/ai`, etc.; run backend tests.
  4. **Frontend/Expo:** install and invoke the official `upgrading-expo` skill (`bunx skills add expo/skills` if not present) for the Expo SDK/dependency portion — `npx expo install expo@latest`, `expo install --fix`, `expo-doctor`, cache clearing, breaking-change checklist. Do not duplicate that content in our notes.
  5. **Terreno frontend:** apply `@terreno/ui` / `@terreno/rtk` note instructions, regenerate the SDK (`generate-sdk` skill), verify with `compile` + lint.
- `terreno_bootstrap_ai_rules` adds a pointer to `expo/skills` in the generated frontend rules so consumer agents discover `upgrading-expo` organically.

## Phase 6: Simulator & Web App Control

Goal: the agent can drive the running app — tap, type, screenshot, navigate, inspect state — not just read its logs.

### Ecosystem survey (what already exists)

| Project | What it controls | Mechanism | Notes for Terreno |
|---|---|---|---|
| [`expo-mcp` (official Expo MCP)](https://docs.expo.dev/eas/ai/mcp/) | Running Expo app in simulator/emulator | Hosted server (`https://mcp.expo.dev/mcp`, OAuth) + local capabilities via `expo-mcp` package and `EXPO_UNSTABLE_MCP_SERVER=1 npx expo start` | `automation_tap` (x/y or `testID`), `automation_take_screenshot` (full or by `testID`), `automation_find_view`, `open_devtools`, `collect_app_logs`, expo-router sitemap; plus hosted docs search and EAS build/log/crash inspection. First-party fit for Terreno apps; flag-gated "unstable", free plan has usage limits on hosted tools |
| [`microsoft/playwright-mcp`](https://github.com/microsoft/playwright-mcp) | Web app (Expo web export / `expo start --web`) | Accessibility-tree-driven browser automation | The standard for web control; also surfaces browser console messages and network, covering web log capture |
| [Maestro MCP](https://docs.maestro.dev/get-started/maestro-mcp) (`maestro mcp`, bundled in CLI) | iOS sim, Android emulator, real devices, Chromium | Maestro engine: `list_devices`, `inspect_screen` (view hierarchy), `tap_on`, `input_text`, `run_flow` (YAML), screenshots, embedded device Viewer | Works on compiled apps with no instrumentation; natural bridge from agent exploration to durable E2E flows |
| [`mobile-next/mobile-mcp`](https://github.com/mobile-next/mobile-mcp) | iOS/Android sims, emulators, and real devices | Accessibility APIs, WebDriverAgent (iOS), ADB/UI Automator (Android) | Framework-agnostic, strongest real-device story; heavier prerequisites (Xcode/Android SDK) |
| [`steve228uk/metro-mcp`](https://github.com/steve228uk/metro-mcp) | RN runtime via Metro | CDP: console, network, errors, evaluate, Redux state + dispatch, component tree, AsyncStorage, expo-router state, deep links, simulator control, profiler, test recorder; CDP proxy multiplexes Hermes's single connection | Closest existing project to what Phase 4/6 builds; reference implementation, or candidate dependency |
| [`synnode/expo-metro-mcp`](https://github.com/synnode/expo-metro-mcp), [`jeffdhooton/expo-agent-bridge`](https://github.com/jeffdhooton/expo-agent-bridge) | RN logs/runtime | CDP log buffer + flag-gated `evaluate`; agent-bridge adds an in-app plugin for nav/store/network state | Smaller validations of the same CDP pattern |

### Decision: compose for UI automation, build only Terreno-differentiated runtime tools

**Compose (bootstrap wiring, no new automation code):**

- `terreno_bootstrap_app` adds `expo-mcp` to the frontend dev dependencies, sets `EXPO_UNSTABLE_MCP_SERVER=1` in the generated dev script, and writes the Expo MCP and Playwright MCP entries into the generated `.cursor/mcp.json` alongside the two Terreno servers. Generated AI rules explain which server to use for what (simulator interaction → expo-mcp; web → Playwright; Mongo/logs/codegen → terreno).
- Generated rules recommend Maestro MCP (opt-in, requires Maestro CLI) when the user asks for E2E tests — the agent explores with expo-mcp, then captures the flow as Maestro YAML via `run_flow`/test generation.
- `mobile-mcp` documented as the real-device option; not wired by default.

**Build (in `terreno-mcp-local`, reusing the Phase 4 CDP connection):**

- **`evaluate({ code })`** — `Runtime.evaluate` in the app's Hermes runtime. Opt-in via `TERRENO_MCP_EVAL=1`, mirroring Boost's config-gated Tinker tool. Supports async expressions; results JSON-serialized.
- **`get_rtk_state({ slice?, query? })`** — inspect the Redux store: auth slice, RTK Query cache entries (endpoint, args, status, error), pending mutations. Reliable rather than heuristic because `@terreno/rtk` will expose the store on a dev-only global (`globalThis.__TERRENO_STORE__`, set inside `generateAuthSlice` when `__DEV__`) — this is the small `@terreno/rtk` change this phase needs.
- **`navigate({ path })`** — expo-router navigation via evaluated `router.push(path)`, plus a deep-link fallback (`xcrun simctl openurl` / `adb shell am start`) when no CDP target is attached. Combined with expo-mcp's screenshot tool, this gives the agent "go to screen X and look at it" in two calls.

### What we deliberately do not build

Tap/swipe/type/screenshot/view-hierarchy tools, device lifecycle management, and test recording — all covered by the composed servers above, with Expo now shipping the core interactions first-party.

## Notifications

None.

## UI

No new UI surfaces. Phase 4 adds the invisible `DevConsoleLogger` fallback to the frontend template; Phase 6 adds a dev-only store global to `@terreno/rtk`.

## Phases & Dependency Order

| Phase | Scope | Depends on |
|-------|-------|------------|
| 1. Docs search tools | `mcp-server` only | — |
| 2. Per-package guidelines | all packages + `mcp-server` | — (parallel with 1) |
| 3. Local stdio server | `mcp-server` packaging, `@terreno/api` logger | publish pipeline change |
| 4. Unified logs (backend + app + Metro) | local MCP CDP client, `@terreno/api`, template fallback logger | 3 |
| 5. Upgrade prompts | `mcp-server`, release skill | 1 (notes searchable), benefits from 3 |
| 6. App control | bootstrap wiring (`expo-mcp`, Playwright), local MCP runtime tools, `@terreno/rtk` dev global | 4 (shares the CDP connection) |

## Feature Flags & Migrations

- No data migrations.
- File logging and the browser-logs endpoint are dev-only by environment check, with `TERRENO_LOG_FILE` / `TERRENO_BROWSER_LOGS` env overrides to disable.
- Publishing `@terreno/mcp` is additive; the hosted Cloud Run deployment is unchanged.

## Risks

- **Read-only enforcement on Mongo** is allowlist-based; `aggregate` stage filtering must be tested against bypass attempts (`$out` nested in `$facet`, etc.).
- **Local server vs. consumer env drift**: reading `.env` directly can miss values injected by other tooling; document `TERRENO_PROJECT_ROOT` and `MONGO_URI` overrides.
- **Doc search quality**: BM25 over chunks is keyword-level, not semantic. Acceptable for v1; the docs-site plan's search index is the upgrade path.
- **Hermes single CDP connection**: the log/runtime tools contend with React Native DevTools for the one debugger slot. Lazy connect/release is the v1 answer; a CDP multiplexing proxy (metro-mcp's approach) is the fallback if contention is a real-world problem.
- **`expo-mcp` instability**: Expo gates local capabilities behind `EXPO_UNSTABLE_MCP_SERVER=1` and warns the tool list may change; hosted tools meter usage per Expo account (OAuth). Bootstrap wiring should treat it as optional and degrade gracefully.
- **`evaluate` is arbitrary code execution** in the user's app runtime — opt-in env flag, never enabled by bootstrap defaults, mirroring Boost's Tinker posture.
