# Deployment baseline

Every Terreno production deployment needs the same seven foundations. Provider guides ([Deploy to GCP](../how-to/deploy-to-gcp.md), future Vercel guide) map these to specific platforms; this page names them once.

See also the [environment variables reference](../reference/environment-variables.md).

## Seven baseline requirements

| # | Requirement | Why Terreno needs it | When missing |
|---|-------------|----------------------|--------------|
| 1 | **MongoDB replica set** | Change streams power realtime and live feature-flag updates | Startup logs: `FeatureFlag.watch() failed — live updates require MongoDB as a replica set` (`feature-flags/src/featureFlagsApp.ts`) |
| 2 | **Auth secrets** | JWT signing and sessions (or Better Auth encryption) | Login fails; tokens rejected |
| 3 | **Long-lived backend process** | Socket.io connections are not request/response | Websockets drop on platforms with short request timeouts or aggressive scale-to-zero |
| 4 | **Correct origins** | CORS and Better Auth `trustedOrigins` must include your web and native schemes | Browser: blocked by CORS; native: auth redirects fail |
| 5 | **Build-time client config** | `EXPO_PUBLIC_*` values are inlined into the web bundle at build time | API calls go to `undefined` or localhost after deploy — see [Build for web](../how-to/build-for-web.md) |
| 6 | **Health endpoint** | Load balancers and orchestrators need readiness probes | Platform marks the service unhealthy and stops routing traffic |
| 7 | **Durable file storage** | Uploads must not live on ephemeral container disk | Files disappear on restart; use GCS/S3 and credentials |

Requirements **1**, **3**, and **5** are the ones teams miss most often.

### Symptom details

**1 — Standalone MongoDB**

Terreno's feature-flag plugin opens a change stream on startup. Without a replica set, live flag sync is disabled and logs:

```text
[feature-flags] FeatureFlag.watch() failed — live updates require MongoDB as a replica set (even single-node).
```

Use [MongoDB Atlas](https://www.mongodb.com/atlas) or a single-node replica set for development.

**3 — Short-lived serverless timeouts**

The RTK/socket client enables reconnection (`reconnection: true`, `reconnectionAttempts: 5` in `rtk/src/socket.ts`). When the backend drops idle connections (for example Cloud Run's default 300s request timeout), clients reconnect but realtime state may lag until the new socket attaches.

**5 — Build-time API URL**

If you set `EXPO_PUBLIC_API_URL` only at runtime on the static host, the bundle still contains whatever was present at `bun run export` time — often `http://localhost:4000`. The browser then fails network requests against localhost.

## Web output modes

Expo Router supports three web output modes. The choice determines hosting options.

| Mode | Output | API routes | SSR | Hosting | Terreno status |
|------|--------|-----------|-----|---------|----------------|
| `single` | One `index.html` SPA | No | No | Any static host | **Current default** |
| `static` | Per-route HTML files | No | No | Any static host | Available; better SEO |
| `server` | `dist/client` + `dist/server` | Yes | Yes (alpha, SDK ≥ 55) | Node/Bun/edge runtime | Not yet — repo catalog is Expo `~54.0.29`; see [Web SSR and admin SPA](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/web-ssr-and-admin-spa.md) |

## Multi-environment checklist

Staging and production differ in these values (each environment needs its **own web build** because of `EXPO_PUBLIC_API_URL`):

| Item | Where to configure |
|------|-------------------|
| Secret values | Platform secret store / Secret Manager |
| `MONGO_URI` | Separate cluster or database per environment |
| `EXPO_PUBLIC_API_URL` | Set before `bun run export` — one build per environment |
| `corsOrigin` | `setupServer({ corsOrigin })` in backend |
| Better Auth `trustedOrigins` + `BETTER_AUTH_URL` | Better Auth config / env |
| Feature-flag defaults | MongoDB documents or seed scripts |

## Containerizing the backend

The canonical Dockerfile is [`example-backend/Dockerfile`](https://github.com/TerrenoLabs/terreno/blob/master/example-backend/Dockerfile). It:

1. Installs workspace dependencies and compiles packages in dependency order.
2. Builds a Bun-compiled binary for production.
3. Runs as a non-root user and exposes `/health` via `@terreno/api-health`.

Three details consumers get wrong:

- **`PORT`** — Cloud Run and other platforms assign the listen port via `PORT`. Terreno reads `process.env.PORT` in `api/src/terrenoApp.ts` (default `9000` if unset).
- **Non-root** — Do not run the container as root in production.
- **Compile order** — Workspace packages (`@terreno/api`, `@terreno/test`, etc.) must compile before the example backend bundles.

CI builds the image on every PR that touches backend paths (`.github/workflows/example-backend-docker.yml`).
