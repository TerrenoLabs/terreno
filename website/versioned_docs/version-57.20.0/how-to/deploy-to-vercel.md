# Deploy to Vercel

Deploy a Terreno web app, and optionally its `@terreno/api` backend, to Vercel.

Terreno deploys its own example apps this way, next to the existing Cloud Run (backend) and Netlify (frontend, demo) deploys, while the Vercel topology is evaluated:

| App | Vercel project | Production URL |
|---|---|---|
| `example-backend` | `terreno-backend` | https://terrenolabs-backend.vercel.app |
| `example-frontend` | `terreno-frontend` | https://terrenolabs-frontend.vercel.app |
| `demo` | `terreno-demo` | https://terrenolabs-demo.vercel.app |

All three live in the `terrenolabs` team, run in `iad1`, and have Deployment Protection off so links can be shared. The commands below use those names; replace them with yours.

"Vercel" in `@terreno/ai` means the Vercel AI SDK, the model library `@terreno/ai` uses to talk to LLM providers. It is unrelated to Vercel hosting. You can use the Vercel AI SDK on any host, and you can host on Vercel without it.

## What goes where

Every Terreno app has three parts: the web bundle, the `@terreno/api` backend (REST, Better Auth, Socket.IO, change-stream watchers), and MongoDB. Vercel can host the web bundle in every case. The question is where the backend runs.

**Split: web on Vercel, backend on a long-lived host.** The web export is static files on Vercel. The backend runs as a long-lived process on Cloud Run or a similar host, and the browser calls it cross-origin for REST and WebSockets. This is the conservative default. Use it when the app needs background job workers, GCS uploads through a service account, the durable harness runner, or sockets that stay open for hours.

**All-in-one: web and backend on Vercel.** The backend runs as a Vercel Function, and Socket.IO runs on Vercel's WebSocket support, which is in public beta. You get one platform, per-PR previews of the whole stack, and no container to build. In exchange, the process freezes between requests, sockets close at the Function max duration, and you pay for Function time while each socket is open. Read [Run Terreno WebSockets on Vercel Functions](vercel-function-websockets.md) before choosing this.

| | Split (Vercel web + Cloud Run) | All-in-one (Vercel web + Functions) |
|---|---|---|
| Background jobs worker | In-process or separate service | Not on Vercel. Run `bun run jobs:worker` elsewhere, or use a cloud runner ([Durable background jobs](background-jobs.md)) |
| Socket lifetime | Up to the request timeout (`--timeout=3600` on Cloud Run) | Closes at Function max duration: 300s default, 800s max on Pro |
| Socket session affinity | `--session-affinity` | None; WebSocket transport only |
| Cost while sockets are idle | Instance time (one `min-instance` covers many sockets) | Function time for every open socket |
| File uploads (GCS) | Service account on the runtime | Not wired up on Vercel yet |
| PR previews | Cloud Run tag per PR | Vercel preview per PR, fixed alias per PR |
| Ops | Container image, Artifact Registry, Secret Manager | `vercel.json` and project env vars |
| MongoDB access | Private networking possible | Public endpoint; Vercel has no static egress IPs without Secure Compute |

Both topologies still need everything in the [deployment baseline](../explanation/deployment-baseline.md): a MongoDB replica set, secrets, CORS and auth origins, and a build-time API URL.

## Prerequisites

- A Vercel account and team. Fluid compute must be on for any project that serves the backend; it is the default for projects created on or after April 23, 2025.
- MongoDB Atlas (or another replica set) that accepts connections from Vercel. Atlas network access has to allow Vercel's dynamic IPs, since Vercel only offers static egress through Secure Compute or Static IPs.
- The Vercel CLI. These commands run it through `bunx vercel`; CI pins a version with `bunx vercel@<version>`.
- For the split topology, a deployed backend ([Deploy backend to Cloud Run](deploy-backend-to-cloud-run.md)).

## Create the projects

