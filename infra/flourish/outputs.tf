output "workload_identity_provider" {
  value       = module.github_oidc.workload_identity_provider
  description = "Pass to google-github-actions/auth as workload_identity_provider. Shared by both service accounts."
}

output "circleci_workload_identity_provider" {
  value       = length(module.circleci_oidc) == 1 ? module.circleci_oidc[0].workload_identity_provider : null
  description = "CircleCI context value for GCP_WIF_PROVIDER_PROD after circleci_org_id and circleci_project_id are configured."
}

output "terraform_admin_sa_email" {
  value       = module.github_oidc.service_account_emails["terraform-admin"]
  description = "Service account for terraform-apply.yml (project-admin scope). Repo var: GCP_TF_ADMIN_SA_PROD."
}

output "gh_deployer_sa_email" {
  value       = module.github_oidc.service_account_emails["gh-deployer"]
  description = "Service account for the CD workflows (deploy-example-gcp, mcp-server-deploy). Repo var: GCP_CD_DEPLOYER_SA_PROD."
}

output "backend_url" {
  value       = module.backend_service.uri
  description = "Default URL of the example backend Cloud Run service."
}

output "tasks_url" {
  value       = module.tasks_service.uri
  description = "Default URL of the example backend tasks Cloud Run service."
}

output "jobs_queue_name" {
  value       = google_cloud_tasks_queue.example_jobs.name
  description = "Cloud Tasks queue used by the example backend durable-jobs runner."
}

output "jobs_tasks_invoker_sa_email" {
  value       = google_service_account.jobs_tasks_invoker.email
  description = "OIDC service account used by Cloud Tasks to invoke the jobs worker."
}

output "backend_runtime_sa_email" {
  value       = google_service_account.backend_runtime.email
  description = "Cloud Run runtime for the example API. Queue enqueuer and jobs-invoker actAs are bound only to this identity."
}

output "mcp_url" {
  value       = module.mcp_service.uri
  description = "Default URL of the MCP Cloud Run service."
}

output "backend_image_repo" {
  value       = module.backend_artifact_registry.docker_repo_url
  description = "Docker image prefix for the example backend."
}

output "tasks_image_repo" {
  value       = module.tasks_artifact_registry.docker_repo_url
  description = "Docker image prefix for the example backend tasks worker."
}

output "mcp_image_repo" {
  value       = module.mcp_artifact_registry.docker_repo_url
  description = "Docker image prefix for the MCP server."
}

output "example_documents_bucket" {
  value       = google_storage_bucket.example_documents.name
  description = "GCS bucket backing the example app's Documents tab (GCS_BUCKET on the backend)."
}
