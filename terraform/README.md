# Terreno Infrastructure (Terraform + Infra Manager)

This directory holds the Terraform configuration for Terreno's GCP infrastructure.
It is applied by **[Google Cloud Infrastructure Manager](https://cloud.google.com/infrastructure-manager/docs/overview)** via CircleCI `gcp-cd-prod`. The retained `.github/workflows/cd.yml` has `on: []`.

## What's managed

- Project APIs (Cloud Run, Artifact Registry, IAM, Infra Manager, etc.)
- GCS state bucket
- **Workload Identity Federation** — GitHub and CircleCI providers share two impersonable service accounts:
  - `terraform-admin` — used by CircleCI terraform jobs (project-admin scope, including `roles/logging.logWriter` so Infra Manager Cloud Build can write regional logs)
  - `gh-deployer` — retained name; used by CircleCI application deploy jobs with the narrow roles needed to push images and roll Cloud Run
- Artifact Registry repos for each Cloud Run service
- Cloud Run services (`terreno-backend-example`, `terreno-backend-example-tasks`, `terreno-mcp`) — **structural definition only** (resources, scaling, IAM, labels). Image and env vars are still set by the CD workflows on every deploy; Terraform's `lifecycle.ignore_changes` keeps it out of the way.
- Cloud Tasks queue `terreno-example-jobs-v2`, its queue-level dispatch pool limits, a
  dedicated `terreno-backend-runtime` Cloud Run identity (the only runtime that can
  enqueue and `actAs` the callback SA), and a callback-only `terreno-jobs-invoker`
  OIDC service account. The private tasks Cloud Run service executes callbacks;
  Cloud Run worker pools are not used because they have no HTTP ingress. The
  project default Compute Engine SA is not an enqueuer.
- Secret Manager containers for backend sensitive env vars. Values are seeded out-of-band; CircleCI deploy jobs mount them by secret reference. `terreno-backend-example-announcements-upload-token` is the exception: Terraform writes the default `terreno-example-announcement-upload` so the example import API can be tested without a manual seed.

The pre-existing `EXAMPLE_*` Secret Manager secrets (`EXAMPLE_MONGO_CONNECTION`, `EXAMPLE_TOKEN_SECRET`, `EXAMPLE_REFRESH_TOKEN_SECRET`) feeding `MONGO_URI`/`TOKEN_SECRET`/`REFRESH_TOKEN_SECRET` are not yet Terraform-managed but already use proper SM mounts. Terraform grants the backend runtime access to the two legacy JWT secrets because Cloud Run validates existing mounts before it applies a revised template. The secret containers can be imported in a follow-up. The MCP server's `SENTRY_DSN` is also still inline-from-GH-secret and could be migrated.

## Layout

```
terraform/
  main.tf                       # Composition (modules wired together)
  variables.tf
  outputs.tf
  versions.tf
  terraform.tfvars              # Project-specific values
  modules/
    project_bootstrap/          # APIs + state bucket
    artifact_registry/          # Docker repo + IAM
    cloud_run_service/          # v2 Cloud Run service + invoker IAM
    secret/                     # Secret Manager secret container (kept for future use)
    github_oidc/                # WIF pool/provider + multi-SA support
    circleci_oidc/               # CircleCI OIDC provider + SA impersonation
```

The whole `terraform/` directory is the Infra Manager source. The workflow runs `--local-source=terraform`.

## One-time bootstrap

```bash
PROJECT_ID=flourish-terreno
STATE_BUCKET=flourish-terreno-tfstate-prod
LOCATION=us-central1                         # Infra Manager region

# 1. Enable APIs needed before Terraform can run. Terraform manages most of
#    these via the project_bootstrap module, but plan/apply itself needs the
#    cloud build, config, IAM, service usage, and storage APIs available
#    first.
gcloud services enable \
  cloudbuild.googleapis.com \
  cloudresourcemanager.googleapis.com \
  config.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  serviceusage.googleapis.com \
  storage.googleapis.com \
  --project="$PROJECT_ID"

# Look up the project number (used by terraform.tfvars):
gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)"

# 2. Create the state bucket (Terraform will adopt it on first apply).
gsutil mb -p "$PROJECT_ID" -l US -b on "gs://$STATE_BUCKET"

# 3. Create a bootstrap service account that Infra Manager can use for the
#    initial apply. After the first apply, the workflow uses the
#    terraform-admin SA Terraform itself created.
gcloud iam service-accounts create infra-manager-bootstrap \
  --project="$PROJECT_ID" \
  --display-name="Infra Manager bootstrap"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:infra-manager-bootstrap@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/owner"

# 4. Create the Infra Manager deployment, pointing at the whole terraform/
#    directory.
gcloud infra-manager deployments apply terreno-prod \
  --project="$PROJECT_ID" \
  --location="$LOCATION" \
  --service-account="infra-manager-bootstrap@${PROJECT_ID}.iam.gserviceaccount.com" \
  --local-source="."
# (run from the terraform/ directory; or use --local-source="terraform" from repo root)
```

After step 4 succeeds, the WIF providers, deployer SAs, and all other resources exist. CircleCI then impersonates `terraform-admin@`. The bootstrap SA can stay for break-glass use or be deleted.

## CircleCI OIDC setup

1. Set `circleci_org_id`, `circleci_project_id`, and `circleci_gcp_context_id`
   (the UUID of the `terreno-gcp` CircleCI context) in `terraform.tfvars`.
   The provider refuses tokens whose `oidc.circleci.com/context-ids` claim
   does not include that UUID, so jobs that skip the context cannot
   impersonate `terraform-admin` or `gh-deployer`.
2. Apply once with an existing Terraform admin identity.
3. Add these non-secret values to the restricted `terreno-gcp` CircleCI context:

| Variable | Value | Used by |
|----------|-------|---------|
| `GCP_PROJECT_ID` | `flourish-terreno` | all GCP jobs |
| `GCP_WIF_PROVIDER_PROD` | output `circleci_workload_identity_provider` | all GCP jobs |
| `GCP_TF_ADMIN_SA_PROD` | output `terraform_admin_sa_email` | Terraform preview/apply |
| `GCP_CD_DEPLOYER_SA_PROD` | output `gh_deployer_sa_email` | Cloud Run deploy/cleanup |
| `GCP_INFRA_MANAGER_LOCATION` | optional, defaults to `us-central1` | Terraform jobs |

Fetch the outputs after the first apply:

```bash
gcloud infra-manager deployments describe terreno-prod \
  --project=flourish-terreno --location=us-central1 \
  --format="value(latestRevision)"
# Then describe the returned revision to read its outputs:
gcloud infra-manager revisions describe <REVISION> --format=json | jq '.terraformBlueprint'
```

CircleCI exchanges `CIRCLE_OIDC_TOKEN_V2` at runtime. Do not create a JSON key.

## Importing existing resources

The first `terraform plan` will want to **create** resources that already exist (live Cloud Run service, Artifact Registry repo, existing Workload Identity Pool). Import them before the first apply:

```bash
cd terraform
terraform init

# Cloud Run services
terraform import 'module.backend_service.google_cloud_run_v2_service.this' \
  projects/flourish-terreno/locations/us-central1/services/terreno-backend-example
terraform import 'module.mcp_service.google_cloud_run_v2_service.this' \
  projects/flourish-terreno/locations/us-east1/services/terreno-mcp

# Artifact Registry repos
terraform import 'module.backend_artifact_registry.google_artifact_registry_repository.this' \
  projects/flourish-terreno/locations/us-central1/repositories/terreno-backend-example
terraform import 'module.mcp_artifact_registry.google_artifact_registry_repository.this' \
  projects/flourish-terreno/locations/us-east1/repositories/terreno-mcp

# Workload Identity Pool + provider (already exist in flourish-terreno)
terraform import 'module.github_oidc.google_iam_workload_identity_pool.this' \
  projects/flourish-terreno/locations/global/workloadIdentityPools/github-actions
terraform import 'module.github_oidc.google_iam_workload_identity_pool_provider.github' \
  projects/flourish-terreno/locations/global/workloadIdentityPools/github-actions/providers/github
```

After import, `terraform plan` should show only safe metadata updates on the imported resources (description, cleanup_policies, labels, attribute_mapping additions). Cloud Run env vars and image are excluded from the plan via `lifecycle.ignore_changes`.

The tasks service and Artifact Registry repo are new Terraform-owned resources. If they were created manually before Terraform applies this configuration, import them with the same patterns:

```bash
terraform import 'module.tasks_service.google_cloud_run_v2_service.this' \
  projects/flourish-terreno/locations/us-central1/services/terreno-backend-example-tasks
terraform import 'module.tasks_artifact_registry.google_artifact_registry_repository.this' \
  projects/flourish-terreno/locations/us-central1/repositories/terreno-backend-example-tasks
```

The Cloud Tasks queue and callback identity are also Terraform-owned. Import manually
created copies before the first apply:

```bash
terraform import google_cloud_tasks_queue.example_jobs \
  projects/flourish-terreno/locations/us-central1/queues/terreno-example-jobs-v2
terraform import google_service_account.jobs_tasks_invoker \
  projects/flourish-terreno/serviceAccounts/terreno-jobs-invoker@flourish-terreno.iam.gserviceaccount.com
```

## Durable jobs deployment

The API and private tasks service run the same image and register the same job handlers.
The API persists a `Job`, then Cloud Tasks sends an OIDC-authenticated
`POST /jobs/execute` to the tasks service. Queue rate limits cap the dispatch pool at 20
callbacks and 20 dispatches per second by default. Keep `scripts/ci/gcp-deploy.sh`
`deploy_tasks` on a 30-minute timeout, concurrency 20, and
`--no-allow-unauthenticated` so a CircleCI roll cannot reopen the worker.

PR previews do not create global infrastructure. CircleCI (`gcp-deploy.sh backend-preview`)
deploys a matching `pr-<number>` tag for the tasks service before the API preview, then
configures the API to target that exact tasks tag. Production deploys overwrite Cloud Run
env vars (`--set-env-vars`) so preview `MONGO_DB_NAME` / `PR_NUMBER` do not merge into
production. Each tag also uses `terreno-example-pr-<number>`, so concurrent PRs share neither
workers nor job rows. CircleCI `preview-cleanup` (started on PR close by
`.github/workflows/preview-cleanup.yml`) removes the API and tasks tags.

## Adding a third service account

The `local.service_accounts` map in `main.tf` is the single source of truth. Add a new entry with its role set; Terraform will create the SA, bind project IAM, and grant `workloadIdentityUser` for every `github_repos` entry. Then read the new email out of `module.github_oidc.service_account_emails["<name>"]`.

## Adopting a new Secret Manager secret

The recommended two-PR flow (avoids a broken first deploy):

**PR 1 — infrastructure only:**

1. Add a `module "..." { source = "./modules/secret" ... }` block to `main.tf` (the module is already shipped). Grant accessor IAM to the relevant runtime SA.
2. Commit, merge. CircleCI `gcp-cd-prod` (terraform apply) creates the empty SM container. Backend/MCP deploys skip (no code changes).
3. Seed the value: `echo -n 'value' | gcloud secrets versions add <secret-id> --project=flourish-terreno --data-file=-`.

**PR 2 — wire it up:**

4. Add `KEY=<secret-id>:latest` to the `secrets=` list in `scripts/ci/gcp-deploy.sh`. Remove any plain env-var copy of the value if migrating.
5. Commit, merge. `gcp-cd-prod` rolls a new Cloud Run revision that mounts the (already-populated) secret.

**Why two PRs?** `gcp-cd-prod` runs terraform apply before any deploy, but it can't seed values — `gcloud secrets versions add` is a manual step. Doing it in one PR means the first deploy mounts an empty secret and Cloud Run rejects the revision.

For rotating a value of an already-set-up secret, no PR needed — just `gcloud secrets versions add`. Cloud Run re-reads `:latest` on every cold start.

## Local validation

```bash
cd terraform
terraform init
terraform fmt -check -recursive
terraform validate
```

Don't `terraform apply` locally — Infra Manager is the source of truth for who can apply.

## Never apply from a stale checkout

`gcloud infra-manager deployments apply --local-source=terraform` applies whatever is on **your disk**, not what is on `master`. A checkout that is behind `master` plans destroys for everything merged since. On 2026-09-18 an apply from a pre-#1327 tree deleted the `terreno-example-jobs` queue, the `terreno-backend-runtime` and `terreno-jobs-invoker` service accounts, and terraform-admin's `roles/cloudtasks.admin` binding.

Apply from CI (**Actions → CD → Run workflow** on `master` with `run_terraform=true`), or `git fetch origin master && git checkout master` first. Before confirming any manual apply, read the plan line in the build log and stop if it lists destroys you did not intend:

```
Plan: 5 to add, 3 to change, 15 to destroy.
```

Deleting a Cloud Tasks queue is effectively irreversible for a week: the name cannot be reused for ~7 days (`Error 400: The queue cannot be created because a queue with this name existed too recently`). Recovering one means bumping `jobs_queue_name` to a new name, which is why the queue is `terreno-example-jobs-v2`.

## Debugging Infra Manager previews

`gcloud infra-manager previews create` often fails with an empty `failed while running step:` line. GitHub `Terraform preview` and CircleCI `scripts/ci/gcp-deploy.sh terraform-preview` still run `previews describe` (`state`, `errorCode`, `errorLogs`) before delete. Cloud Build regional logs require `terraform-admin` to have `roles/logging.logWriter`.

## GCS + CDN static site hosting

The demo and example-frontend apps are deployed to Google Cloud Storage with CDN. PR previews are deployed automatically.

### Project

- **Project ID**: `flourish-terreno`
- **Region**: `us-east1`

### Buckets

| App | Bucket | Backend Bucket (CDN) |
|-----|--------|---------------------|
| example-frontend | `flourish-terreno-terreno-frontend-example` | `terreno-frontend-example-backend` |
| demo | `flourish-terreno-terreno-demo` | `terreno-demo-backend` |

### Initial setup

Run `scripts/setup-gcs-hosting.sh` to create GCS buckets with public read access, SPA fallback (`index.html` for 404s), service-account write access, and CDN backend buckets / URL maps / static IPs / HTTP proxies / forwarding rules. Point DNS at the output IPs; follow the script's HTTPS instructions.

Required secret: `GCP_SA_KEY` (service account key JSON with GCS and CDN cache-invalidation permissions).

### Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `frontend-example-deploy.yml` | Push to master (example-frontend/ui/rtk changes) | Builds and deploys to production bucket |
| `frontend-example-deploy.yml` | Pull request | Deploys preview to `_previews/pr-{number}/` |
| `demo-deploy.yml` | Push to master (demo/ui changes) | Builds and deploys to production bucket |
| `demo-deploy.yml` | Pull request | Deploys preview to `_previews/pr-{number}/` |
| `preview-cleanup.yml` | PR closed | Deletes preview files from both buckets |
