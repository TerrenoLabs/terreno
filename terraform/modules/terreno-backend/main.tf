# One Terreno backend on Cloud Run: image registry, runtime identity, secrets,
# and the service itself. Composes the sibling modules in terraform/modules/.

locals {
  repository_id      = var.service_name
  runtime_account_id = "${var.service_name}-runtime"
  secret_ids         = { for env_name, suffix in var.secrets : env_name => "${var.service_name}-${suffix}" }
  deployer_name      = "${var.service_name}-deployer"
  required_apis = [
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  # STS exchanges the GitHub OIDC token during keyless CI sign-in.
  for_each = var.enable_apis ? toset(concat(local.required_apis, var.github_deploy == null ? [] : ["sts.googleapis.com"])) : toset([])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = local.runtime_account_id
  display_name = "${var.service_name} runtime"
  description  = "Cloud Run identity for ${var.service_name}. Reads its own secrets and, when configured, the uploads bucket."

  depends_on = [google_project_service.required]
}

module "artifact_registry" {
  source = "../artifact_registry"

  project_id    = var.project_id
  region        = var.region
  repository_id = local.repository_id
  description   = "Container images for ${var.service_name}."

  writer_members = var.github_deploy == null ? {} : {
    deployer = "serviceAccount:${module.github_oidc[0].service_account_emails[local.deployer_name]}"
  }

  depends_on = [google_project_service.required]
}

module "secret" {
  source   = "../secret"
  for_each = local.secret_ids

  project_id = var.project_id
  secret_id  = each.value
  labels     = var.labels

  accessor_members = {
    runtime = "serviceAccount:${google_service_account.runtime.email}"
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "runtime_uploads" {
  count = var.uploads_bucket == "" ? 0 : 1

  bucket = var.uploads_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

module "service" {
  source = "../cloud_run_service"

  project_id            = var.project_id
  region                = var.region
  service_name          = var.service_name
  image                 = var.image
  port                  = var.port
  cpu                   = var.cpu
  memory                = var.memory
  min_instances         = var.min_instances
  max_instances         = var.max_instances
  concurrency           = var.concurrency
  timeout_seconds       = var.timeout_seconds
  session_affinity      = var.session_affinity
  allow_unauthenticated = var.allow_unauthenticated
  deletion_protection   = var.deletion_protection
  service_account_email = google_service_account.runtime.email
  env                   = var.env
  labels                = var.labels

  # Secrets are not mounted here: they have no versions yet, and Cloud Run
  # rejects a revision whose secret has no version. The deploy step mounts them
  # with --set-secrets (see the set_secrets_flag output).
  depends_on = [module.secret]
}

# CI deploys: GitHub Actions impersonates a narrow deployer account through
# Workload Identity Federation instead of holding a JSON key.
module "github_oidc" {
  source = "../github_oidc"
  count  = var.github_deploy == null ? 0 : 1

  project_id   = var.project_id
  pool_id      = "${var.service_name}-github"
  github_owner = var.github_deploy.owner
  github_repos = var.github_deploy.repos

  service_accounts = {
    (local.deployer_name) = {
      display_name = "${var.service_name} deployer"
      description  = "Impersonated by GitHub Actions to push images and deploy ${var.service_name}."
      roles        = []
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "deployer" {
  count = var.github_deploy == null ? 0 : 1

  project  = var.project_id
  location = var.region
  name     = module.service.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${module.github_oidc[0].service_account_emails[local.deployer_name]}"
}

# Deploying a revision that runs as the runtime account requires actAs on that
# account only, not project-wide.
resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  count = var.github_deploy == null ? 0 : 1

  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${module.github_oidc[0].service_account_emails[local.deployer_name]}"
}
