output "name" {
  value       = google_cloud_run_v2_service.this.name
  description = "Service name."
}

output "uri" {
  value       = google_cloud_run_v2_service.this.uri
  description = "Default https URL of the service."
}

output "location" {
  value       = google_cloud_run_v2_service.this.location
  description = "Region."
}

output "runtime_settings" {
  value = {
    session_affinity = google_cloud_run_v2_service.this.template[0].session_affinity
    timeout          = google_cloud_run_v2_service.this.template[0].timeout
    min_instances    = google_cloud_run_v2_service.this.template[0].scaling[0].min_instance_count
    max_instances    = google_cloud_run_v2_service.this.template[0].scaling[0].max_instance_count
    service_account  = google_cloud_run_v2_service.this.template[0].service_account
  }
  description = "Settings that decide whether websockets survive (session affinity, request timeout, scaling bounds) and the runtime identity."
}
