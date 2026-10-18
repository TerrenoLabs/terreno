# Implementation Plan: Deploy to Vercel + `deploy-vercel` Skill

**Status:** Approved — open Vercel spike TODOs; other decisions recorded (2026-07-29)
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1012
**Priority:** High
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)
**Depends on:** [`deployment-foundation`](deployment-foundation.md)
**RTK deprecation flag:** **Partial** — the web build and client configuration sections depend on the frontend data layer; the syncdb websocket transport also has implications for which parts of the app can be served from serverless functions. Marked tasks must be re-verified after PR #869.

## Goal

Give Terreno the fastest possible "my app is on the internet" path, and a skill that executes it. Vercel is where most JavaScript developers expect to deploy, and Expo Router has first-class Vercel support (`vercel.json` with `expo export -p web`, plus `expo-server/adapter/vercel` for server output). Terreno currently has zero Vercel documentation — the only occurrences of "Vercel" in the repo refer to the Vercel **AI SDK** inside `@terreno/ai`, which is a completely different thing and is itself a source of confusion worth addressing.

**Topology is not finalized.** A pre-implementation spike must answer whether a single-platform Vercel deploy (web + `@terreno/api` + file storage) is viable, or whether the documented path remains split (static web on Vercel, long-lived backend elsewhere). Until the spike completes, this IP documents the **interim split topology** and tracks open questions as TODOs.

## Non-Goals

- Committing to a Vercel backend topology before the spike (see **Open TODOs** below).
- Vercel-hosted MongoDB (does not exist; Atlas is the answer).
- Native app distribution (that is EAS; see the `expo-deployment` skill).

## Blocking questions

**Recorded 2026-07-29** (defaults accepted where not marked open).

| # | Question | Decision |
|---|----------|----------|
| V1 | Backend host | **Open — spike required.** Candidate: all-in-one on Vercel (web + backend + Blob storage). Fallback: Railway/Render/Fly + Vercel static web (see [`deployment-foundation`](deployment-foundation.md)). **Do not publish a final answer until TODOs below are closed.** |
| V2 | Document `server` output? | **Open — depends on V1 spike.** Default if documented: advanced section, Expo SDK ≥ 55, SSE buffering caveat |
| V3 | Commit `vercel.json`? | **Open — depends on V1 spike.** Candidate: wired to real deployment in `example-frontend` and `example-backend` |
| V4 | Preview deployments | **A** — include CORS + Better Auth `trustedOrigins` for preview URLs |
| V5 | Disambiguate Vercel AI SDK vs hosting | **A** — consistent phrasing: "the Vercel AI SDK" vs "Vercel (hosting)" |

## Open TODOs (pre-implementation spike)

Complete these before Phase 1 of the how-to guide ships:

