output "secret_id" {
  value       = google_secret_manager_secret.this.secret_id
  description = "Short secret ID (used by Cloud Run --set-secrets and gcloud)."
}

output "name" {
  value       = google_secret_manager_secret.this.name
  description = "Fully qualified resource name: projects/<num>/secrets/<id>."
}

output "accessors" {
  value       = { for key, binding in google_secret_manager_secret_iam_member.accessor : key => { role = binding.role, member = binding.member } }
  description = "Map of accessor_members key => {role, member} granted on this secret."
}
