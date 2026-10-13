# Checks against a mocked Google provider: "apply" runs touch no real
# infrastructure and need no credentials. Apply (not plan) makes computed values
# such as service account emails known, so IAM members can be asserted.
# Run with `terraform init -backend=false && terraform test` (1.7+).

mock_provider "google" {}

override_resource {
  target = google_service_account.runtime
  values = {
    email = "api-runtime@example-project.iam.gserviceaccount.com"
    name  = "projects/example-project/serviceAccounts/api-runtime@example-project.iam.gserviceaccount.com"
  }
}

variables {
  project_id   = "example-project"
  region       = "us-central1"
  service_name = "api"
}

run "defaults_fit_socket_io_and_auth" {
  command = apply

  assert {
    condition     = module.service.runtime_settings.session_affinity == true
    error_message = "Session affinity must default on for Socket.IO."
  }

  assert {
    condition     = module.service.runtime_settings.timeout == "3600s"
    error_message = "Request timeout must default to 3600s so sockets survive past 5 minutes."
  }

  assert {
    condition     = module.service.runtime_settings.min_instances == 1
    error_message = "Min instances must default to 1 so websockets do not churn on scale to zero."
  }

  assert {
    condition     = module.service.runtime_settings.service_account == "api-runtime@example-project.iam.gserviceaccount.com"
    error_message = "The service must run as the runtime account."
  }

  assert {
    condition = output.secret_ids == {
      BETTER_AUTH_SECRET   = "api-better-auth-secret"
      MONGO_URI            = "api-mongodb-uri"
      REFRESH_TOKEN_SECRET = "api-refresh-token-secret"
      SESSION_SECRET       = "api-session-secret"
      TOKEN_ISSUER         = "api-token-issuer"
      TOKEN_SECRET         = "api-token-secret"
    }
    error_message = "Default secrets must match the names in docs/how-to/deploy-backend-to-cloud-run.md."
  }

  assert {
    condition = alltrue([
      for name in ["BETTER_AUTH_SECRET", "MONGO_URI", "REFRESH_TOKEN_SECRET", "SESSION_SECRET", "TOKEN_ISSUER", "TOKEN_SECRET"] :
      module.secret[name].accessors == {
        runtime = {
          role   = "roles/secretmanager.secretAccessor"
          member = "serviceAccount:api-runtime@example-project.iam.gserviceaccount.com"
        }
      }
    ])
    error_message = "Each secret must be readable by the runtime account and nobody else."
  }

  assert {
    condition     = output.set_secrets_flag == "--set-secrets=BETTER_AUTH_SECRET=api-better-auth-secret:latest,MONGO_URI=api-mongodb-uri:latest,REFRESH_TOKEN_SECRET=api-refresh-token-secret:latest,SESSION_SECRET=api-session-secret:latest,TOKEN_ISSUER=api-token-issuer:latest,TOKEN_SECRET=api-token-secret:latest"
    error_message = "set_secrets_flag must mount every secret as its env var."
  }

  assert {
    condition     = output.registry_path == "us-central1-docker.pkg.dev/example-project/api"
    error_message = "registry_path must point at the service's Artifact Registry repository."
  }

  assert {
    condition     = google_service_account.runtime.account_id == "api-runtime"
    error_message = "Runtime service account ID must be <service_name>-runtime."
  }

  assert {
    condition = toset(keys(google_project_service.required)) == toset([
      "artifactregistry.googleapis.com",
      "iam.googleapis.com",
      "iamcredentials.googleapis.com",
      "run.googleapis.com",
      "secretmanager.googleapis.com",
    ])
    error_message = "Exactly the backend's required APIs must be enabled by default."
  }

  assert {
    condition     = length(google_storage_bucket_iam_member.runtime_uploads) == 0
    error_message = "No uploads bucket grant without uploads_bucket."
  }

  assert {
    condition     = length(module.github_oidc) == 0 && output.deployer_service_account_email == null && module.artifact_registry.writers == {}
    error_message = "No CI identity or registry writers without github_deploy."
  }
}

