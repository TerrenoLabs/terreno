resource "google_cloud_run_v2_service" "this" {
  project  = var.project_id
  location = var.region
  name     = var.service_name
  ingress  = var.ingress
  labels   = var.labels

  deletion_protection  = var.deletion_protection
  invoker_iam_disabled = var.allow_unauthenticated

  template {
    max_instance_request_concurrency = var.concurrency
    timeout                          = "${var.timeout_seconds}s"
    session_affinity                 = var.session_affinity
    service_account                  = var.service_account_email != "" ? var.service_account_email : null

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      ports {
        container_port = var.port
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    # The CD workflow rolls new image SHAs and env vars onto this service on
    # every deploy. Terraform owns the structural service definition (scaling,
    # ports, resources, IAM); the workflow owns the runtime payload.
    #
    # template[0].revision is deliberately NOT ignored. Ignoring it pins the
    # revision name from state, so Terraform resends the live revision name
    # alongside a structural change and Cloud Run rejects it with
    # "Revision named '<name>' with different configuration already exists"
    # (409). Leaving it unset lets Cloud Run generate a new revision name.
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].env,
      template[0].containers[0].name,
      template[0].containers[0].resources[0].cpu_idle,
      template[0].containers[0].resources[0].startup_cpu_boost,
      template[0].labels,
      client,
      client_version,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = google_cloud_run_v2_service.this.project
  location = google_cloud_run_v2_service.this.location
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
