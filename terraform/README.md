# Terraform modules

Reusable Terraform modules for deploying Terreno apps to Google Cloud. Nothing here is
tied to a particular project: every project-specific value is a variable.

To deploy a Terreno backend, start with [`terreno-backend`](modules/terreno-backend/README.md)
and [Deploy backend to Cloud Run](../docs/how-to/deploy-backend-to-cloud-run.md#manage-with-terraform).

## Modules

| Module | Creates |
|--------|---------|
| [`terreno-backend`](modules/terreno-backend/README.md) | One backend: Artifact Registry, runtime service account, empty secrets, Cloud Run service, optional GitHub deployer. Composes the modules below |
| `artifact_registry` | Docker repository with writer and reader IAM |
| `cloud_run_service` | Cloud Run v2 service and optional public invoker binding; ignores image and env after creation |
| [`secret`](modules/secret/README.md) | Secret Manager secret with no version, plus accessor IAM |
| `github_oidc` | Workload Identity pool and GitHub provider, with impersonable service accounts |
| `circleci_oidc` | Workload Identity pool and CircleCI provider, bound to existing service accounts |
| `project_bootstrap` | Project APIs and a Terraform state bucket |

Use a module from Git, pinned to a release tag:

```hcl
module "backend" {
  source = "github.com/TerrenoLabs/terreno//terraform/modules/terreno-backend?ref=<tag>"
  # ...
}
```

Modules reference their siblings by relative path, so vendor the whole `modules/`
directory if you copy them.

## Tests

Modules with a `tests/` directory run mocked-provider tests that need no credentials:

```bash
terraform -chdir=terraform/modules/terreno-backend init -backend=false
terraform -chdir=terraform/modules/terreno-backend test
```

CI runs them, plus `terraform fmt -check -recursive`, whenever `terraform/` or `infra/` changes.

## Terreno's own infrastructure

The configuration that deploys Terreno's example backend and hosted MCP server is
operator-specific and lives in [`infra/flourish/`](../infra/flourish/README.md).
