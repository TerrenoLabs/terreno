variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Cloud Run region."
  type        = string
}

variable "service_name" {
  description = "Cloud Run service name."
  type        = string
}

variable "image" {
  description = "Container image to seed the service with. Used only for initial create; ongoing rollouts are owned by the GitHub Actions deploy workflow (lifecycle.ignore_changes on template.containers[0].image)."
  type        = string
}

variable "service_account_email" {
  description = "Runtime service account email. If empty, Cloud Run's default compute SA is used."
  type        = string
  default     = ""
}

variable "env" {
  description = "Plain environment variables."
  type        = map(string)
  default     = {}
}

variable "secret_env" {
  description = "Environment variables sourced from Secret Manager. Map of ENV_VAR_NAME => secret_id (always uses :latest version)."
  type        = map(string)
  default     = {}
}

variable "port" {
  description = "Container port."
  type        = number
  default     = 3000
}

variable "cpu" {
  description = "CPU allocation (e.g., '1', '2')."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory allocation (e.g., '512Mi', '1Gi')."
  type        = string
  default     = "512Mi"
}

variable "min_instances" {
  description = "Minimum number of instances."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of instances."
  type        = number
  default     = 10
}

variable "concurrency" {
  description = "Maximum concurrent requests per instance."
  type        = number
  default     = 80
}

variable "timeout_seconds" {
  description = "Request timeout."
  type        = number
  default     = 300
}

variable "session_affinity" {
  description = "Route each client to the same instance. Socket.IO needs this when more than one instance runs. Null leaves the Cloud Run default (off)."
  type        = bool
  default     = null
}

variable "allow_unauthenticated" {
  description = "If true, grants roles/run.invoker to allUsers AND sets invoker_iam_disabled on the service (matches the live Cloud Run behavior — IAM is bypassed, so the binding is informational but harmless). If false, IAM is enforced normally."
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "If true, Terraform refuses to destroy the service (Cloud Run's default for v2 services). Defaults to true for prod safety. Override to false in throwaway envs."
  type        = bool
  default     = true
}

variable "ingress" {
  description = "Cloud Run ingress setting (INGRESS_TRAFFIC_ALL, INGRESS_TRAFFIC_INTERNAL_ONLY, INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER)."
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
}

variable "labels" {
  description = "Resource labels applied to the service."
  type        = map(string)
  default     = {}
}
