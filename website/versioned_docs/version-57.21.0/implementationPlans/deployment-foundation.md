# Implementation Plan: Deployment Foundation

**Status:** Complete — blocking questions resolved 2026-07-29; all tasks executed
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1011
**Priority:** High
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)
**Depends on:** none (soft: [`docs-reference-coverage`](docs-reference-coverage.md) for the env var reference page)
**RTK deprecation flag:** **Partial** — the client environment-variable section and the web build output depend on the frontend data layer. Tasks touching client env vars and Better Auth origins are `[RTK]` marked.

## Goal

Establish the provider-agnostic layer that every deployment guide needs, so [`deploy-to-vercel`](deploy-to-vercel.md) and [`deploy-to-gcp`](deploy-to-gcp.md) can be short and specific instead of each re-explaining the same eight concepts. Right now there is no canonical answer to "what does a Terreno app need in order to run in production?" — the environment variables are spread across `docs/reference/environment-variables.md`, `AGENTS.md`, package rules, and several `.env.example` files; there is no backend Dockerfile in the repo for consumers to copy; and nothing explains the choice between Expo's three web output modes.

## Non-Goals

- Provider-specific instructions (separate IPs per provider).
- Implementing SSR (that is [`web-ssr-and-admin-spa`](web-ssr-and-admin-spa.md); this IP only documents that `single` is today's default and what the alternatives mean).
- CI/CD pipeline templates for consumers.
- Monitoring, alerting, or log aggregation setup.

## Blocking questions

**Recorded 2026-07-29** (defaults accepted).

| # | Question | Decision |
|---|----------|----------|
| DF1 | Reference backend `Dockerfile`? | **A** — canonical `example-backend/Dockerfile`; docs reference it |
| DF2 | Base image | **A** — `oven/bun:1-slim` |
| DF3 | Default web output mode | **A** — `single` (SPA) today + decision table for `static` / `server` |
| DF4 | Health endpoint required? | **A** — require `@terreno/api-health` |
| DF5 | Staging environment | **B** — short two-environment section |
| DF6 | File uploads default | **C** — document GCS; verify backends before writing |

## Architecture

### The deployment baseline

Every Terreno production deployment needs these seven things. The foundation doc names them once; provider guides map them to provider primitives.

| # | Requirement | Why | Where it is configured |
|---|-------------|-----|------------------------|
| 1 | MongoDB **replica set** | Change streams power realtime and live feature flags; a standalone server fails at startup | `MONGO_URI` |
| 2 | Auth secrets | JWT signing and sessions | `TOKEN_SECRET`, `TOKEN_ISSUER`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET`; Better Auth adds `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` |
| 3 | A long-lived process for the backend | Socket.io connections; not compatible with short-timeout serverless | Provider service config |
| 4 | Correct origins | CORS (`corsOrigin`) plus Better Auth `trustedOrigins` including native deep-link schemes | Backend config |
| 5 | Build-time client config | `EXPO_PUBLIC_API_URL` is inlined into the web bundle at build time; it cannot be changed after the fact | Web build environment |
| 6 | A health endpoint | Readiness and liveness probes | `@terreno/api-health` |
| 7 | File storage | Uploads must not live on ephemeral container disk | GCS bucket + credentials |

Requirements 1, 3, and 5 are the ones people get wrong. Each needs its failure symptom documented, not just the rule.

### Web output modes

Expo Router offers three, and the choice determines what hosting works:

| Mode | Output | API routes | SSR | Hosting | Status in Terreno |
|------|--------|-----------|-----|---------|-------------------|
| `single` | one `index.html` SPA | no | no | any static host | **current default** |
| `static` | per-route HTML | no | no | any static host | usable now; better SEO |
| `server` | `dist/client` + `dist/server` | yes | yes (alpha, SDK ≥ 55) | needs a Node/Bun/edge runtime | not yet — see the SSR IP |

The repo is currently on Expo `~54.0.29` (root `package.json` catalog), so `server` output with SSR requires the SDK upgrade tracked in PR [#779](https://github.com/TerrenoLabs/terreno/pull/779). The foundation doc must state this rather than implying SSR is available.

### Backend container

A multi-stage Bun build that works for a monorepo consumer *and* for the repo's own `example-backend`:

1. Stage 1: install with the lockfile, compile workspace packages.
2. Stage 2: copy the built output, run as a non-root user, read `PORT` from the environment (platforms assign it), expose the health endpoint.

The critical detail platforms trip on: the server must bind `0.0.0.0` and read `PORT` from the environment rather than hardcoding 4000. Verify how `example-backend` currently resolves its port before writing the Dockerfile.

### Environment variable reference

`docs/reference/environment-variables.md` exists but must become the single source of truth: every variable, which package reads it, required or optional, default, whether it is a secret, and whether it is build-time (client) or runtime (server). The build-time/runtime distinction is the one that causes production incidents, because `EXPO_PUBLIC_*` values are baked into the bundle.

## Models / APIs / Notifications / UI

None.

## Phases

1. **Environment variable reference** — audit every variable in every package and complete the reference table.
2. **Deployment baseline explainer** — the seven requirements, the output-mode table, environment differences.
3. **Backend container** — `example-backend/Dockerfile`, a `.dockerignore`, and a CI job that builds it.
4. **Web build documentation** — how to build for web, build-time config, the output-mode decision.

## Feature Flags & Migrations

None.

## Not Included / Future Work

- Consumer CI/CD templates.
- Monitoring, tracing, and log aggregation guidance (Sentry is already wired; a production-observability guide is a good follow-up).
- Blue/green or canary deployment patterns.
- Database backup and restore procedures.

## Files to Create / Modify

**Create**

- `docs/explanation/deployment-baseline.md`
- `docs/how-to/build-for-web.md`
- `example-backend/Dockerfile`, `example-backend/.dockerignore`
- `.github/workflows/example-backend-docker.yml`

**Modify**

- `docs/reference/environment-variables.md`
- `docs/how-to/README.md`, `docs/explanation/README.md`
- `example-backend/.env.example`, `example-frontend/.env.example`
- `example-backend/src/server.ts` (only if it does not already read `PORT` and bind `0.0.0.0`)

## Task List

See [`docs/tasks/deployment-foundation.md`](../tasks/deployment-foundation.md).

## Acceptance Criteria

- [ ] `docs/reference/environment-variables.md` lists every environment variable read anywhere in the repo, with reading package, required/optional, default, secret flag, and build-time versus runtime.
- [ ] A grep for `process.env.` and `EXPO_PUBLIC_` across all packages finds no variable absent from the reference.
- [ ] `docs/explanation/deployment-baseline.md` documents all seven baseline requirements, each with the symptom that occurs when it is missed.
- [ ] The web output-mode table states Terreno's current default and that `server` output requires Expo SDK ≥ 55.
- [ ] `example-backend/Dockerfile` builds successfully and the container serves `/health` returning `"healthy":true` against an external MongoDB.
- [ ] The container reads `PORT` from the environment and binds `0.0.0.0`, verified by running it with `PORT=9999`.
- [ ] The container runs as a non-root user.
- [ ] A CI job builds the Docker image on changes to `example-backend/` or `api/`.
- [ ] `docs/how-to/build-for-web.md` explains that `EXPO_PUBLIC_API_URL` is inlined at build time and shows the symptom when it is set only at runtime.
- [ ] Both `.env.example` files contain every required variable with safe placeholder values and no real secrets.