Create one Vercel project per app and set its **Root Directory** to the app folder (`example-backend`, `example-frontend`, `demo`). Vercel installs dependencies from the repository root, so Bun workspaces and `catalog:` versions resolve as they do locally.

For each project:

1. **Settings → Functions → Fluid Compute**: on (backend project).
2. **Settings → Functions → Function Max Duration**: as high as your plan allows if the backend serves sockets (300s on Hobby, up to 800s on Pro).
3. **Settings → Functions → Region**: next to your MongoDB cluster. Terreno uses `iad1`.
4. **Settings → Deployment Protection**: decide whether preview and production links need a Vercel login. Terreno turns it off so links can be shared; leave it on for private apps.

To link a local checkout to a project (writes `.vercel/`, which is git-ignored), run from the repository root:

```bash
bunx vercel link --project terreno-frontend
```

Each committed `vercel.json` sets `"git": {"deploymentEnabled": false}`, so pushes do not trigger Vercel's Git integration. Deploys come only from CI or from the CLI commands below. Remove that key if you want Vercel to build every push instead.

## Backend on Vercel Functions

Skip this section for the split topology.

### Entry point

Vercel's Express preset serves the default export of the first file that imports `express`, checking `app`, `index`, and `server` at the project root and then `src/app`, `src/index`, `src/server`. `example-backend` has two entries:

- `src/index.ts` stays the Cloud Run entry. It binds `PORT` and runs the in-process workers.
- `src/app.ts` is the Vercel entry. It comes first in Vercel's lookup and imports `express` types so the preset picks it.

`src/app.ts` calls `createVercelServer()` (`src/vercelServer.ts`), which creates an `http.Server` and calls `start(false, server)`. With a host-owned server, `start` does not bind `PORT`, waits for sync indexes and startup migrations (`terraApp.whenReady()`) before returning, and does not start the jobs worker or the harness runner. `app.ts` then exports the server:

```typescript
const {server}: {app: express.Application; server: Server} = await createVercelServer();

export default server;
```

Export the `http.Server`, not the Express app. Vercel serves an exported server as-is, WebSocket upgrades included. A bare Express app would leave `/socket.io/` unmounted.

### `vercel.json`

`example-backend/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "express",
  "installCommand": "bun install --frozen-lockfile",
  "buildCommand": "bun run build:vercel",
  "git": {
    "deploymentEnabled": false
  },
  "outputDirectory": "dist-vercel"
}
```

`build:vercel` in `example-backend/package.json` bundles the entry and every dependency into one Node file:

```bash
bun build src/app.ts --outdir ./dist-vercel --target node --define 'process.env.NODE_ENV="production"' --banner '// Vercel Express preset entry marker (its detection scans for: import "express")'
```

Each part of that setup fixes a failure seen while deploying this:

- `buildCommand` is set because Vercel otherwise runs the package's `build` script. In `example-backend`, `build` writes a Bun-target bundle to `dist/`, and Vercel picked that as the handler.
- `buildCommand` must never be `""`. With an empty build command Vercel served the backend source tree as static files.
- Dependencies are bundled, not external. Vercel's Node launcher refuses `require()` of an ES module (`ERR_REQUIRE_ESM`) even on Node versions that allow it locally, and `@terreno/api`'s CommonJS build requires ESM-only packages such as `better-auth`. Bun's bundler resolves those at build time. To reproduce the launcher locally, boot the entry with `node --no-experimental-require-module`.
- `--define 'process.env.NODE_ENV="production"'` is required. Bun inlines `process.env.NODE_ENV` at bundle time and defaults it to `"development"`, which turned on dev-only code paths (the first symptom was a crash writing `.terreno/logs` on the read-only filesystem). Every Vercel environment runs with `NODE_ENV=production`, so the value is fixed at build time.
- `--banner` writes a comment containing `import "express"`. Vercel's Express preset only accepts an entry whose text imports express, and a full bundle inlines express.
- The deploy is built locally (`vercel build`, then `vercel deploy --prebuilt`). Vercel's newer "backends" builder (`VERCEL_EXPERIMENTAL_BACKENDS=1`, which remote builds may use) re-bundles workspace-linked packages such as `@terreno/api` itself and broke on a circular CommonJS require (`require_authRecovery is not a function`).