- [ ] **V1-todo:** Can `@terreno/api` run on Vercel with Socket.io sessions and MongoDB change streams? Use [Vercel Functions WebSockets (Public Beta)](https://vercel.com/docs/functions/websockets) as the source of truth. Document runtime limits, Fluid compute, cold starts, max-duration disconnects, and that a connection is pinned to one function instance (not session affinity across reconnects).
- [ ] **V1-todo:** Write operator docs for websocket usage on Vercel Functions (see **Vercel Functions WebSockets** below). Link the beta page; do not copy it. Re-verify every config key and limitation against that page before the how-to ships.
- [ ] **V1-todo:** Can `@terreno/ai` SSE streaming work through `expo-server/adapter/vercel` without unacceptable buffering?
- [ ] **V1-todo:** Where do user file uploads land on an all-in-one Vercel deploy (Blob, external GCS, or other)?
- [ ] **V1-todo:** Compare all-in-one Vercel vs split (Vercel web + long-running backend) on cost, ops complexity, and preview-deployment ergonomics.
- [ ] **V2-todo:** If `server` output is documented, confirm Expo SDK ≥ 55+ requirements and list which Terreno features break under static/server export.
- [ ] **V3-todo:** If committing `vercel.json`, confirm CI/deploy wiring for `example-frontend` and `example-backend` and who owns the Vercel project.

## Architecture

### Interim topology (document until spike closes)

Until V1 is decided, document this split layout — it is known to work:

```mermaid
flowchart LR
  U["Users<br/>web + native"]
  V["Vercel<br/>Expo web export<br/>(single output)"]
  B["Long-running host<br/>@terreno/api + Socket.io"]
  A["MongoDB Atlas<br/>replica set"]
  S["Object storage<br/>uploads"]
  U -->|"web"| V
  U -->|"native"| B
  V -->|"XHR + websocket"| B
  B --> A
  B --> S
```

The web deployment is static; dynamic operations go to the backend. Vercel needs SPA rewrites and build-time `EXPO_PUBLIC_API_URL`.

### Candidate topology (if spike succeeds)

```mermaid
flowchart LR
  U["Users<br/>web + native"]
  VC["Vercel<br/>web + @terreno/api + storage"]
  A["MongoDB Atlas<br/>replica set"]
  U --> VC
  VC --> A
```

**Do not document this as the recommended path until all V1 TODOs are checked.**

### `vercel.json` for `single` output

Per Expo's published configuration, the SPA case needs rewrites so client-side routes resolve:

```json
{
  "buildCommand": "expo export -p web",
  "outputDirectory": "dist",
  "devCommand": "expo",
  "cleanUrls": true,
  "framework": null,
  "rewrites": [{ "source": "/:path*", "destination": "/" }]
}
```

### `vercel.json` for `server` output (advanced)

Server output changes the shape: `dist/client` is served statically and a function handles everything else via `expo-server/adapter/vercel`, with `includeFiles` pulling in `dist/server/**`. Document only after V2 TODOs close. Flag the streaming caveat for `@terreno/ai` chat.

### The preview-deployment problem

Vercel gives every PR a unique origin. That breaks two things:

1. **CORS** — `corsOrigin` in `setupServer` must accept the preview origin. Document a pattern (a function or regex matching `https://<project>-*.vercel.app`) rather than `corsOrigin: true`, and say plainly that `true` is not acceptable in production.
2. **Better Auth `trustedOrigins`** — same problem, separate config, and OAuth redirect URIs must be registered per provider.

This section ships regardless of V1 outcome.

### `deploy-vercel` skill

New skill at `.rulesync/skills/deploy-vercel/SKILL.md`:

1. **Detect** — is this an Expo Router web app; what is `web.output` in the app config; is there an existing `vercel.json`.
2. **Configure** — write or update `vercel.json` for the detected output mode; add the `vercel-build` script when using server output.
3. **Wire the backend** — determine the backend URL (per finalized V1 decision), set `EXPO_PUBLIC_API_URL` as a Vercel environment variable per environment (production/preview/development), and print the CORS and `trustedOrigins` changes the user must make on the backend.
4. **Deploy** — `vercel` / `vercel --prod`, with a confirmation gate before the first production deploy.
5. **Verify** — load the deployed URL, confirm the app boots, confirm an authenticated request reaches the backend, and confirm the websocket connects.
6. **Troubleshoot** — blank page (missing rewrites), 404 on refresh (same), API calls to localhost (`EXPO_PUBLIC_API_URL` not set at build time), CORS failure, websocket failure, buffered SSE on server output.

The verification step must include the websocket check. A Terreno web app can look completely fine while realtime and live feature flags are silently broken.

### Vercel Functions WebSockets (Public Beta) — required how-to

Vercel now documents WebSockets on Vercel Functions as **Public Beta**: [WebSockets](https://vercel.com/docs/functions/websockets). Phase 0 and the how-to must treat that page as the vendor contract. The Terreno page is operator docs for `@terreno/api` (`RealtimeApp` / Socket.io) and `@terreno/syncdb` on that runtime — not a reprint of Vercel’s examples.

**Ship** `docs/how-to/vercel-function-websockets.md`. Link it from `docs/how-to/deploy-web-to-vercel.md` and from `docs/how-to/websocket-integration.md`. Mark the feature **beta**; tell operators to re-read the Vercel page before production. Do **not** present all-in-one Vercel hosting as the recommended Terreno topology until the V1 TODOs close.

The published page must cover the following (cite the Vercel URL; keep examples Terreno-shaped).

#### What Vercel guarantees (as of the beta page)

| Fact | Terreno implication |
|------|---------------------|
| A WebSocket starts as HTTP `GET` with `Upgrade`. Routing Middleware, rewrites, Firewall, and rate limits apply **before** the upgrade. | Document Firewall rules and rate limits on the Socket.io path. Better Auth / JWT handshake auth still runs on the upgrade, same as today. |
| After upgrade, messages stay on the **same function instance** for the life of that connection. Fluid compute can multiplex many connections on one instance. | In-memory `socket.join` rooms work for one connection’s instance only. Cross-instance fan-out still needs the Redis adapter (`RealtimeApp` `adapter: "redis"` + `VALKEY_URL` / `REDIS_URL`). |
| New connections are **not** guaranteed to hit the same instance. After a deploy, **new** connections may land on the new deployment while **existing** connections stay on the old one until they close. | Presence, rooms, counters, and pub/sub must live in Redis (or equivalent), not process memory. Change-stream watchers are per instance — spike must record cost and fan-out via Redis. |
| The connection closes when the function hits **max duration**. Clients must reconnect, resubscribe, and reload state. | Document exponential backoff. `@terreno/rtk` `useSocketConnection` already reconnects; `@terreno/syncdb` must resubscribe after reconnect. Name the debug flag (`WEBSOCKETS_DEBUG` at time of writing). |
| Socket.IO is supported if the **client uses the WebSocket transport only** (`transports: ['websocket']`). Long-polling is not the Vercel path. | Terreno already documents `transports: ["websocket"]` in `docs/how-to/websocket-integration.md`. The Vercel page must restate that long-polling is forbidden on Functions. |
| Express (and Hono, etc.) can serve sockets by attaching `ws` / Socket.IO to a Node HTTP server and **`export default server`**. | Spike must map this to `TerrenoApp.build()` (or equivalent) vs `start()`. Today the process listens; a Function entry exports the HTTP server. Record the exact adapter file (`api/server.ts` or Expo `expo-server/adapter/vercel` is a **different** path — do not conflate web SSR with the API process). |
| Fluid compute is required. It is the default for new Vercel projects created on or after 2025-04-23. | Document how to confirm Fluid is on. Without it, do not host Terreno sockets on Functions. |
| Usage is billed as Function time while the socket is open, plus Fast Data Transfer / Fast Origin Transfer. | Include a cost warning in the all-in-one vs split comparison (V1 cost TODO). Long-lived sync sockets are not “free HTTP”. |

#### Required operator sections

1. **When to use this** — hosting `@terreno/api` (or a dedicated socket process) on Vercel Functions. When **not** to: static Expo `single` output on Vercel talking to a long-running backend (interim topology); native EAS; treating the Vercel **AI SDK** as this feature.
2. **Prerequisites** — Fluid compute; Function max duration set high enough for the product; Redis if more than one instance or rolling deploys; MongoDB Atlas replica set still required for change streams (unchanged).
3. **Socket.IO on a Function** — export an HTTP server with Socket.IO attached; client `path` and `transports: ['websocket']`; Terreno `RealtimeApp` + `SyncApp` still registered. Link Vercel’s Socket.IO snippet as the vendor shape, then show the Terreno registration, not a second copy of `ws` echo servers.
4. **Reconnects** — max-duration close; backoff; resubscribe; “looks fine while sync/flags are dead”.
5. **State** — no in-memory rooms across instances; Redis; deploy split-brain (old + new deployments both alive).
6. **Limits and pricing** — pointer to Vercel’s limits/pricing on that page; Function duration while connected.
7. **Verify** — DevTools Network → WS; `WEBSOCKETS_DEBUG`; confirm the client did **not** fall back to polling.

#### Explicitly out of scope for this page

- Next.js `experimental_upgradeWebSocket` from `@vercel/functions` (not Terreno’s server).
- Bun `Bun.serve()` / Python FastAPI examples (link the Vercel page; do not re-home them).
- Replacing MongoDB change streams with Vercel Queues or Vercel KV pub/sub as the Terreno protocol.

## Models / APIs / Notifications / UI

None.

## Phases

0. **Spike** — close all **Open TODOs** above; record decision on V1/V2/V3 in this file; write `docs/how-to/vercel-function-websockets.md` from the beta contract (may ship before V1 is decided, as constraints — not as a topology recommendation).
1. **How-to guide** — `single` output, clone → public URL (topology per V1 outcome); link the websocket Functions page.
2. **Preview deployments and origins** — CORS, `trustedOrigins`, OAuth redirects.
3. **Advanced: server output** — only if V2 is approved.
4. **Skill** — author and generate mirrors.
5. **Validate** — deploy examples per V3 outcome.

## Feature Flags & Migrations

None.

## Not Included / Future Work

- EAS native distribution (separate skill).
- Multi-region Vercel edge configuration.

## Files to Create / Modify

**Create**

- `docs/how-to/deploy-to-vercel.md` (blocked on Phase 0 spike)
- `docs/how-to/vercel-function-websockets.md` (Vercel Functions WebSockets beta; may ship during Phase 0)
- `.rulesync/skills/deploy-vercel/SKILL.md`

**Modify (after V3 decision)**

- `example-frontend/vercel.json` (candidate)
- `example-backend/vercel.json` (candidate — only if all-in-one path wins)

**Modify (with Task 0.2)**

- `docs/how-to/README.md`
- `docs/how-to/websocket-integration.md`

## Task List

See [`docs/tasks/deploy-to-vercel.md`](../tasks/deploy-to-vercel.md).

## Acceptance Criteria

- [ ] All **Open TODOs** are closed with a written decision on V1, V2, and V3.
- [ ] `docs/how-to/deploy-to-vercel.md` matches the decided topology (not the interim split doc if all-in-one wins, and vice versa).
- [ ] `docs/how-to/vercel-function-websockets.md` exists, cites [Vercel Functions WebSockets](https://vercel.com/docs/functions/websockets), covers Fluid compute, websocket-only Socket.IO, instance pinning, max-duration reconnects, Redis for cross-instance state, Function billing while connected, and Terreno `RealtimeApp` / syncdb — without recommending all-in-one until V1 is decided.
- [ ] Preview-deployment CORS and `trustedOrigins` guidance is present.
- [ ] `deploy-vercel` skill includes websocket verification in its checklist.
- [ ] Vercel AI SDK vs Vercel hosting disambiguation appears in both `@terreno/ai` and deployment docs.
