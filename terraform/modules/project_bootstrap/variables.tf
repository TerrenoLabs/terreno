variable "project_id" {
  description = "GCP project ID that holds this environment's infrastructure."
  type        = string
}

variable "state_bucket_name" {
  description = "Name of the GCS bucket used by Infrastructure Manager as Terraform state. Globally unique."
  type        = string
}

variable "state_bucket_location" {
  description = "Location for the state bucket. Multi-region (US, EU) or specific region (us-central1)."
  type        = string
  default     = "US"
}

variable "services" {
  description = "GCP services to enable on the project. Override to add more."
  type        = set(string)
  default = [
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudtasks.googleapis.com",
    "config.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ]
}
