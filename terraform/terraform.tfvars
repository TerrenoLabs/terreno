project_id        = "flourish-terreno"
project_number    = "966061500091"
environment       = "prod"
state_bucket_name = "flourish-terreno-tfstate-prod"

github_owner = "TerrenoLabs"
github_repos = ["TerrenoLabs/terreno"]

circleci_org_id         = "2c4d130b-de0a-4573-929f-c67df7521643"
circleci_project_id     = "9efeb72f-2b3b-4944-a8b4-2ea54ef0d9bb"
circleci_gcp_context_id = "faca9f1b-fbfd-442b-94a0-27b6d475b1a2"

backend_region       = "us-central1"
mcp_region           = "us-east1"
backend_service_name = "terreno-backend-example"
tasks_service_name   = "terreno-backend-example-tasks"
jobs_queue_name      = "terreno-example-jobs-v2"
mcp_service_name     = "terreno-mcp"

backend_min_instances = 0
tasks_min_instances   = 0

jobs_queue_max_concurrent_dispatches = 20
jobs_queue_max_dispatches_per_second = 20
