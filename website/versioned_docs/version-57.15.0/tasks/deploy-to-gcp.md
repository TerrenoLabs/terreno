# Task List: Deploy to GCP (Generalized) + `deploy-gcp` Skill

See: [`docs/implementationPlans/deploy-to-gcp.md`](../implementationPlans/deploy-to-gcp.md)

**RTK deprecation flag:** None. The only client-side surface is `EXPO_PUBLIC_API_URL`, which is unchanged by PR #869. Safe to implement before #869 merges.

## Instructions for the implementing agent

- Use placeholder variables in all documentation: `$PROJECT_ID`, `$REGION`, `$SERVICE_NAME`, `$WEB_BUCKET`, `$UPLOADS_BUCKET`. Never hardcode a real project ID, bucket, or URL.
- Grep for `flourish` in every file you write or edit before committing: `rg -i flourish <file>`. The only permitted matches are inside `infra/flourish/`.
- Do **not** run `gcloud` commands that create or modify resources unless the user has explicitly named a target project in the request.
- Verify every `gcloud` flag you document against `gcloud run deploy --help` before writing it. Do not guess flag names.
- Run `bun run lint` before each commit; run `bun run rules:check` after touching `.rulesync/`.

## Phase 1: Generalize the how-to guides

- [x] **Task 1.1**: Write `docs/how-to/deploy-backend-to-cloud-run.md`
  - Description: New guide covering: prerequisites (gcloud installed and authenticated, billing enabled, required APIs — `run`, `artifactregistry`, `secretmanager`, `compute`); creating an Artifact Registry repo; building and pushing the backend image; creating Secret Manager secrets for `MONGO_URI`, `TOKEN_SECRET`, `TOKEN_ISSUER`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET`, and `BETTER_AUTH_SECRET`; creating the runtime service account with least-privilege roles; the `gcloud run deploy` invocation with `--session-affinity`, `--timeout`, `--min-instances`, `--set-secrets`, and `--set-env-vars`; and verification via `curl $SERVICE_URL/health`. Use placeholder variables throughout. Read `example-backend/src/server.ts` and `docs/reference/environment-variables.md` to get the env var list right — do not copy it from this task description without checking.
  - Files: `docs/how-to/deploy-backend-to-cloud-run.md` (new)
  - Depends on: none
  - Acceptance: `rg -i flourish docs/how-to/deploy-backend-to-cloud-run.md` returns nothing; every env var named exists in `docs/reference/environment-variables.md` or the backend source; every `gcloud` flag used appears in `gcloud run deploy --help`.

- [x] **Task 1.2**: Add the production constraints section
  - Description: Add a "Production constraints" section to the backend guide as a symptom → cause → fix table covering at minimum: (a) websockets disconnect every few requests → no session affinity → add `--session-affinity`; (b) long-lived socket connections drop at 5 minutes → default request timeout → raise `--timeout`; (c) realtime and live feature flags stop working → MongoDB is not a replica set → use Atlas or a replica set, because change streams require one; (d) first request after idle is slow and sockets churn → scaled to zero → `--min-instances=1`; (e) browser requests fail CORS → `corsOrigin` in `setupServer` and Better Auth `trustedOrigins` do not include the web origin. Verify claim (c) against `feature-flags` live-update code before writing it.
  - Files: `docs/how-to/deploy-backend-to-cloud-run.md`
  - Depends on: Task 1.1
  - Acceptance: all five rows present with a concrete symptom; the change-streams claim is verified against the source and the source path is cited in the guide.

- [x] **Task 1.3**: Write `docs/how-to/deploy-web-to-gcs-cdn.md`
  - Description: New guide covering: building the web bundle (`bunx expo export -p web` — confirm the exact command against `example-frontend/package.json` scripts), the requirement to set `EXPO_PUBLIC_API_URL` at build time because it is inlined into the bundle, creating and configuring the GCS bucket with public read and `notFoundPage=index.html` for client-side routing, the five CDN resources (backend bucket, URL map, static IP, HTTP(S) proxy, forwarding rule), pointing DNS at the IP, and cache invalidation after each deploy. Include a note that this is a static-only path and link [`web-ssr-and-admin-spa`](../implementationPlans/web-ssr-and-admin-spa.md) for the SSR future.
  - Files: `docs/how-to/deploy-web-to-gcs-cdn.md` (new)
  - Depends on: none
  - Acceptance: no Flourish strings; the export command matches an actual script in `example-frontend/package.json`; the guide explains why `EXPO_PUBLIC_API_URL` must be set before building, not after.

- [x] **Task 1.4**: Write the architecture explainer
  - Description: Create `docs/explanation/deployment-architecture-gcp.md` explaining the reference topology (reuse the mermaid diagram from the IP), what each component is responsible for, why Cloud Run rather than App Engine or GKE, why Atlas rather than self-hosted Mongo, and the tradeoffs of static web hosting versus a server-rendered deployment. Keep it conceptual — no commands.
  - Files: `docs/explanation/deployment-architecture-gcp.md` (new)
  - Depends on: Task 1.1, Task 1.3
  - Acceptance: contains the topology diagram; contains no shell commands; explains at least three explicit tradeoffs.

- [x] **Task 1.5**: Rewire the existing GCP how-to and index
  - Description: Replace `docs/how-to/deploy-to-gcp.md` with a short index page linking the two new guides and the explainer, preserving the old anchor names where practical so existing links do not break. Update `docs/how-to/README.md` to list the new guides. Check `website/` for any hardcoded reference to the old page path and update it.
  - Files: `docs/how-to/deploy-to-gcp.md`, `docs/how-to/README.md`, `website/` (as needed)
  - Depends on: Task 1.1, Task 1.3, Task 1.4
  - Acceptance: `bun run website:build` succeeds with no new broken-link warnings introduced by this change.

## Phase 2: Terraform module and Flourish separation

- [ ] **Task 2.1**: Extract the generic backend module
  - Description: Create `terraform/modules/terreno-backend/` with `main.tf`, `variables.tf`, `outputs.tf`, and `README.md`. Resources: Artifact Registry repository, Cloud Run v2 service (session affinity, timeout, min/max instances, secret env refs), Secret Manager secrets (created empty, values supplied out-of-band), runtime service account with `secretmanager.secretAccessor` and object admin on a supplied uploads bucket, and optional Workload Identity Federation pool for CI. Every value that could differ between users must be a variable with a description and no Flourish default. Outputs: service URL, service account email, registry path.
  - Files: `terraform/modules/terreno-backend/main.tf`, `variables.tf`, `outputs.tf`, `README.md` (all new)
  - Depends on: Task 1.1
  - Acceptance: `terraform init && terraform validate` passes in the module directory; `rg -i flourish terraform/modules/` returns nothing; every variable has a `description`.

- [ ] **Task 2.2**: Relocate Flourish-specific terraform
  - Description: Move Flourish's environment configuration from `terraform/` to `infra/flourish/`, leaving only `terraform/modules/` behind. Update every path reference: `.github/workflows/cd.yml`, `terraform/README.md` (split into a generic module README and `infra/flourish/README.md`), `AGENTS.md` / `CLAUDE.md` if they reference `terraform/README.md`, and any script under `scripts/`. Use `git mv` so history is preserved.
  - Files: `infra/flourish/**` (moved), `terraform/README.md`, `.github/workflows/cd.yml`, `AGENTS.md`, `CLAUDE.md`, `scripts/**`
  - Depends on: Task 2.1
  - Acceptance: `rg -n "terraform/" --glob '!infra/**' --glob '!terraform/**'` shows no stale paths pointing at moved files; the `cd.yml` workflow references the new location; `bun run rules:check` exits 0 after regenerating rules.

- [x] **Task 2.3**: Parameterize the GCS hosting script
  - Description: Rewrite `scripts/setup-gcs-hosting.sh` to require `--project`, `--site-name`, `--bucket`, and `--domain` arguments (or positional equivalents) with a usage message and a check that all are present. Remove every hardcoded Flourish project, bucket, and service-account value. Keep the resource-creation logic intact, with HTTPS as the only public serving path. Add a `--dry-run` flag that prints commands without executing them.
  - Files: `scripts/setup-gcs-hosting.sh`
  - Depends on: Task 1.3
  - Acceptance: running with no arguments prints usage and exits non-zero; `--dry-run` produces HTTPS commands containing the supplied values, no port 80 forwarding rule, and no Flourish strings; `rg -i flourish scripts/setup-gcs-hosting.sh` returns nothing.

## Phase 3: The `deploy-gcp` skill

- [x] **Task 3.1**: Author the skill
  - Description: Create `.rulesync/skills/deploy-gcp/SKILL.md` with frontmatter (`name: deploy-gcp`, a `description` that names the trigger phrases "deploy to GCP", "deploy to Cloud Run", "ship the backend", and `targets: ['*']`). Body sections in this order: When to use / When not to use; Preflight checks (project layout detection, `gcloud config get-value project`, required APIs, replica-set verification of `MONGO_URI`); **Plan and confirm** — print target project, region, service name, and every resource to be created or updated, then stop and require explicit user confirmation before any mutating command; Backend deploy steps; Frontend deploy steps; Verification (`curl $SERVICE_URL/health` expecting `"healthy":true`, fetch web root); Troubleshooting (link the reference file). Include an explicit prohibition: never deploy to a project the user did not name in the request, and never create or modify secrets without echoing which secret names will change.
  - Files: `.rulesync/skills/deploy-gcp/SKILL.md` (new)
  - Depends on: Task 1.1, Task 1.3
  - Acceptance: frontmatter has `name`, `description`, and `targets`; the confirmation gate appears before the first mutating command; every command in the skill also appears in the how-to guides (no skill-only knowledge).

- [x] **Task 3.2**: Add the troubleshooting reference
  - Description: Create `.rulesync/skills/deploy-gcp/references/troubleshooting.md` containing the symptom → cause → fix table from Task 1.2 plus deploy-time failures: image push permission denied, secret access denied at cold start, Cloud Run revision failing health checks because `PORT` is not read from the environment, and CDN serving a stale bundle after deploy. For each, give the exact log line or error message the user will see.
  - Files: `.rulesync/skills/deploy-gcp/references/troubleshooting.md` (new)
  - Depends on: Task 3.1
  - Acceptance: at least nine rows; each row quotes an actual error string rather than paraphrasing.

- [x] **Task 3.3**: Generate skill mirrors
  - Description: Run `bun run rules` and commit every generated file under `.cursor/skills/`, `.claude/skills/`, `.devin/skills/`, `.github/skills/`, and `.agents/skills/`. Do not hand-edit generated files.
  - Files: generated skill mirrors
  - Depends on: Task 3.1, Task 3.2
  - Acceptance: `bun run rules:check` exits 0; `deploy-gcp` appears under each configured target directory.

## Phase 4: Validation

- [ ] **Task 4.1**: Dry-run the guide end to end
  - Description: Following **only** `docs/how-to/deploy-backend-to-cloud-run.md` and `docs/how-to/deploy-web-to-gcs-cdn.md` (no internal knowledge, no `infra/flourish/`), deploy `example-backend` and `example-frontend` to a scratch GCP project. Record every point where the guide was wrong, incomplete, or required outside knowledge. Fix the guides. Capture the successful `curl $SERVICE_URL/health` output and the loaded web app as artifacts under `/opt/cursor/artifacts/`.
  - Files: `docs/how-to/deploy-backend-to-cloud-run.md`, `docs/how-to/deploy-web-to-gcs-cdn.md`
  - Depends on: Task 1.1, Task 1.3, Task 2.3
  - Acceptance: the deploy succeeds; `/health` returns `"healthy":true`; the web app loads and can log in against the deployed backend; every guide correction is committed.

- [ ] **Task 4.2**: Exercise the skill against the validated guide
  - Description: Run the `deploy-gcp` skill in a fresh agent session against the same scratch project and confirm it reaches the same result, including the confirmation gate firing before any mutation. Note any step where the skill needed information the guide did not provide and fix the skill.
  - Files: `.rulesync/skills/deploy-gcp/SKILL.md` plus mirrors
  - Depends on: Task 3.3, Task 4.1
  - Acceptance: the skill run produces a working deploy; the confirmation gate is observed in the transcript; `bun run rules:check` exits 0 after any skill edits.
