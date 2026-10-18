# Deploy to Google Cloud Platform

Learn how to deploy the Terreno demo and example-frontend apps to Google Cloud Storage with CDN-backed hosting.

## Prerequisites

Before you begin, ensure you have:

- **GCP Project**: A Google Cloud Platform project with billing enabled
- **gcloud CLI**: [Installed and authenticated](https://cloud.google.com/sdk/docs/install)
- **Permissions**: Your GCP user or service account needs:
  - `roles/storage.admin` (create buckets, set IAM)
  - `roles/compute.loadBalancerAdmin` (create backend buckets, URL maps)
  - `roles/compute.networkAdmin` (create IPs, proxies, forwarding rules)
- **GitHub Repository Access**: Admin access to configure secrets

## Initial Infrastructure Setup

Run the setup script once to provision all GCP resources:

``````bash
# Clone the repository
git clone https://github.com/TerrenoLabs/terreno.git
cd terreno

# Run the setup script
./scripts/setup-gcs-hosting.sh
``````

The script will prompt you for your service account email if `GCP_SA_KEY` is not set. It will create:

1. **GCS Buckets**: `flourish-terreno-terreno-demo` and `flourish-terreno-terreno-frontend-example`
2. **Public Access**: Configured with `allUsers:objectViewer`
3. **SPA Routing**: `notFoundPage=index.html` for client-side routing
4. **CDN Resources**:
   - Backend buckets (CDN-enabled)
   - URL maps
   - Static IP addresses
   - HTTP proxies
   - Forwarding rules

### Script Output

At the end, the script outputs:

``````
=== Setup Complete ===

Demo:
  CDN IP: 34.120.xxx.xxx
  URL: http://34.120.xxx.xxx/
  (Point your DNS A record to this IP)

Frontend Example:
  CDN IP: 34.149.xxx.xxx
  URL: http://34.149.xxx.xxx/
  (Point your DNS A record to this IP)
``````

## Configure GitHub Secrets

Add the following secret to your GitHub repository:

### GCP_SA_KEY

1. Create a service account key:
   ``````bash
   # Create service account
   gcloud iam service-accounts create terreno-deploy \
     --display-name="Terreno Deploy"

   # Grant permissions
   gcloud projects add-iam-policy-binding flourish-terreno \
     --member="serviceAccount:terreno-deploy@flourish-terreno.iam.gserviceaccount.com" \
     --role="roles/storage.objectAdmin"

   gcloud projects add-iam-policy-binding flourish-terreno \
     --member="serviceAccount:terreno-deploy@flourish-terreno.iam.gserviceaccount.com" \
     --role="roles/compute.loadBalancerAdmin"

   # Create JSON key
   gcloud iam service-accounts keys create key.json \
     --iam-account=terreno-deploy@flourish-terreno.iam.gserviceaccount.com
   ``````

2. Add the key to GitHub:
   - Go to **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**
   - Name: `GCP_SA_KEY`
   - Value: Paste the entire contents of `key.json`
   - Click **Add secret**

3. Delete the local key file:
   ``````bash
   rm key.json
   ``````

## Deploy to Production

Production deployments happen automatically when you push to the `master` branch:

``````bash
# Make changes to demo or example-frontend
git checkout master
git pull
# ... make changes ...
git add .
git commit -m "Update demo UI"
git push origin master
``````

The workflows will:
1. Build the app with Bun and Expo
2. Upload the build artifact
3. Sync assets to GCS with cache headers:
   - Hashed assets: `Cache-Control: public, max-age=31536000, immutable`
   - `index.html`: `Cache-Control: no-cache, no-store, must-revalidate`
4. Invalidate the CDN cache

### Triggered Workflows

| App | Workflow | Triggers on paths |
|-----|----------|-------------------|
| Demo | `demo-deploy.yml` | `demo/**`, `ui/**` |
| Example Frontend | `frontend-example-deploy.yml` | `example-frontend/**`, `ui/**`, `rtk/**` |

## Deploy PR Previews

Pull request previews deploy automatically when you open a PR that modifies the relevant paths:

``````bash
# Create a feature branch
git checkout -b feature/new-component

# Make changes
# ... edit files ...

git add .
git commit -m "Add new component"
git push origin feature/new-component

# Open a pull request on GitHub
``````

The workflow will:
1. Build the app with a preview-specific `baseUrl`
2. Deploy to `gs://BUCKET/_previews/pr-{number}/`
3. Create GitHub deployment with a preview URL
4. Comment on the PR with the preview link

### Preview URLs

Previews are accessible at:
- **Demo**: `http://{CDN_IP}/_previews/pr-{number}/` (or `https://storage.googleapis.com/flourish-terreno-terreno-demo/_previews/pr-{number}/` if CDN is not configured)
- **Example Frontend**: `http://{CDN_IP}/_previews/pr-{number}/` (or `https://storage.googleapis.com/flourish-terreno-terreno-frontend-example/_previews/pr-{number}/`)

### Preview Cleanup

When you close or merge a PR, the `preview-cleanup.yml` workflow automatically:
- Deletes preview files from both buckets
- Deactivates GitHub deployments

## Manual Deployment

To deploy manually without GitHub Actions:

``````bash
# Demo
cd demo
bun install
bun run compile
bun run export
gsutil -m -h "Cache-Control:public, max-age=31536000, immutable" \
  rsync -r -d -x '.*\.html$' \
  dist/ gs://flourish-terreno-terreno-demo/
gsutil -h "Cache-Control:no-cache, no-store, must-revalidate" \
  cp dist/index.html gs://flourish-terreno-terreno-demo/index.html

# Invalidate CDN
gcloud compute url-maps invalidate-cdn-cache terreno-demo-url-map \
  --path "/*" --async

# Example Frontend
cd example-frontend
bun install
bun run compile
bun run export
gsutil -m -h "Cache-Control:public, max-age=31536000, immutable" \
  rsync -r -d -x '.*\.html$' \
  dist/ gs://flourish-terreno-terreno-frontend-example/
gsutil -h "Cache-Control:no-cache, no-store, must-revalidate" \
  cp dist/index.html gs://flourish-terreno-terreno-frontend-example/index.html

# Invalidate CDN
gcloud compute url-maps invalidate-cdn-cache terreno-frontend-example-url-map \
  --path "/*" --async
``````

## Troubleshooting

### Build Fails with "Module not found"

**Problem**: Workspace dependencies not compiled.

**Solution**: Run `bun run compile` in `ui/` and `rtk/` before building the app.

### Preview URL Returns 404

**Problem**: CDN's `notFoundPage` serves root `index.html`, not the preview's.

**Solution**: The deploy workflow uploads "bare" route objects. Check that the workflow completed successfully.

### CDN Shows Stale Content

**Problem**: CDN cache not invalidated.

**Solution**: Run cache invalidation manually:
``````bash
gcloud compute url-maps invalidate-cdn-cache URLMAP_NAME --path "/*" --async
``````

### Permission Denied on gsutil

**Problem**: Service account lacks permissions.

**Solution**: Grant `roles/storage.objectAdmin`:
``````bash
gsutil iam ch "serviceAccount:SA_EMAIL:objectAdmin" gs://BUCKET_NAME
``````

### SPA Routes Return 404 on Refresh

**Problem**: Bucket not configured with `notFoundPage`.

**Solution**: Run the setup script or manually configure:
``````bash
gsutil web set -e index.html gs://BUCKET_NAME
``````

## Next Steps

- [GCP Hosting Architecture](../explanation/gcp-hosting-architecture.md) — Understand the design
- [Environment Variables Reference](../reference/environment-variables.md) — Configure runtime settings
- [Set up CI/CD pipelines](../how-to/README.md) — Automate testing and deployment