run "uploads_bucket_grant_is_scoped_to_that_bucket" {
  command = apply

  variables {
    uploads_bucket = "example-uploads"
  }

  assert {
    condition = (
      google_storage_bucket_iam_member.runtime_uploads[0].bucket == "example-uploads" &&
      google_storage_bucket_iam_member.runtime_uploads[0].role == "roles/storage.objectAdmin" &&
      google_storage_bucket_iam_member.runtime_uploads[0].member == "serviceAccount:api-runtime@example-project.iam.gserviceaccount.com"
    )
    error_message = "The runtime account must get objectAdmin on the uploads bucket only."
  }
}

run "github_deploy_creates_scoped_deployer" {
  command = apply

  variables {
    github_deploy = {
      owner = "example-org"
      repos = ["example-org/example-app"]
    }
  }

  override_resource {
    target = module.github_oidc[0].google_service_account.sa["api-deployer"]
    values = {
      email = "api-deployer@example-project.iam.gserviceaccount.com"
      name  = "projects/example-project/serviceAccounts/api-deployer@example-project.iam.gserviceaccount.com"
    }
  }

  assert {
    condition     = output.deployer_service_account_email == "api-deployer@example-project.iam.gserviceaccount.com"
    error_message = "The deployer account must be <service_name>-deployer."
  }

  assert {
    condition = module.artifact_registry.writers == {
      deployer = {
        role   = "roles/artifactregistry.writer"
        member = "serviceAccount:api-deployer@example-project.iam.gserviceaccount.com"
      }
    }
    error_message = "The deployer must be able to push images to this repository."
  }

  assert {
    condition = (
      google_cloud_run_v2_service_iam_member.deployer[0].role == "roles/run.developer" &&
      google_cloud_run_v2_service_iam_member.deployer[0].member == "serviceAccount:api-deployer@example-project.iam.gserviceaccount.com"
    )
    error_message = "The deployer must get run.developer on this service."
  }

  assert {
    condition = (
      google_service_account_iam_member.deployer_acts_as_runtime[0].role == "roles/iam.serviceAccountUser" &&
      google_service_account_iam_member.deployer_acts_as_runtime[0].member == "serviceAccount:api-deployer@example-project.iam.gserviceaccount.com" &&
      google_service_account_iam_member.deployer_acts_as_runtime[0].service_account_id == "projects/example-project/serviceAccounts/api-runtime@example-project.iam.gserviceaccount.com"
    )
    error_message = "The deployer must be able to actAs the runtime account only."
  }

  assert {
    condition     = contains(keys(google_project_service.required), "sts.googleapis.com")
    error_message = "Keyless CI sign-in needs the STS API."
  }
}

run "dev_sandbox_overrides" {
  command = apply

  variables {
    min_instances       = 0
    deletion_protection = false
    enable_apis         = false
    secrets             = { MONGO_URI = "mongodb-uri" }
  }

  assert {
    condition     = module.service.runtime_settings.min_instances == 0
    error_message = "min_instances override must reach the service."
  }

  assert {
    condition     = length(google_project_service.required) == 0
    error_message = "enable_apis = false must skip project services."
  }

  assert {
    condition     = output.set_secrets_flag == "--set-secrets=MONGO_URI=api-mongodb-uri:latest"
    error_message = "A custom secrets map must replace the defaults."
  }
}

run "accepts_longest_service_name" {
  command = apply

  variables {
    service_name = "abcdefghij-klmnopqrst"
  }

  assert {
    condition     = google_service_account.runtime.account_id == "abcdefghij-klmnopqrst-runtime"
    error_message = "A 21-character name must be accepted."
  }
}

run "rejects_service_name_one_character_too_long" {
  command = plan

  variables {
    service_name = "abcdefghij-klmnopqrstu"
  }

  expect_failures = [var.service_name]
}

run "rejects_trailing_hyphen" {
  command = plan

  variables {
    service_name = "api-"
  }

  expect_failures = [var.service_name]
}

run "rejects_gcp_prefix" {
  command = plan

  variables {
    service_name = "gcp-api"
  }

  expect_failures = [var.service_name]
}
