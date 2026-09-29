locals {
  common_labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  # Two impersonable service accounts:
  #
  #   terraform-admin: Used by Infra Manager + the terraform-apply workflow.
  #     Needs admin-level scope because Terraform creates IAM bindings, WIF
  #     pools, secrets, buckets, and enables APIs.
  #
  #   gh-deployer:     Used by the CD workflows (deploy-example-gcp,
  #     mcp-server-deploy). Narrow scope: push images, roll Cloud Run, and
  #     read secrets so env vars sourced from Secret Manager work.
  service_accounts = {
    terraform-admin = {
      display_name = "Terraform admin"
      description  = "Impersonated by Infra Manager to apply terraform/. Project-admin scope."
      roles = [
        "roles/artifactregistry.admin",
        "roles/cloudtasks.admin",
        "roles/config.admin",
        "roles/iam.serviceAccountAdmin",
        # actAs is needed to update Cloud Run services whose runtime SA is
        # the Compute Engine default — serviceAccountAdmin doesn't grant it.
        "roles/iam.serviceAccountUser",
        "roles/iam.workloadIdentityPoolAdmin",
        # Infra Manager Cloud Build runs as this SA. Without Logs Writer,
        # regional build logs are empty and `gcloud builds log` returns nothing.
        "roles/logging.logWriter",
        "roles/resourcemanager.projectIamAdmin",
        "roles/run.admin",
        "roles/secretmanager.admin",
        "roles/serviceusage.serviceUsageAdmin",
        "roles/storage.admin",
      ]
    }
    gh-deployer = {
      display_name = "GitHub Actions CD deployer"
      description  = "Impersonated by the application deploy workflows. Push images + roll Cloud Run + read secrets."
      roles = [
        "roles/artifactregistry.writer",
        "roles/iam.serviceAccountUser",
        "roles/run.admin",
        "roles/secretmanager.secretAccessor",
      ]
    }
  }
}

module "bootstrap" {
  source = "./modules/project_bootstrap"

  project_id        = var.project_id
  state_bucket_name = var.state_bucket_name
}

module "github_oidc" {
  source = "./modules/github_oidc"

  project_id       = var.project_id
  github_owner     = var.github_owner
  github_repos     = var.github_repos
  service_accounts = local.service_accounts

  depends_on = [module.bootstrap]
}

module "circleci_oidc" {
  count  = var.circleci_org_id != "" && var.circleci_project_id != "" ? 1 : 0
  source = "./modules/circleci_oidc"

  project_id              = var.project_id
  circleci_org_id         = var.circleci_org_id
  circleci_project_id     = var.circleci_project_id
  circleci_gcp_context_id = var.circleci_gcp_context_id
  service_account_names = {
    for name, email in module.github_oidc.service_account_emails :
    name => "projects/${var.project_id}/serviceAccounts/${email}"
  }

  depends_on = [module.github_oidc]
}

# ---------------------------------------------------------------------------
# Example backend + tasks worker
#
# Cloud Run service env vars + image are managed by the CD workflow
# (deploy-example-gcp.yml), which sources values from GitHub Actions secrets.
# Terraform owns the structural definition: resources, scaling, IAM, labels.
# ---------------------------------------------------------------------------

module "backend_artifact_registry" {
  source = "./modules/artifact_registry"

  project_id    = var.project_id
  region        = var.backend_region
  repository_id = var.backend_service_name
  description   = "Container images for ${var.backend_service_name}."

  writer_members = {
    gh-deployer = "serviceAccount:${module.github_oidc.service_account_emails["gh-deployer"]}"
  }

  depends_on = [module.bootstrap]
}

module "tasks_artifact_registry" {
  source = "./modules/artifact_registry"

  project_id    = var.project_id
  region        = var.backend_region
  repository_id = var.tasks_service_name
  description   = "Container images for ${var.tasks_service_name}."

  writer_members = {
    gh-deployer = "serviceAccount:${module.github_oidc.service_account_emails["gh-deployer"]}"
  }

  depends_on = [module.bootstrap]
}

