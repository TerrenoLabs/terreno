variable "project_id" {
  description = "GCP project ID to deploy into."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run and Artifact Registry (for example us-central1)."
  type        = string
}

variable "service_name" {
  description = "Cloud Run service name. Also prefixes the Artifact Registry repository, runtime service account, and secret IDs."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}[a-z0-9]$", var.service_name))
    error_message = "service_name must be 3-21 characters of lowercase letters, digits, and hyphens, starting with a letter and not ending with a hyphen, so the derived service account IDs stay within GCP's 30-character limit."
  }

  validation {
    condition     = !startswith(var.service_name, "gcp-")
    error_message = "service_name must not start with \"gcp-\": the derived Workload Identity pool ID would be rejected."
  }
}

variable "image" {
  description = "Container image used when the service is first created. Later deploys roll new images with gcloud run deploy; Terraform ignores image changes after creation."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "port" {
  description = "Port the backend container listens on. Cloud Run passes it to the container as PORT."
  type        = number
  default     = 3000
}

variable "cpu" {
  description = "CPU limit per instance (for example \"1\" or \"2\")."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory limit per instance (for example \"512Mi\" or \"1Gi\")."
  type        = string
  default     = "512Mi"
}

variable "min_instances" {
  description = "Minimum instances. Keep at 1 or more for user-facing services: scaling to zero drops websocket connections. Use 0 for dev sandboxes."
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Maximum instances."
  type        = number
  default     = 10
}

variable "concurrency" {
  description = "Maximum concurrent requests per instance."
  type        = number
  default     = 80
}

variable "timeout_seconds" {
  description = "Request timeout in seconds. Socket.IO connections are requests, so the 300s Cloud Run default drops them every 5 minutes. Maximum 3600."
  type        = number
  default     = 3600
}

variable "session_affinity" {
  description = "Route each client to the same instance. Socket.IO needs this when more than one instance runs."
  type        = bool
  default     = true
}

variable "allow_unauthenticated" {
  description = "Allow public (unauthenticated) invocation. A Terreno API is public and enforces its own auth."
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Refuse to destroy the Cloud Run service. Set false for throwaway environments."
  type        = bool
  default     = true
}

variable "env" {
  description = "Plain (non-secret) environment variables, for example NODE_ENV or BETTER_AUTH_URL."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Secret Manager secrets to create, as ENV_VAR_NAME => secret ID suffix. Each becomes the secret \"<service_name>-<suffix>\", readable by the runtime service account. Secrets are created empty; add values with gcloud secrets versions add, then mount them on deploy with the set_secrets_flag output."
  type        = map(string)
  default = {
    MONGO_URI            = "mongodb-uri"
    BETTER_AUTH_SECRET   = "better-auth-secret"
    TOKEN_SECRET         = "token-secret"
    TOKEN_ISSUER         = "token-issuer"
    REFRESH_TOKEN_SECRET = "refresh-token-secret"
    SESSION_SECRET       = "session-secret"
  }
}

variable "uploads_bucket" {
  description = "Existing GCS bucket for user file uploads. The runtime service account gets roles/storage.objectAdmin on this bucket only. Empty skips the grant."
  type        = string
  default     = ""
}

variable "enable_apis" {
  description = "Enable the Cloud Run, Artifact Registry, Secret Manager, and IAM APIs. Disable when another configuration manages project services."
  type        = bool
  default     = true
}

variable "github_deploy" {
  description = "Create a Workload Identity Federation pool and a deployer service account that GitHub Actions in these repositories can impersonate to push images and deploy. Null skips it. owner is the GitHub org or user; repos are \"owner/repo\" strings."
  type = object({
    owner = string
    repos = set(string)
  })
  default = null
}

variable "labels" {
  description = "Labels applied to the Cloud Run service and secrets."
  type        = map(string)
  default     = {}
}
