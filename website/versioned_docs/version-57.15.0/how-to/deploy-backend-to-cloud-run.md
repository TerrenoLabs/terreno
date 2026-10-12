# Deploy backend to Cloud Run

Deploy a Terreno `@terreno/api` backend (for example `example-backend`) to Google Cloud Run with Secret Manager.

Replace placeholders: `$PROJECT_ID`, `$REGION`, `$SERVICE_NAME`, `$REPOSITORY`.

## Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated
- GCP project with billing enabled
- MongoDB Atlas cluster (or other replica set) — [deployment baseline](../explanation/deployment-baseline.md)
- Docker (local build) or Cloud Build

Enable APIs:

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project="$PROJECT_ID"
```

## 1. Create Artifact Registry

```bash
gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID"
```

## 2. Build and push the image

From the **repository root** (the Dockerfile expects the monorepo context):

```bash
docker build -f example-backend/Dockerfile -t "$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$SERVICE_NAME:latest" .
docker push "$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$SERVICE_NAME:latest"
```

## 3. Create secrets

Create Secret Manager secrets (values added out of band):

```bash
for name in mongodb-uri token-secret token-issuer refresh-token-secret session-secret; do
  gcloud secrets create "$SERVICE_NAME-$name" --project="$PROJECT_ID" --replication-policy=automatic
done
```

Add secret values (example for MongoDB URI):

```bash
echo -n 'mongodb+srv://user:pass@cluster.example/terreno?retryWrites=true&w=majority' | \
  gcloud secrets versions add "$SERVICE_NAME-mongodb-uri" --data-file=- --project="$PROJECT_ID"
```

Repeat for `TOKEN_SECRET`, `TOKEN_ISSUER`, `REFRESH_TOKEN_SECRET`, and `SESSION_SECRET`.

For Better Auth, also create `better-auth-secret` and set `AUTH_PROVIDER=better-auth` plus `BETTER_AUTH_URL` at deploy time. See [Configure Better Auth](configure-better-auth.md).

## 4. Runtime service account

```bash
gcloud iam service-accounts create "$SERVICE_NAME-runtime" --project="$PROJECT_ID"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_NAME-runtime@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Grant object access on your uploads bucket separately if using GCS file storage.

## 5. Deploy to Cloud Run

```bash
gcloud run deploy "$SERVICE_NAME" \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$SERVICE_NAME:latest" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --platform=managed \
  --port=3000 \
  --session-affinity \
  --timeout=3600 \
  --min-instances=1 \
  --allow-unauthenticated \
  --service-account="$SERVICE_NAME-runtime@$PROJECT_ID.iam.gserviceaccount.com" \
  --set-secrets="MONGO_URI=$SERVICE_NAME-mongodb-uri:latest,TOKEN_SECRET=$SERVICE_NAME-token-secret:latest,TOKEN_ISSUER=$SERVICE_NAME-token-issuer:latest,REFRESH_TOKEN_SECRET=$SERVICE_NAME-refresh-token-secret:latest,SESSION_SECRET=$SERVICE_NAME-session-secret:latest" \
  --set-env-vars="NODE_ENV=production"
```

Adjust `min-instances` to `0` for dev sandboxes (websockets will churn on cold start).

## 6. Verify

```bash
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')
curl -s "$SERVICE_URL/health" | jq .
```

Expect `"healthy": true`.

## Production constraints

| Symptom | Cause | Fix |
|---------|-------|-----|
| Websockets disconnect every few requests | No session affinity on Cloud Run | Add `--session-affinity` |
| Socket connections drop after ~5 minutes | Default request timeout (300s) | Raise `--timeout` (for example `3600`) |
| Live feature flags / realtime never update; log mentions replica set | MongoDB is standalone, not a replica set | Use Atlas or `replSet` — change streams required (`feature-flags/src/featureFlagsApp.ts`) |
| Bun-compiled container never opens its port while creating indexes | OpenTelemetry Mongoose instrumentation patched an already-loaded Mongoose module | Do not explicitly patch Mongoose in the compiled binary; retain HTTP/Express tracing |
| Container hangs before listening when cloud logging initializes | A network logging transport blocks startup | Log to stdout/stderr during boot; Cloud Run ingests both streams |
| `gcloud run deploy --tag` fails citing an old revision that never became Ready | That tag still points at the failed revision; `--remove-tags` keeps it in the traffic spec | Rebuild traffic with `--to-revisions=<live>=100` plus `--set-tags` of Ready tags only, deploy `--no-traffic` without `--tag`, then `--update-tags` the new revision |
| A zero-traffic preview tag returns `503` with `{"status":"starting"}` indefinitely | The early TCP listener satisfies Cloud Run's startup probe before Mongo and seed work finish; request-only CPU then starves idle boot work | Deploy preview revisions with `--no-cpu-throttling`, then poll the tagged `/health` URL for `"healthy":true` before reporting deployment success |
| First request after idle is slow; sockets reconnect constantly | Scaled to zero | Set `--min-instances=1` for user-facing services |
| Browser API calls blocked by CORS | `corsOrigin` / Better Auth `trustedOrigins` missing web origin | Add your CDN URL to backend CORS and auth config |

## Related

- [Deployment baseline](../explanation/deployment-baseline.md)
- [Environment variables](../reference/environment-variables.md)
- [Deploy web to GCS + CDN](deploy-web-to-gcs-cdn.md)
- [GCP architecture](../explanation/deployment-architecture-gcp.md)
