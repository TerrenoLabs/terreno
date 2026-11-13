# GCP Hosting Architecture

This document explains the architecture and design decisions behind Terreno's Google Cloud Platform hosting setup for static web apps.

## Overview

The Terreno monorepo hosts two static web applications on Google Cloud Storage (GCS) with Cloud CDN:

- **Demo app** (`demo/`) — UI component showcase
- **Example frontend** (`example-frontend/`) — Full-stack example with API integration

Both apps use the same architecture pattern optimized for single-page applications (SPAs) with client-side routing.

## Architecture Diagram

``````
┌─────────────────────────────────────────────────────────────┐
│                        Client Browser                        │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP Request
                            ▼
┌─────────────────────────────────────────────────────────────┐
│               Global Forwarding Rule (Static IP)             │
│              (e.g., 34.120.xxx.xxx)                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       HTTP Proxy                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                         URL Map                              │
│           (Routes to default backend bucket)                 │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend Bucket (CDN-enabled)               │
│          (e.g., terreno-demo-backend)                        │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    GCS Bucket (Origin)                       │
│   (e.g., gs://your-project-terreno-demo)                    │
│                                                              │
│   ├── index.html                                            │
│   ├── _expo/                                                │
│   │   └── static/                                           │
│   │       ├── js/                                           │
│   │       ├── css/                                          │
│   │       └── media/                                        │
│   └── _previews/                                            │
│       └── pr-123/                                           │
│           └── index.html                                    │
└─────────────────────────────────────────────────────────────┘
``````

## Components

### 1. GCS Bucket (Origin)

**Purpose**: Store static assets (HTML, JS, CSS, images).

**Configuration**:
- **Public access**: `allUsers:objectViewer` IAM binding
- **Static website config**: `notFoundPage=index.html` for SPA routing
- **No `mainPageSuffix`**: Avoids GCS 301 redirects that break client routing

**Key Feature**: The `notFoundPage` directive serves `index.html` for any 404, enabling client-side routing. When a user visits `/about` directly, GCS returns `index.html`, and the React Router or Expo Router handles the route client-side.

### 2. Backend Bucket (CDN)

**Purpose**: Serve bucket content with Cloud CDN caching.

**Configuration**:
- **CDN enabled**: Responses are cached at Google edge locations worldwide
- **Negative caching disabled**: Prevents Cloud CDN from caching 404 responses, which would cause stale 404s for newly-deployed asset hashes
- **Linked to GCS bucket**: Single bucket per backend

**Performance**: CDN reduces latency by serving cached content from edge locations closest to users.

### 3. URL Map

**Purpose**: Route incoming requests to the backend bucket.

**Configuration**:
- **Default service**: Points to the backend bucket
- **Path-based routing**: All paths (`/*`) route to the same backend

**Extensibility**: URL maps support path-based routing (e.g., `/api/*` → backend service, `/*` → frontend), but Terreno uses a single backend per app.

### 4. HTTP Proxy

**Purpose**: Terminate HTTP connections and forward to the URL map.

**Configuration**:
- **Protocol**: HTTP (can be upgraded to HTTPS with certificates)
- **Forwarding**: Passes requests to URL map

**HTTPS Support**: To enable HTTPS, create an SSL certificate and attach it to an HTTPS proxy instead.

### 5. Global Forwarding Rule (Static IP)

**Purpose**: Assign a static external IP address to the HTTP proxy.

**Configuration**:
- **IP address**: Reserved global static IP (e.g., `34.120.xxx.xxx`)
- **Port**: 80 (HTTP)

**DNS**: Point your domain's A record to this IP for custom domains.

## Design Decisions

### Why Google Cloud Storage over Netlify?

**Pros**:
- **Cost**: GCS + CDN is cheaper at scale (no bandwidth limits on free tier ending)
- **Control**: Full control over caching, CDN configuration, and infrastructure
- **Integration**: Native integration with other GCP services (Cloud Run backend, Cloud Build, etc.)
- **Flexibility**: URL maps enable complex routing if needed

**Cons**:
- **Setup complexity**: Requires manual GCP resource provisioning
- **No built-in forms/functions**: Netlify provides these; GCS does not
- **DNS management**: Requires separate DNS configuration (Netlify provides DNS)

**Decision**: GCS is better for Terreno because it's a showcase/demo project with minimal dynamic needs, and cost/control outweigh convenience.

### Cache Strategy

| File Type | Cache-Control Header | Rationale |
|-----------|----------------------|-----------|
| **Hashed assets** (e.g., `main.abc123.js`) | `public, max-age=31536000, immutable` | Content hash in filename ensures uniqueness; safe to cache forever |
| **index.html** | `no-cache, no-store, must-revalidate` | Entry point must never be cached to ensure users get the latest app shell |

**Implementation**: Deployment workflows use `gsutil -h` to set headers during upload:
``````bash
# Sync hashed assets with long cache
gsutil -m -h "Cache-Control:public, max-age=31536000, immutable" \
  rsync -r -d -x '.*\.html$' dist/ gs://BUCKET/

# Upload index.html with no-cache
gsutil -h "Cache-Control:no-cache, no-store, must-revalidate" \
  cp dist/index.html gs://BUCKET/index.html
``````

### SPA Routing Implementation

**Challenge**: SPAs use client-side routing (e.g., `/about`, `/profile`), but GCS has no such files.

**Solution**:
1. **GCS `notFoundPage`**: Configure bucket with `notFoundPage=index.html`
2. **CDN behavior**: When a request for `/about` results in a 404, GCS serves `index.html`
3. **Client-side routing**: The app's router (Expo Router, React Router) reads the URL and renders the correct component

**Why not `mainPageSuffix`?**
- `mainPageSuffix=index.html` causes GCS to 301 redirect `/demo/` → `/demo/index.html`, breaking client routing and creating duplicate URLs.
- `notFoundPage` returns 200 with `index.html` content, preserving the original URL.

### Preview Deployment Strategy

**Goal**: Deploy PR previews to unique URLs without polluting production.

**Approach**:
- **Path-based isolation**: Previews deploy to `_previews/pr-{number}/` within the same bucket
- **Bare route objects**: Upload HTML files as bare objects (no `.html` extension) for SPA routing
- **Dynamic baseUrl**: Inject `expo.experiments.baseUrl = /_previews/pr-123` during build

**Example**:
``````
gs://bucket/
  ├── index.html                         (production)
  ├── _expo/static/js/main.abc.js        (production)
  └── _previews/
      ├── pr-123                         (bare object, serves preview index.html)
      └── pr-123/
          ├── index.html                 (preview root)
          └── _expo/static/js/main.def.js
``````

**CDN Limitation**: The CDN's `notFoundPage` always serves the root `index.html`, not the preview's. To work around this:
1. Upload preview routes as bare objects (e.g., `_previews/pr-123/about` → `about.html` uploaded without extension)
2. Set `Content-Type: text/html` manually

**Trade-off**: This adds complexity but keeps previews in the same bucket, simplifying cleanup.

## Deployment Flow

### Production Deploy

1. **Trigger**: Push to `master` branch with changes to `demo/**`, `ui/**`, `example-frontend/**`, `rtk/**`
2. **Build**: GitHub Actions runs `bun run export` to generate static files
3. **Ensure negative caching disabled**: Update backend bucket to prevent cached 404s
4. **Upload**:
   - Sync new hashed assets (additive, no deletions) so old bundles remain available
   - Upload `index.html` with no-cache header, atomically switching to new bundle hashes
5. **Invalidate CDN**: `gcloud compute url-maps invalidate-cdn-cache --path "/*"` clears all cached paths
6. **Cleanup**: Sync with deletions (`-d`) to remove old assets no longer referenced

### Preview Deploy

1. **Trigger**: Open PR with changes to relevant paths
2. **Build**: Inject `baseUrl` and run `bun run export`
3. **Upload**:
   - Upload to `_previews/pr-{number}/`
   - Create bare route objects for SPA routing
4. **GitHub Deployment**: Create deployment with preview URL
5. **Comment**: Bot comments on PR with the preview link

### Preview Cleanup

1. **Trigger**: PR closed or merged
2. **Delete**: `gsutil -m rm -r gs://BUCKET/_previews/pr-{number}/`
3. **Deactivate**: Mark GitHub deployments as inactive

## Security Considerations

### Public Read Access

**Risk**: Anyone can access bucket contents.

**Mitigation**: Only public-facing demo apps are hosted. No sensitive data or credentials are stored in GCS.

### Service Account Permissions

**Principle of Least Privilege**: The CI service account has:
- `roles/storage.objectAdmin` on specific buckets (not project-wide)
- `roles/compute.loadBalancerAdmin` for CDN cache invalidation only

**Key Storage**: `GCP_SA_KEY` secret is encrypted in GitHub Secrets and never logged.

## Cost Optimization

### Storage Costs

- **GCS Standard**: ~$0.02/GB/month
- **Typical app size**: ~5-10 MB
- **Monthly cost**: &lt; $0.01/month per app

### CDN Costs

- **Cache hit**: ~$0.08/GB
- **Cache miss**: ~$0.12/GB (includes origin fetch)
- **Expected traffic**: Low (demo/example apps)
- **Monthly cost**: &lt; $5/month for both apps

### Optimization Strategies

1. **Maximize cache hits**: Long cache headers on hashed assets
2. **Minimize origin fetches**: CDN caches effectively
3. **Compress assets**: Expo build automatically gzips/brotlis assets
4. **Delete old previews**: Cleanup workflow prevents accumulation

## Monitoring and Observability

### Metrics

Monitor via GCP Console:
- **Storage**: Bucket size, object count
- **CDN**: Cache hit rate, request count, bandwidth
- **Costs**: Cloud Billing dashboard

### Alerts

Set up budget alerts in GCP:
``````bash
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="Terreno Hosting Budget" \
  --budget-amount=20USD \
  --threshold-rule=percent=90
``````

### Logs

- **Access logs**: Enable bucket access logging if needed
- **CDN logs**: Enable Cloud CDN logging for request analysis

## Future Improvements

### HTTPS Support

1. Reserve a domain (e.g., `demo.terreno.dev`)
2. Create an SSL certificate:
   ``````bash
   gcloud compute ssl-certificates create terreno-demo-cert \
     --domains=demo.terreno.dev \
     --global
   ``````
3. Create HTTPS proxy and forwarding rule
4. Update DNS A record

### Custom Domains

Point DNS A records to the static IPs:
``````
demo.terreno.dev.     A     34.120.xxx.xxx
example.terreno.dev.  A     34.149.xxx.xxx
``````

### CDN Performance Tuning

- **Geo-routing**: Use Cloud Load Balancing for region-specific backends
- **Compression**: Enable brotli/gzip at CDN level
- **Pre-warming**: Warm CDN cache after deployments

### Multi-Region Redundancy

- Replicate buckets to multiple regions
- Use Cloud Load Balancing to route to nearest region

## Related Documentation

- [Deploy to GCP](../how-to/deploy-to-gcp.md) — Step-by-step deployment guide
- [Environment Variables Reference](../reference/environment-variables.md) — Configure runtime settings
- [GCP Documentation: Hosting a Static Website](https://cloud.google.com/storage/docs/hosting-static-website) — Official GCS guide
