# terreno-backend module

Provisions one Terreno `@terreno/api` backend on Cloud Run: the image registry, a
least-privilege runtime identity, empty Secret Manager secrets, and the service, with
websocket-safe defaults. Optionally adds a GitHub Actions deployer through Workload
Identity Federation.

Terraform owns the structure. Your deploy step owns the payload: it pushes the image and
runs `gcloud run deploy` with the secrets and env vars. After creation, Terraform ignores
the image and env on the service, so deploys never fight `terraform apply`.

## Usage

```hcl
module "backend" {
  source = "github.com/TerrenoLabs/terreno//terraform/modules/terreno-backend?ref=<release-tag>"

  project_id   = "my-project"
  region       = "us-central1"
  service_name = "my-app-api"
}
```

Pin `ref` to a release tag. The module uses its sibling modules in
`terraform/modules/`, so copy the whole directory if you vendor it.

Then:

1. `terraform init && terraform apply`
2. Add a value to **every** secret in the `secret_ids` output (a deploy that mounts a
   versionless secret fails):
   `echo -n "$VALUE" | gcloud secrets versions add "$SECRET_ID" --data-file=- --project="$PROJECT_ID"`
3. Build and push the image to the `registry_path` output, then deploy it:

```bash
gcloud run deploy "$(terraform output -raw service_name)" \
  --image="$(terraform output -raw registry_path)/api:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --service-account="$(terraform output -raw service_account_email)" \
  "$(terraform output -raw set_secrets_flag)" \
  --set-env-vars="NODE_ENV=production"
```

The full walkthrough, including verification, is in
[Deploy backend to Cloud Run](../../../docs/how-to/deploy-backend-to-cloud-run.md).

## What it creates

| Resource | Name | Notes |
|----------|------|-------|
| Project services | run, artifactregistry, secretmanager, iam, iamcredentials (+ sts with `github_deploy`) | Skipped when `enable_apis = false`; never disabled on destroy |
| Artifact Registry repository | `<service_name>` | Docker format, keeps the 30 most recent versions |
| Runtime service account | `<service_name>-runtime` | `secretAccessor` on its own secrets only |
| Secret Manager secrets | `<service_name>-<suffix>` per `secrets` entry | Created empty; values never enter Terraform state |
| Cloud Run service | `<service_name>` | Session affinity, 3600s timeout, min 1 instance by default |
| Uploads bucket grant | — | `storage.objectAdmin` on `uploads_bucket` only, when set |
| Workload Identity pool + deployer account | `<service_name>-github`, `<service_name>-deployer` | Only when `github_deploy` is set |

The deployer gets `run.developer` on this service, `artifactregistry.writer` on this
repository, and `iam.serviceAccountUser` on the runtime account. It has no project-wide
roles, so CI deploys must leave out `--allow-unauthenticated` (the service is already
public). Setting `github_deploy` also enables the STS API, which keyless sign-in needs.

## Gotchas

| Symptom | Cause | Fix |
|---------|-------|-----|
| Apply fails granting `allUsers` invoker | An org policy restricts allowed member domains | Set `allow_unauthenticated = false` and front the service with a load balancer, or get a policy exception |
| Apply fails creating the Workload Identity pool after a destroy | Deleted pools stay reserved for 30 days | Undelete the pool (`gcloud iam workload-identity-pools undelete`) or use a different `service_name` |
| `service_name` rejected | It must be 3–21 characters, end with a letter or digit, and not start with `gcp-` | Choose a shorter name |

## Why secrets are not mounted at create

Cloud Run rejects a revision that references a secret with no version, and the secrets
start empty. Mount them on your first real deploy with the `set_secrets_flag` output,
after step 2 above.

## Inputs

| Name | Default | Description |
|------|---------|-------------|
| `project_id` | — | GCP project ID |
| `region` | — | Region for Cloud Run and Artifact Registry |
| `service_name` | — | 3–21 lowercase letters, digits, hyphens; prefixes every derived name |
| `image` | Cloud Run hello image | Image for initial creation only |
| `port` | `3000` | Container port |
| `cpu` / `memory` | `"1"` / `"512Mi"` | Per-instance limits |
| `min_instances` / `max_instances` | `1` / `10` | Use `0` minimum for dev sandboxes only |
| `concurrency` | `80` | Requests per instance |
| `timeout_seconds` | `3600` | Request timeout; sockets drop at this limit |
| `session_affinity` | `true` | Required for Socket.IO across instances |
| `allow_unauthenticated` | `true` | Terreno APIs enforce their own auth |
| `deletion_protection` | `true` | Set `false` for throwaway environments |
| `env` | `{}` | Plain env vars for initial creation |
| `secrets` | Auth secrets + `MONGO_URI` | `ENV_VAR => suffix`; defaults match the Cloud Run guide |
| `uploads_bucket` | `""` | Existing bucket the runtime may write |
| `enable_apis` | `true` | Enable required project services |
| `github_deploy` | `null` | `{owner, repos}` for a GitHub Actions deployer |
| `labels` | `{}` | Labels for the service and secrets |

## Outputs

| Name | Description |
|------|-------------|
| `service_url` | HTTPS URL; use as `EXPO_PUBLIC_API_URL` for the web build |
| `service_name` | Cloud Run service name |
| `service_account_email` | Runtime account for `--service-account` |
| `registry_path` | `<region>-docker.pkg.dev/<project>/<repo>` |
| `secret_ids` | `ENV_VAR => secret ID` |
| `set_secrets_flag` | `--set-secrets=...` mounting every secret |
| `deployer_service_account_email` | GitHub deployer account, or null |
| `workload_identity_provider` | Provider for `google-github-actions/auth`, or null |

## Tests

Tests run against a mocked Google provider: no credentials, no real resources.
They need Terraform 1.7 or later.

```bash
terraform init -backend=false && terraform test
```
