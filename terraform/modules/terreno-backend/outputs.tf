output "service_url" {
  value       = module.service.uri
  description = "HTTPS URL of the Cloud Run service. Set it as EXPO_PUBLIC_API_URL when building the web app."
}

output "service_name" {
  value       = module.service.name
  description = "Cloud Run service name, for gcloud run deploy."
}

output "service_account_email" {
  value       = google_service_account.runtime.email
  description = "Runtime service account email, for gcloud run deploy --service-account."
}

output "registry_path" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${local.repository_id}"
  description = "Artifact Registry path to tag and push images to: <registry_path>/<image>:<tag>."
}

output "secret_ids" {
  value       = local.secret_ids
  description = "Map of ENV_VAR_NAME => Secret Manager secret ID. Add a version to each before the first real deploy."
}

output "set_secrets_flag" {
  value       = "--set-secrets=${join(",", [for env_name, secret_id in local.secret_ids : "${env_name}=${secret_id}:latest"])}"
  description = "gcloud run deploy flag that mounts every secret as its env var. Pass it on the first real deploy, after each secret has a version."
}

output "deployer_service_account_email" {
  value       = var.github_deploy == null ? null : module.github_oidc[0].service_account_emails[local.deployer_name]
  description = "Deployer service account for GitHub Actions (service_account in google-github-actions/auth). Null when github_deploy is unset."
}

output "workload_identity_provider" {
  value       = var.github_deploy == null ? null : module.github_oidc[0].workload_identity_provider
  description = "Workload identity provider for google-github-actions/auth. Null when github_deploy is unset."
}
