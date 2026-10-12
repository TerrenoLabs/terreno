---
category: Added
---

`terraform/modules/terreno-backend` provisions one Terreno backend on Cloud Run: Artifact Registry, a least-privilege runtime service account, empty Secret Manager secrets, and a websocket-safe service (session affinity, 3600s timeout, one minimum instance). Set `github_deploy` for a keyless GitHub Actions deployer. See [Deploy backend to Cloud Run](docs/how-to/deploy-backend-to-cloud-run.md#manage-with-terraform).
