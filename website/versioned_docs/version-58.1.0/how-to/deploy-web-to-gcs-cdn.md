# Deploy web to GCS + CDN

Host a static Terreno web export on Google Cloud Storage with Cloud CDN.

Replace placeholders: `$PROJECT_ID`, `$REGION`, `$WEB_BUCKET`, `$SITE_NAME`, `$DOMAIN`.

## Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated
- Backend deployed and CORS configured — see [Deploy backend to Cloud Run](deploy-backend-to-cloud-run.md)
- [Build for web](build-for-web.md) completed with the correct `EXPO_PUBLIC_API_URL`

## 1. Build the web bundle

Set the API URL **before** export — it is inlined into the bundle:

```bash
cd example-frontend
EXPO_PUBLIC_API_URL=https://api.example.com bun run export
```

The export script is `bun expo export --platform web` (see `example-frontend/package.json`).

Output is in `dist/`.

## 2. Enable the Compute Engine API

Cloud CDN and its global load-balancing resources require the Compute Engine API:

```bash
gcloud services enable compute.googleapis.com --project="$PROJECT_ID"
```

## 3. Create the GCS bucket

```bash
gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://$WEB_BUCKET/"
```

## 4. Allow public object reads

Cloud CDN must be able to serve the bucket's objects to unauthenticated visitors:

```bash
gsutil iam ch allUsers:objectViewer "gs://$WEB_BUCKET"
```

Do not grant `allUsers` a write role such as `objectAdmin`.

## 5. Configure SPA routing

Client-side routes require `index.html` for unknown paths:

```bash
gsutil web set -e index.html "gs://$WEB_BUCKET"
```

Do not set `MainPageSuffix` — GCS 301 redirects break client-side routing.

## 6. Upload the build

```bash
gsutil -m -h "Cache-Control:public, max-age=31536000, immutable" \
  rsync -r -d -x '.*\.html$' \
  dist/ "gs://$WEB_BUCKET/"

gsutil -h "Cache-Control:no-cache, no-store, must-revalidate" \
  cp dist/index.html "gs://$WEB_BUCKET/index.html"
```

## 7. Create HTTPS CDN resources

The load balancer serves the bucket over HTTPS only. A Google-managed certificate secures
the domain:

```bash
# Backend bucket (CDN-enabled)
gcloud compute backend-buckets create "${SITE_NAME}-backend" \
  --gcs-bucket-name="$WEB_BUCKET" \
  --enable-cdn \
  --no-negative-caching \
  --project="$PROJECT_ID"

# URL map
gcloud compute url-maps create "${SITE_NAME}-url-map" \
  --default-backend-bucket="${SITE_NAME}-backend" \
  --project="$PROJECT_ID"

# Static IP
gcloud compute addresses create "${SITE_NAME}-ip" --global --project="$PROJECT_ID"

# Managed TLS certificate
gcloud compute ssl-certificates create "${SITE_NAME}-cert" \
  --domains="$DOMAIN" \
  --global \
  --project="$PROJECT_ID"

# HTTPS proxy
gcloud compute target-https-proxies create "${SITE_NAME}-https-proxy" \
  --url-map="${SITE_NAME}-url-map" \
  --ssl-certificates="${SITE_NAME}-cert" \
  --project="$PROJECT_ID"

# HTTPS forwarding rule
gcloud compute forwarding-rules create "${SITE_NAME}-https-forwarding-rule" \
  --address="${SITE_NAME}-ip" \
  --target-https-proxy="${SITE_NAME}-https-proxy" \
  --global \
  --ports=443 \
  --project="$PROJECT_ID"
```

## 8. Redirect HTTP to HTTPS

Port 80 should redirect rather than serve the bundle. Without a listener there at all, `http://$DOMAIN` fails to connect instead of sending visitors to the secure URL.

`gcloud` exposes redirect behavior only through an imported spec, not through `url-maps create` flags:

```bash
gcloud compute url-maps import "${SITE_NAME}-http-redirect-url-map" \
  --global --project="$PROJECT_ID" --source=/dev/stdin <<SPEC
name: ${SITE_NAME}-http-redirect-url-map
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
SPEC

gcloud compute target-http-proxies create "${SITE_NAME}-http-proxy" \
  --url-map="${SITE_NAME}-http-redirect-url-map" \
  --project="$PROJECT_ID"

gcloud compute forwarding-rules create "${SITE_NAME}-forwarding-rule" \
  --address="${SITE_NAME}-ip" \
  --target-http-proxy="${SITE_NAME}-http-proxy" \
  --global \
  --ports=80 \
  --project="$PROJECT_ID"
```

Port 80 now only ever returns a 301; the bundle itself is served exclusively over TLS.

Or run the parameterized script, which provisions steps 7 and 8 in one pass:

```bash
./scripts/setup-gcs-hosting.sh \
  --project "$PROJECT_ID" \
  --site-name "$SITE_NAME" \
  --bucket "$WEB_BUCKET" \
  --domain "$DOMAIN"
```

## 9. Point DNS and wait for the certificate

```bash
gcloud compute addresses describe "${SITE_NAME}-ip" --global \
  --project="$PROJECT_ID" --format='value(address)'
```

Create an A record for `$DOMAIN` pointing at that IP. Managed certificates only begin provisioning once DNS resolves to the load balancer, and can take up to about an hour to become active:

```bash
gcloud compute ssl-certificates describe "${SITE_NAME}-cert" --global \
  --project="$PROJECT_ID" --format='value(managed.status)'
```

Wait for `ACTIVE` before sending traffic. Still `PROVISIONING` after an hour usually means the A record does not resolve to the reserved IP.

## 10. Invalidate cache after deploy

```bash
gcloud compute url-maps invalidate-cdn-cache "${SITE_NAME}-url-map" \
  --path "/*" --async --project="$PROJECT_ID"
```

## Static-only path

This guide hosts the `expo export -p web` output as static files. Server-rendered web (SSR, API routes) requires Expo SDK ≥ 55 — see [Web SSR and admin SPA](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/web-ssr-and-admin-spa.md).

## Related

- [Build for web](build-for-web.md)
- [Deploy backend to Cloud Run](deploy-backend-to-cloud-run.md)
- [GCP architecture](../explanation/deployment-architecture-gcp.md)
