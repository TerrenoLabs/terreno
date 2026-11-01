# Task List: Deployment Foundation

See: [`docs/implementationPlans/deployment-foundation.md`](../implementationPlans/deployment-foundation.md)

**RTK deprecation flag:** **Partial.** Tasks marked `[RTK]` describe client environment variables and auth origins and must be re-checked after PR #869 merges. Unmarked tasks (env audit, Dockerfile, CI) are safe to implement immediately.

## Instructions for the implementing agent

- Derive facts from source, never from this task list. Where a task states a value (a port, a variable name, a default), verify it before writing it and correct the IP if it is wrong.
- Every claimed failure symptom must be one you reproduced or found quoted in the codebase/tests. Do not invent error messages.
- Do not add new runtime dependencies.
- Run `bun run lint` before each commit; `bun run compile` if you touch `example-backend/src/`.

## Phase 1: Environment variable reference

- [x] **Task 1.1**: Audit every environment variable in the repo
  - Description: Run `rg -n "process\.env\.[A-Z_]+" --glob '!node_modules' --glob '!*.test.ts'` and `rg -n "EXPO_PUBLIC_[A-Z_]+"` across the repo. Build a complete list of distinct variables with the file and package where each is read. Also check `Constants.expoConfig?.extra` reads in `rtk/src/constants.ts` (and the syncdb equivalent post-#869) since those are configured through `app.json` rather than the environment. Save the raw findings in the PR body.
  - Files: none (findings in the PR body)
  - Depends on: none
  - Acceptance: the list is generated from grep output, not hand-written; every entry names the reading file; `extra`-based config is listed separately from `process.env` reads.

- [x] **Task 1.2**: Complete `docs/reference/environment-variables.md`
  - Description: Restructure the page into tables grouped by concern (Database, Auth — JWT, Auth — Better Auth, AI, Storage, Feature flags, Observability, MCP, Client/build-time). Each row: variable, read by (package), required or optional, default, secret (yes/no), and scope (server runtime / client build-time). Add an explicit callout explaining that `EXPO_PUBLIC_*` variables are inlined into the JavaScript bundle at build time — they are not secrets and cannot be changed without rebuilding. Every variable from Task 1.1 must appear exactly once.
  - Files: `docs/reference/environment-variables.md`
  - Depends on: Task 1.1
  - Acceptance: every variable from the Task 1.1 audit appears; no variable is listed that does not appear in the audit; the build-time callout is present; secrets are marked.

- [x] **Task 1.3**: `[RTK]` Update the `.env.example` files
  - Description: Update `example-backend/.env.example` and `example-frontend/.env.example` so each contains every required variable for that app with safe placeholder values and a one-line comment per variable. Verify no real secret values are present. Add the Better Auth variables to the backend example, commented out, with a note pointing at `docs/how-to/configure-better-auth.md`.
  - Files: `example-backend/.env.example`, `example-frontend/.env.example`
  - Depends on: Task 1.2
  - Acceptance: starting each example app using only its `.env.example` (with placeholders replaced by real local values) works; no value in either file is a real credential; every required variable from the reference is present.

## Phase 2: Deployment baseline

- [x] **Task 2.1**: Write `docs/explanation/deployment-baseline.md`
  - Description: Explainer covering the seven baseline requirements from the IP. For each: what it is, why Terreno needs it, and the symptom when it is missing. Requirements 1, 3, and 5 need reproduced symptoms: (1) run the backend against a standalone `mongod` and quote the actual startup or change-stream error; (3) describe what happens to Socket.io on a platform with a short request timeout — cite the reconnect behavior in the client socket code; (5) build the web bundle with `EXPO_PUBLIC_API_URL` unset, then serve it and quote the resulting client-side failure. Requirement 6 must state that `@terreno/api-health` is part of the baseline (IP question DF4).
  - Files: `docs/explanation/deployment-baseline.md` (new)
  - Depends on: Task 1.2
  - Acceptance: all seven requirements documented; symptoms for 1, 3, and 5 are reproduced and quoted verbatim, not paraphrased.

- [x] **Task 2.2**: Add the web output-mode decision table
  - Description: Add a section to `docs/explanation/deployment-baseline.md` with the three-mode table from the IP (`single`, `static`, `server`) covering output shape, API-route support, SSR support, hosting requirements, and current Terreno status. State explicitly: `single` is today's default, `static` is available now and improves SEO, and `server` requires Expo SDK ≥ 55 while the repo catalog is on `~54.0.29` — link PR #779 and [`web-ssr-and-admin-spa`](../implementationPlans/web-ssr-and-admin-spa.md). Verify the current Expo version from the root `package.json` catalog rather than trusting this description.
  - Files: `docs/explanation/deployment-baseline.md`
  - Depends on: Task 2.1
  - Acceptance: table has all three modes with all five columns; the stated Expo version matches the root catalog; no text implies SSR is currently available.

- [x] **Task 2.3**: `[RTK]` Add the multi-environment section
  - Description: Add a section listing exactly what differs between a staging and a production deployment: secret values, `MONGO_URI` (separate cluster or database), `EXPO_PUBLIC_API_URL` (requires a separate web build per environment — call this out, it is the non-obvious one), `corsOrigin`, Better Auth `trustedOrigins` and `BETTER_AUTH_URL`, and feature-flag defaults. Keep it under 40 lines; this is a checklist, not a guide.
  - Files: `docs/explanation/deployment-baseline.md`
  - Depends on: Task 2.2
  - Acceptance: the section states that each environment needs its own web build; every item names the config location; under 40 lines.

## Phase 3: Backend container

- [x] **Task 3.1**: Verify and fix the backend's port and host binding
  - Description: Read `example-backend/src/server.ts` and `api/src/expressServer.ts` to determine how the listen port and host are resolved. Confirm the port comes from `process.env.PORT` with a fallback and that the server binds `0.0.0.0` (or Express's default, which is all interfaces — verify rather than assume). If either is wrong for containerized deployment, fix it in the smallest possible change and add a test. If both are already correct, make no code change and record that finding.
  - Files: `example-backend/src/server.ts` and/or `api/src/expressServer.ts` (only if a fix is needed), plus a test
  - Depends on: none
  - Acceptance: running `PORT=9999 bun run backend:dev` serves on 9999; the finding (fixed or already correct) is stated in the PR body with file citations.

- [x] **Task 3.2**: Write the backend Dockerfile
  - Description: Create `example-backend/Dockerfile` as a multi-stage build on `oven/bun:1-slim` (IP question DF2). Stage 1: copy the lockfile and workspace manifests, run `bun install --frozen-lockfile`, then compile the workspace packages the backend depends on (`@terreno/test`, `@terreno/api`, then the rest — mirror the ordering in the root `compile` script). Stage 2: copy only the built output and production dependencies, create and switch to a non-root user, set `ENV NODE_ENV=production`, expose the port, and set the entrypoint. Add a `HEALTHCHECK` hitting the health endpoint. Create `example-backend/.dockerignore` excluding `node_modules`, `.git`, `.env*`, test files, and build caches.
  - Files: `example-backend/Dockerfile` (new), `example-backend/.dockerignore` (new)
  - Depends on: Task 3.1
  - Acceptance: `docker build -f example-backend/Dockerfile .` succeeds from the repo root; the image runs and `curl localhost:$PORT/health` returns `"healthy":true` against an external MongoDB replica set; `docker run` with `--user` unset shows a non-root user via `id`; the final image is under 500 MB.

- [x] **Task 3.3**: Add a Docker build CI job
  - Description: Create `.github/workflows/example-backend-docker.yml` that builds the image on pull requests touching `example-backend/**`, `api/**`, `package.json`, or `bun.lock`. Build only — do not push. Use layer caching. Follow the repo's convention of validating required inputs before use even though this job needs no secrets.
  - Files: `.github/workflows/example-backend-docker.yml` (new)
  - Depends on: Task 3.2
  - Acceptance: the workflow parses as valid YAML; the path filter covers all four inputs; the job does not push an image or require registry credentials.

- [x] **Task 3.4**: Reference the Dockerfile from the docs
  - Description: Add a "Containerizing the backend" section to `docs/explanation/deployment-baseline.md` that explains the Dockerfile's structure and links `example-backend/Dockerfile` as the canonical copy rather than duplicating its contents (per IP question DF1). Call out the three details consumers get wrong: reading `PORT` from the environment, running as non-root, and compiling workspace packages in the right order.
  - Files: `docs/explanation/deployment-baseline.md`
  - Depends on: Task 3.2
  - Acceptance: the section links the Dockerfile by path and does not paste more than a few illustrative lines; all three pitfalls are named.

## Phase 4: Web build documentation

- [x] **Task 4.1**: `[RTK]` Write `docs/how-to/build-for-web.md`
  - Description: How-to covering: the build command (verify the exact script in `example-frontend/package.json` — do not assume `expo export -p web`), what the output directory contains for the current output mode, setting `EXPO_PUBLIC_API_URL` before the build with an explicit warning that it is inlined into the bundle, the `app.json` `extra` alternative (`BASE_URL`) and how the two interact — check the base-URL resolution priority order in the client package and document it accurately, serving the output locally to verify before deploying, and the SPA-routing requirement (all unknown paths must serve `index.html`) with a note that each host configures this differently. Link the provider guides.
  - Files: `docs/how-to/build-for-web.md` (new), `docs/how-to/README.md`
  - Depends on: Task 2.2
  - Acceptance: the build command matches an actual script; the base-URL priority order matches the client source and cites the file; the local-verification step works; the guide is listed in the how-to index.

- [x] **Task 4.2**: Cross-link the deployment documentation
  - Description: Add a "Deployment" grouping to `docs/how-to/README.md` and `docs/explanation/README.md` listing the baseline explainer, the web build guide, and the provider guides from [`deploy-to-vercel`](../implementationPlans/deploy-to-vercel.md) and [`deploy-to-gcp`](../implementationPlans/deploy-to-gcp.md). Ensure each provider guide links back to the baseline instead of restating the seven requirements.
  - Files: `docs/how-to/README.md`, `docs/explanation/README.md`
  - Depends on: Task 4.1
  - Acceptance: both indexes have a Deployment grouping; every provider guide that exists links the baseline explainer; `bun run website:build` reports no new broken links.