# Dedicated API runtime. Queue enqueue + actAs on terreno-jobs-invoker are bound
# only to this identity so MCP and other default-Compute Cloud Run services cannot
# mint OIDC callbacks to the private jobs worker.
resource "google_service_account" "backend_runtime" {
  project      = var.project_id
  account_id   = "terreno-backend-runtime"
  display_name = "Terreno example backend runtime"
  description  = "Cloud Run identity for the public example API. Sole runtime allowed to enqueue Cloud Tasks and actAs terreno-jobs-invoker."
}

# Cloud Run validates the existing revision template before it applies a
# deployment update, including legacy JWT secret mounts that CD will replace.
resource "google_secret_manager_secret_iam_member" "backend_runtime_legacy_token_secret" {
  project   = var.project_id
  secret_id = "EXAMPLE_TOKEN_SECRET"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "backend_runtime_legacy_refresh_token_secret" {
  project   = var.project_id
  secret_id = "EXAMPLE_REFRESH_TOKEN_SECRET"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend_runtime.email}"
}

module "backend_secret_mongodb_uri" {
  source = "./modules/secret"

  project_id = var.project_id
  secret_id  = "${var.backend_service_name}-mongodb-uri"
  labels     = local.common_labels

  accessor_members = {
    api-runtime   = "serviceAccount:${google_service_account.backend_runtime.email}"
    tasks-runtime = "serviceAccount:${var.project_number}-compute@developer.gserviceaccount.com"
  }

  depends_on = [module.bootstrap]
}

module "backend_secret_langfuse_secret_key" {
  source = "./modules/secret"

  project_id = var.project_id
  secret_id  = "${var.backend_service_name}-langfuse-secret-key"
  labels     = local.common_labels

  accessor_members = {
    api-runtime   = "serviceAccount:${google_service_account.backend_runtime.email}"
    tasks-runtime = "serviceAccount:${var.project_number}-compute@developer.gserviceaccount.com"
  }

  depends_on = [module.bootstrap]
}

module "backend_secret_langfuse_public_key" {
  source = "./modules/secret"

  project_id = var.project_id
  secret_id  = "${var.backend_service_name}-langfuse-public-key"
  labels     = local.common_labels

  accessor_members = {
    api-runtime   = "serviceAccount:${google_service_account.backend_runtime.email}"
    tasks-runtime = "serviceAccount:${var.project_number}-compute@developer.gserviceaccount.com"
  }

  depends_on = [module.bootstrap]
}

module "backend_secret_better_auth" {
  source = "./modules/secret"

  project_id = var.project_id
  secret_id  = "${var.backend_service_name}-better-auth-secret"
  labels     = local.common_labels

  accessor_members = {
    api-runtime = "serviceAccount:${google_service_account.backend_runtime.email}"
  }

  depends_on = [module.bootstrap]
}

# Better Auth only needs a stable random value for session encryption, so the
# secret version is generated here instead of being provisioned manually.
resource "random_password" "better_auth_secret" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret_version" "better_auth_secret" {
  secret      = module.backend_secret_better_auth.name
  secret_data = random_password.better_auth_secret.result
}

module "backend_secret_announcements_upload" {
  source = "./modules/secret"

  project_id = var.project_id
  secret_id  = "${var.backend_service_name}-announcements-upload-token"
  labels     = local.common_labels

  accessor_members = {
    api-runtime = "serviceAccount:${google_service_account.backend_runtime.email}"
  }

  depends_on = [module.bootstrap]
}

# The example app documents this value so release-pack uploads can be tested
# against the deployed backend. It is not a pattern for production apps.
resource "google_secret_manager_secret_version" "announcements_upload_token" {
  secret      = module.backend_secret_announcements_upload.name
  secret_data = var.announcements_upload_token
}

module "backend_service" {
  source = "./modules/cloud_run_service"

  project_id            = var.project_id
  region                = var.backend_region
  service_name          = var.backend_service_name
  image                 = var.placeholder_image
  port                  = 3000
  memory                = "512Mi"
  cpu                   = "1"
  min_instances         = var.backend_min_instances
  max_instances         = var.backend_max_instances
  concurrency           = 80
  timeout_seconds       = 300
  allow_unauthenticated = true
  service_account_email = google_service_account.backend_runtime.email
  labels                = local.common_labels

