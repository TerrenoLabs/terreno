# Deploy to Google Cloud Platform

Deploy a Terreno full-stack app to GCP: Cloud Run for the backend, GCS + Cloud CDN for the static web export.

## Before you start

Read the [deployment baseline](../explanation/deployment-baseline.md) — seven requirements (replica-set MongoDB, auth secrets, build-time `EXPO_PUBLIC_API_URL`, and more) apply to every provider.

## Guides

| Guide | What it covers |
|-------|----------------|
| [Deploy backend to Cloud Run](deploy-backend-to-cloud-run.md) | Container image, Secret Manager, Cloud Run with session affinity |
| [Deploy web to GCS + CDN](deploy-web-to-gcs-cdn.md) | Static web export, bucket + CDN setup, cache invalidation |
| [Build for web](build-for-web.md) | Export command, `EXPO_PUBLIC_API_URL`, local verification |

## Architecture

[GCP deployment architecture](../explanation/deployment-architecture-gcp.md) — topology diagram, component roles, and tradeoffs (Cloud Run vs GKE, static vs SSR).

## Scripts

- [`scripts/setup-gcs-hosting.sh`](https://github.com/TerrenoLabs/terreno/blob/master/scripts/setup-gcs-hosting.sh) — parameterized GCS + CDN provisioning for one site

## Environment variables

[Environment variables reference](../reference/environment-variables.md) — full list of backend and client config.

## Operator-specific deployment

Vendor-specific infrastructure (hardcoded project IDs, CI deploy workflows) lives outside these generalized guides. New deployments should follow the guides above with your own `$PROJECT_ID` and bucket names.

## Related

- [Environment variables](../reference/environment-variables.md)
- [Deployment baseline](../explanation/deployment-baseline.md)