The function runs on Node 24 (`nodejs24.x`), not Bun. `@terreno/api`, including its `@sentry/bun` import, works on Node.

### Environment variables

Set these in **Settings → Environment Variables** for the Production environment (values below are Terreno's):

| Variable | Value |
|---|---|
| `MONGO_URI` | Atlas connection string. Terreno shares the Cloud Run production database during the evaluation. |
| `AUTH_PROVIDER` | `better-auth` |
| `BETTER_AUTH_SECRET` | Same secret as the Cloud Run backend, so sessions work on both |
| `BETTER_AUTH_URL` | `https://terrenolabs-backend.vercel.app` |
| `CORS_ORIGINS` | `https://terrenolabs-frontend.vercel.app` |
| `CROSS_DOMAIN_AUTH_COOKIES` | `true` (web and API are on different origins) |
| `NODE_ENV` | `production` |
| `JOBS_START_WORKER` | `false` |

See [Environment variables](../reference/environment-variables.md) for the full list and [Configure Better Auth](configure-better-auth.md) for auth settings.

### Known gaps on Vercel

These work on Cloud Run and do not yet work on the Vercel backend:

- **Background jobs worker.** Functions freeze between requests, so `start` never starts the in-process worker on Vercel. Run `bun run jobs:worker` on a long-lived host against the same database, or dispatch through a cloud runner.
- **GCS uploads.** `GCS_BUCKET` is unset on Vercel. Cloud Run authenticates to GCS with its service account; nothing equivalent is wired up for the Function.
- **Harness runner.** Not started on a host-owned server.
- **Admin SPA at `/console`.** Not served from the Vercel backend.
- **Cross-instance rooms.** Change-stream sync deltas reach every instance, but direct `io.to(room).emit` reaches only sockets on the same instance. See [State](vercel-function-websockets.md#state).

## Web app on Vercel

Both Terreno web apps use `web.output: "static"` in `app.json`: Expo writes one HTML file per route into `dist/`. Vercel serves those files, and a fallback rewrite sends unknown paths (dynamic routes such as `/admin/[model]`, and typos) to `/` so the client router can take over. That is the same behavior as the Netlify `_redirects` rule `/* /index.html 200`.

`example-frontend/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "bun run build:vercel",
  "outputDirectory": "dist",
  "installCommand": "bun install --frozen-lockfile",
  "framework": null,
  "cleanUrls": true,
  "git": {"deploymentEnabled": false},
  "rewrites": [{"source": "/(.*)", "destination": "/"}]
}
```

`demo/vercel.json` is the same except `"buildCommand": "bun run export"` (`expo export -p web`); the demo has no backend.

Expo's [publishing guide](https://docs.expo.dev/guides/publishing-websites) shows the same shape with `"buildCommand": "expo export -p web"` and the rewrite source written as `/:path*`. `framework: null` stops Vercel from guessing a framework preset, `cleanUrls` serves `/profile` from `profile.html`, and Vercel checks the filesystem before applying `rewrites`, so real files are never rewritten.

### The backend URL is baked in at build time

`EXPO_PUBLIC_API_URL` is inlined into the JavaScript bundle at build time ([build for web](build-for-web.md)). Setting it on Vercel after a deploy changes nothing until the next build.

There is a second catch. Expo inlines `EXPO_PUBLIC_*` only into app source, but `@terreno/rtk` resolves the API base URL inside `node_modules`, where the inlined value does not reach. In a production bundle it reads `expoConfig.extra.BASE_URL` instead. Without that, the deployed app calls `http://localhost:4000`.

`example-frontend/scripts/vercelBuild.ts` (`bun run build:vercel`) handles both:

1. Fails the build if `EXPO_PUBLIC_API_URL` is unset, and rejects non-`https` URLs other than `localhost`.
2. Writes `extra.BASE_URL`, `extra.apiBaseUrl`, and `extra.SOCKET_TRANSPORTS: "websocket"` into `app.json`.
3. Runs `bun expo export --platform web --clear`. `--clear` matters: Metro caches the manifest, and a cached build keeps the previous `BASE_URL`.

Copy that script into your own app, or set `extra.BASE_URL` some other way before `expo export`.

`SOCKET_TRANSPORTS` is there for the all-in-one topology. `@terreno/rtk` `useSocketConnection` and `@terreno/syncdb` default to `["polling", "websocket"]`, and polling against a Vercel Function can fail with `Session ID unknown`. `example-frontend/store/socketTransports.ts` parses the value and passes it as `useSocketConnection({transports})` and `createSyncDb({socketTransports})`. A web app on the split topology, talking to Cloud Run with session affinity, can keep the default.

## Configure each environment

Vercel scopes environment variables to **Production**, **Preview**, and **Development**. Set `EXPO_PUBLIC_API_URL` on the web project once per scope:

```bash
bunx vercel env add EXPO_PUBLIC_API_URL production
bunx vercel env add EXPO_PUBLIC_API_URL preview
```

Typically production points at the production backend and preview at a staging backend. Terreno's CI passes the URL directly instead: production builds use `https://terrenolabs-backend.vercel.app`, and PR builds use that PR's backend alias.

Each environment is a separate build with its own URL baked in. **Promoting a preview deployment to production does not rebuild it**: the promoted bundle keeps calling the preview backend. Deploy production from a fresh production build (`vercel build --prod`), not by promoting a preview. The same rule applies to every value in the baseline [multi-environment checklist](../explanation/deployment-baseline.md#multi-environment-checklist).

## Preview deployments

Every Vercel deployment gets its own URL, and branch deployments get one more:

- Per deployment: `<project>-<hash>-<team>.vercel.app`, for example `terreno-frontend-a1b2c3d4e-terrenolabs.vercel.app`
- Per branch: `<project>-git-<branch>-<team>.vercel.app`

Terreno's CI also aliases each PR to a fixed host, `terrenolabs-<target>-pr-<N>.vercel.app`, so the PR frontend can be built against the PR backend before that backend exists.

A new origin breaks two backend settings until you allow it.

### CORS

The web app calls the backend with credentials (Better Auth sends `credentials: "include"`), so the backend must answer with the exact requesting origin in `Access-Control-Allow-Origin` and set `Access-Control-Allow-Credentials: true`. `TerrenoApp`'s `corsOrigin` accepts a string, a `RegExp`, or an array of both (`CorsOrigin` in `api/src/terrenoApp.ts`).

`example-backend` builds that list from `CORS_ORIGINS` (`example-backend/src/utils/betterAuthConfig.ts`). Entries are comma-separated, and an entry may contain `*`. `toCorsOrigin` turns such an entry into an anchored, case-insensitive `RegExp` in which `*` matches one run of letters, digits, and hyphens and never a dot. Use wildcards only on a domain you control:

```typescript
// CORS_ORIGINS=https://app.example.com,https://*.preview.example.com
new TerrenoApp({
  corsOrigin: getCorsOrigins(),
  // [
  //   "http://localhost:8082", "http://127.0.0.1:8082",
  //   "https://app.example.com",
  //   /^https:\/\/[a-z0-9-]+\.preview\.example\.com$/i,
  // ]
  // ...
});
```

Terreno's own Vercel deploys list exact origins only: production allows `https://terrenolabs-frontend.vercel.app`, and each PR backend allows only its PR alias. The per-deployment URLs (`terreno-frontend-<hash>-terrenolabs.vercel.app`) are not allowed, so open a preview through its PR alias.

Do not use `corsOrigin: true` or `"*"` in production. `true` reflects whatever origin the request names, and because the browser sends the user's session cookie with credentialed requests, any website the user visits could then call your API as that user and read the responses. `"*"` is rejected by browsers for credentialed requests, so it fails instead of leaking, but it is still the wrong fix.

Never put a wildcard on `vercel.app`. It is a shared namespace: a project's production domain is `<project-name>.vercel.app` when that name is free, so another Vercel account could name a project `terreno-frontend-x-terrenolabs` and get a hostname matching `https://terreno-frontend-*-terrenolabs.vercel.app`. For wildcard previews, serve them from a custom domain you control (for example `*.preview.example.com`).

### Better Auth `trustedOrigins`

Better Auth checks the request origin separately, against `trustedOrigins` (`api/src/betterAuth.ts`). `example-backend` passes the native deep-link schemes (`frontend://`, `terreno://`, `exp://`) plus the same raw `CORS_ORIGINS` entries. Better Auth matches `*` patterns itself, and its wildcard is broader than the CORS `RegExp`: in an `https://` pattern, `*` can also match dots. On a domain you control that only widens trust to your own subdomains, which is one more reason to keep wildcards off shared namespaces.

Set `BETTER_AUTH_URL` to the backend's own public URL in each environment. Terreno's PR backends get `BETTER_AUTH_URL=https://terrenolabs-backend-pr-<N>.vercel.app` per deployment.

### OAuth redirect URIs

Google, GitHub, and Apple require each redirect URI to be registered exactly, and most do not accept wildcards. Social sign-in therefore works on fixed origins only: production, and the fixed PR aliases if you register them. For per-deployment URLs, either route OAuth through one fixed origin that redirects back to the preview, or test social sign-in only on production and a stable staging URL. Email and password sign-in works on any allowed origin.

### PR backends

When the backend is on Vercel too, each PR backend preview gets these runtime variables on top of the project's Preview variables:

| Variable | Value |
|---|---|
| `MONGO_DB_NAME` | `terreno-example-pr-<N>` (the PR database the Cloud Run preview seeds and preview cleanup drops) |
| `SEED_DEFAULTS` | `false` (the Cloud Run preview seeds the database; the seed runs an in-process supertest server, which cannot bind a port inside a Function) |
| `BETTER_AUTH_URL` | `https://terrenolabs-backend-pr-<N>.vercel.app` |
| `CORS_ORIGINS` | `https://terrenolabs-frontend-pr-<N>.vercel.app` |

## Deploy

Terreno builds locally or in CI and uploads the prebuilt output. That runs the build on a machine you control, with the stable builder, and lets one script handle all three projects.

From the repository root, with the project linked or `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` exported:

```bash
# Preview
bunx vercel pull --yes --environment=preview
bunx vercel build
bunx vercel deploy --prebuilt

# Production
bunx vercel pull --yes --environment=production
bunx vercel build --prod
bunx vercel deploy --prebuilt --prod
```

`vercel pull` downloads the project settings and that environment's variables into `.vercel/`. `vercel build` runs `buildCommand` from `vercel.json` and writes `.vercel/output`. `vercel deploy --prebuilt` uploads it and prints the deployment URL. Production deploys go live on the production domain as soon as they finish.

For the web project, `vercel build` needs `EXPO_PUBLIC_API_URL`. It comes from the pulled environment variables, or set it inline:

```bash
EXPO_PUBLIC_API_URL=https://terrenolabs-backend.vercel.app bunx vercel build --prod
```

Before the backend or web app builds, compile the workspace packages it imports (`bun run compile` at the root covers all of them).

### CI deploy script

`scripts/ci/vercel-deploy.sh` wraps the same steps:

```bash
scripts/ci/vercel-deploy.sh <backend|frontend|demo> <production|preview> [pr-number] [--plan]
```

It:

1. Validates `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_<TARGET>_PROJECT_ID`, and fails with the missing names.
2. Compiles the workspace packages the target needs.
3. Runs `vercel pull`, `vercel build`, and `vercel deploy --prebuilt` with a pinned CLI version. Frontend builds get `EXPO_PUBLIC_API_URL` set to the matching backend (production or that PR's alias).
4. For previews, adds the PR runtime variables (backend only) and aliases the deployment to `terrenolabs-<target>-pr-<N>.vercel.app`.
5. Probes `/health` (backend) or `/` (web) until it answers 2xx, for up to 5 minutes, and records a GitHub deployment.

`--plan` prints the host, probe URL, API URL, and runtime variables without deploying:

```bash
scripts/ci/vercel-deploy.sh frontend preview 1234 --plan
```

### CircleCI

The `vercel-deploy` job in `.circleci/continue-config.yml` runs beside the Netlify and Cloud Run jobs: production deploys on `master`, previews on PR branches. It needs the `terreno-vercel` context with:

| Variable | Value |
|---|---|
| `VERCEL_TOKEN` | Token from **Account Settings → Tokens**, scoped to the team |
| `VERCEL_ORG_ID` | Team ID (**Team Settings → General**, or `orgId` in `.vercel/project.json` after `vercel link`) |
| `VERCEL_BACKEND_PROJECT_ID` | `projectId` of `terreno-backend` |
| `VERCEL_FRONTEND_PROJECT_ID` | `projectId` of `terreno-frontend` |
| `VERCEL_DEMO_PROJECT_ID` | `projectId` of `terreno-demo` |

The job checks the context before checkout and fails with the list of missing variables. Fork PRs skip preview deploys.

## Verify the deployment

Run all four checks after the first deploy of each environment and after changing origins, URLs, or socket settings. For an all-in-one deploy, first confirm the backend answers:

```bash
curl -fsS https://terrenolabs-backend.vercel.app/health
```

Expect `"healthy":true`.

1. **The root URL loads the app.** Open `https://terrenolabs-frontend.vercel.app`. Expect the login screen. A blank white page means the bundle failed to load or crashed; check the console and that `outputDirectory` is `dist`.
2. **A deep link loads on refresh.** Open a route directly, such as `https://terrenolabs-frontend.vercel.app/admin/todos`, and reload. Expect the same screen, not Vercel's 404 page. A 404 means the fallback rewrite is missing from `vercel.json`.
3. **Login works.** Sign in. Success proves the bundle has the right backend URL and the backend allows this origin. In DevTools → Network, requests must go to the backend host, not `localhost:4000`. A CORS error in the console means the origin is missing from `CORS_ORIGINS` (or your `corsOrigin`) and `trustedOrigins`.
4. **The WebSocket connects.** In DevTools → Network, filter **WS**. Expect a request to `/socket.io/?EIO=4&transport=websocket` with status **101** and frames in its **Messages** tab. For an all-in-one deploy, also filter by `transport=polling` and confirm there are none. For more detail, set `WEBSOCKETS_DEBUG` to the string `"true"` in `app.json` `extra` (read by `rtk/src/constants.ts`), rebuild, and watch the console for connect and disconnect logs.

Do not skip check 4. A Terreno web app looks completely fine with no socket: screens render, login works, and REST calls succeed. What silently breaks is realtime sync of other users' changes and live feature flags.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank white page | Bundle failed to load, or the app crashed at startup | Check the console; confirm `outputDirectory: "dist"` and that the build ran `expo export` |
| Vercel 404 page when reloading a deep link | No fallback rewrite | Add `"rewrites": [{"source": "/(.*)", "destination": "/"}]` to the web `vercel.json` |
| Requests go to `http://localhost:4000` in production | `extra.BASE_URL` was not set when the bundle was built | Set `EXPO_PUBLIC_API_URL` for that Vercel environment and build with `bun run build:vercel` |
| `blocked by CORS policy: No 'Access-Control-Allow-Origin' header` | The web origin is not allowed | Add it to `CORS_ORIGINS` on the backend and redeploy the backend |
| Socket never connects, or `Session ID unknown` | Client still polls first, Fluid compute off, or the socket closed at max duration | Use `transports: ["websocket"]`, turn Fluid compute on, and confirm the client reconnects; see [Vercel Functions WebSockets](vercel-function-websockets.md) |
| Backend deploy serves source files as static files | `buildCommand` is `""` | Set `"buildCommand": "bun run build:vercel"` |
| Backend handler crashes with a Bun-only error, or the wrong file runs | Vercel ran the `build` script and picked `dist/` | Set `buildCommand` and `"outputDirectory": "dist-vercel"` |
| `require_authRecovery is not a function` | The backends builder inlined `@terreno/api` | Build locally with `vercel build` and deploy `--prebuilt` |
| `ERR_REQUIRE_ESM: require() of ES Module .../better-auth/dist/index.mjs` | Dependencies left external; Vercel's launcher refuses `require()` of ESM | Bundle dependencies (drop `--packages external`) |
| `ENOENT: no such file or directory, mkdir '/var/task/.terreno/logs'` | Bun inlined `NODE_ENV` as `development` | Build with `--define 'process.env.NODE_ENV="production"'` |
| `No entrypoint found which imports express` | The bundle inlined express, so no `import "express"` text remains | Keep the `--banner` marker in `build:vercel` |
| Production site calls a staging or PR backend | A preview build was promoted | Rebuild with `vercel build --prod` and deploy |

## Advanced: server output

Expo Router's `server` output builds `dist/client` (static files) and `dist/server` (API routes and server rendering) for a server runtime. The repository is on Expo SDK 57 (root `package.json` catalog: `expo ~57.0.14`), and `expo-server` is available from SDK 54, so this works today. Terreno does not use it: both web apps ship `static` output, and `@terreno/api` serves every API.

Per [Expo API routes](https://docs.expo.dev/router/web/api-routes), the Vercel setup is:

1. Set `"web": {"output": "server"}` in `app.json`.
2. Add `api/index.ts` using the Vercel adapter (`expo-server/adapter/vercel`, exported by `expo-server` 57):

   ```typescript
   const {createRequestHandler} = require("expo-server/adapter/vercel");

   module.exports = createRequestHandler({
     build: require("path").join(__dirname, "../dist/server"),
   });
   ```

3. Point `vercel.json` at the client output and route everything through the function:

   ```json
   {
     "buildCommand": "expo export -p web",
     "outputDirectory": "dist/client",
     "functions": {
       "api/index.ts": {
         "runtime": "@vercel/node@5.1.8",
         "includeFiles": "dist/server/**"
       }
     },
     "rewrites": [{"source": "/(.*)", "destination": "/api/index"}]
   }
   ```

Expo's page also shows an older form with `builds`, `routes`, and a `vercel-build` script set to `expo export -p web`. Use the form above; it is the current Vercel config schema.

**Streaming caveat.** Responses through the adapter may be buffered instead of streamed. That would break Server-Sent Events, which `@terreno/ai`'s `POST /gpt/prompt` uses to stream chat replies: the reply would arrive all at once at the end. Keep AI streaming on the `@terreno/api` backend and call it directly from the client, not through an Expo API route. Test streaming on a preview deployment before you route anything long-lived through server output.

This is a different thing from running `@terreno/api` on a Function. Server output runs Expo Router's own routes; it does not host Socket.IO or the Terreno backend.

## Related

- [Run Terreno WebSockets on Vercel Functions](vercel-function-websockets.md)
- [Deployment baseline](../explanation/deployment-baseline.md)
- [Build for web](build-for-web.md)
- [Deploy backend to Cloud Run](deploy-backend-to-cloud-run.md)
- [Configure Better Auth](configure-better-auth.md)
- [Environment variables](../reference/environment-variables.md)
- [CircleCI](circleci.md)