  depends_on = [
    module.backend_artifact_registry,
    module.backend_secret_mongodb_uri,
    module.backend_secret_langfuse_secret_key,
    module.backend_secret_langfuse_public_key,
    module.backend_secret_better_auth,
    module.backend_secret_announcements_upload,
  ]
}

module "tasks_service" {
  source = "./modules/cloud_run_service"

  project_id            = var.project_id
  region                = var.backend_region
  service_name          = var.tasks_service_name
  image                 = var.placeholder_image
  port                  = 3000
  memory                = "512Mi"
  cpu                   = "1"
  min_instances         = var.tasks_min_instances
  max_instances         = var.tasks_max_instances
  concurrency           = 20
  timeout_seconds       = 1800
  allow_unauthenticated = false
  labels                = local.common_labels

  env = {
    BACKEND_SERVICE = "tasks"
  }

  depends_on = [
    module.tasks_artifact_registry,
    module.backend_secret_mongodb_uri,
    module.backend_secret_langfuse_secret_key,
    module.backend_secret_langfuse_public_key,
  ]
}

# Cloud Tasks is a push queue. The queue controls the worker concurrency pool and
# sends authenticated callbacks to the tasks Cloud Run service. A task's callback
# URL is selected by the enqueuing revision, so PR tags share this queue without
# sharing a callback target or Mongo database.
resource "google_cloud_tasks_queue" "example_jobs" {
  project  = var.project_id
  location = var.backend_region
  name     = var.jobs_queue_name

  rate_limits {
    max_concurrent_dispatches = var.jobs_queue_max_concurrent_dispatches
    max_dispatches_per_second = var.jobs_queue_max_dispatches_per_second
  }

  retry_config {
    max_attempts       = 5
    max_backoff        = "300s"
    max_doublings      = 4
    min_backoff        = "5s"
    max_retry_duration = "3600s"
  }

  # module.github_oidc grants terraform-admin roles/cloudtasks.admin. Without
  # this ordering the queue can be created before that binding exists and the
  # apply fails with a 403 on cloudtasks.queues.create.
  depends_on = [module.bootstrap, module.github_oidc]
}

resource "google_service_account" "jobs_tasks_invoker" {
  project      = var.project_id
  account_id   = "terreno-jobs-invoker"
  display_name = "Terreno jobs Cloud Tasks invoker"
  description  = "OIDC identity used only for Cloud Tasks callbacks to the example jobs worker."
}

resource "google_cloud_tasks_queue_iam_member" "runtime_enqueuer" {
  project  = google_cloud_tasks_queue.example_jobs.project
  location = google_cloud_tasks_queue.example_jobs.location
  name     = google_cloud_tasks_queue.example_jobs.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.backend_runtime.email}"
}

resource "google_service_account_iam_member" "runtime_can_attach_jobs_identity" {
  service_account_id = google_service_account.jobs_tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.backend_runtime.email}"
}

resource "google_cloud_run_v2_service_iam_member" "jobs_tasks_invoker" {
  project  = var.project_id
  location = var.backend_region
  name     = module.tasks_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.jobs_tasks_invoker.email}"
}

# ---------------------------------------------------------------------------
# MCP server (same shape as the backend)
# ---------------------------------------------------------------------------

module "mcp_artifact_registry" {
  source = "./modules/artifact_registry"

  project_id    = var.project_id
  region        = var.mcp_region
  repository_id = var.mcp_service_name
  description   = "Container images for ${var.mcp_service_name}."

  writer_members = {
    gh-deployer = "serviceAccount:${module.github_oidc.service_account_emails["gh-deployer"]}"
  }

  depends_on = [module.bootstrap]
}

module "mcp_service" {
  source = "./modules/cloud_run_service"

  project_id            = var.project_id
  region                = var.mcp_region
  service_name          = var.mcp_service_name
  image                 = var.placeholder_image
  port                  = 8080
  memory                = "512Mi"
  cpu                   = "1"
  min_instances         = var.mcp_min_instances
  max_instances         = var.mcp_max_instances
  concurrency           = 80
  timeout_seconds       = 300
  allow_unauthenticated = true
  labels                = local.common_labels

  depends_on = [module.mcp_artifact_registry]
}
