# Vercel deploy troubleshooting

Find the symptom the user sees, apply the fix, redeploy, and rerun the four verification checks. The human versions of these fixes are in `docs/how-to/deploy-to-vercel.md` and `docs/how-to/vercel-function-websockets.md`.

## Web app

### Blank white page after deploy

**Symptom:** The URL loads a white page with no UI. The console shows a 404 for a `/_expo/static/js/web/...js` bundle, or an uncaught error at startup.

**Cause:** Vercel is serving the wrong directory, the build never ran `expo export`, or the app crashed while starting (often from a missing `extra` value).

**Fix:** In the web `vercel.json`, set `"outputDirectory": "dist"` and a `buildCommand` that runs `expo export` (`bun run build:vercel` or `bun run export`). Set `"framework": null` so Vercel does not apply another preset. If a bundle loads and then throws, read the first console error; a missing API URL shows up as the localhost entry below.

### 404 when refreshing a deep link

**Symptom:** Navigating inside the app works, but reloading or opening a nested URL directly (for example `/admin/todos`) shows Vercel's `404: NOT_FOUND` page with `Code: NOT_FOUND`.

**Cause:** No fallback rewrite. Vercel has no file for a dynamic route, and nothing sends the request to the app shell.

**Fix:** Add the rewrite to the web `vercel.json`, keeping `cleanUrls`:

```json
"cleanUrls": true,
"rewrites": [{"source": "/(.*)", "destination": "/"}]
```

### Requests go to `localhost:4000` in production

**Symptom:** Login fails. DevTools shows requests such as `GET http://localhost:4000/api/auth/get-session net::ERR_CONNECTION_REFUSED` from the deployed site.

**Cause:** The bundle was built without a backend URL. `EXPO_PUBLIC_API_URL` was unset for that Vercel environment at build time, or the build did not write `extra.BASE_URL`. `@terreno/rtk` reads `extra.BASE_URL` in production because `EXPO_PUBLIC_*` values are not inlined into `node_modules`.

**Fix:** Set `EXPO_PUBLIC_API_URL` for the environment (`bunx vercel env add EXPO_PUBLIC_API_URL preview` or `production`), make `buildCommand` run a script that writes `extra.BASE_URL` (`example-frontend/scripts/vercelBuild.ts`), and rebuild. Changing the variable without rebuilding does nothing.

### Production calls a preview or staging backend

**Symptom:** The production domain works, but DevTools shows API requests going to a `-pr-<N>` or staging backend host.

**Cause:** A preview deployment was promoted to production. Promotion does not rebuild, so the preview's baked-in URL stays.

**Fix:** Build and deploy production fresh: `bunx vercel pull --yes --environment=production`, `bunx vercel build --prod`, `bunx vercel deploy --prebuilt --prod`.

### CORS error on login

**Symptom:** The browser console shows, verbatim apart from the hosts:

```text
Access to fetch at 'https://terrenolabs-backend.vercel.app/api/auth/sign-in/email' from origin 'https://terreno-frontend-a1b2c3d4e-terrenolabs.vercel.app' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Or the request reaches the backend and Better Auth answers `403` with `"Invalid origin"`.

**Cause:** The web origin is not in the backend's `corsOrigin` (CORS) or Better Auth `trustedOrigins` (`Invalid origin`). Every Vercel deployment has its own origin.

**Fix:** Stop and give the user the change; do not apply it yourself. For `example-backend`, add the origin or a pattern to `CORS_ORIGINS` (comma-separated, `*` allowed, for example `https://<web-project>-*-<team>.vercel.app`); it feeds both `corsOrigin` and `trustedOrigins`. Other backends need the origin in both settings. Never suggest `corsOrigin: true`. Redeploy the backend after the change.

## Sockets

### WebSocket fails while the rest of the app works

**Symptom:** Login and screens work, but DevTools → Network → **WS** shows no `101`, or repeated `transport=polling` requests failing with `400` and `{"code":1,"message":"Session ID unknown"}`. Other users' changes and feature-flag flips never appear without a reload.

**Cause, in order of likelihood:**

1. The client still uses the default `["polling", "websocket"]` transports against a backend on Vercel Functions, so polling requests land on different instances.
2. Fluid compute is off on the backend project. Vercel requires it for WebSockets.
3. The socket closed at the Function max duration (300s by default) and the client did not reconnect.
4. The backend exports the Express app instead of the `http.Server`, so `/socket.io/` returns 404.

**Fix:** (1) Pass `transports: ["websocket"]` to `useSocketConnection` and `socketTransports: ["websocket"]` to `createSyncDb`, then rebuild the web app. (2) Ask the user to turn on **Settings → Functions → Fluid Compute** and redeploy the backend. (3) Confirm a new `101` appears after a close; raise **Function Max Duration**. (4) `export default server` from the Vercel entry. Details: `docs/how-to/vercel-function-websockets.md`.

### Socket connects to a `ws.` host that does not exist

**Symptom:** The WS request goes to `wss://ws.example.com/socket.io/...` and fails DNS, while the API is `https://api.example.com`.

**Cause:** The app passes `baseWebsocketsUrl` from `@terreno/rtk`, which rewrites `api.` to `ws.` for split socket hosts. On Vercel the API host serves the sockets.

**Fix:** Pass `baseUrl` to `useSocketConnection` instead of `baseWebsocketsUrl`.

## Backend on Vercel Functions

### Backend deploy serves source files

**Symptom:** `https://<backend-host>/health` returns 404, while paths such as `/package.json` or `/src/server.ts` download as files.

**Cause:** `vercel.json` has `"buildCommand": ""`, so Vercel published the directory as static files.

**Fix:** Set `"buildCommand": "bun run build:vercel"` and `"outputDirectory": "dist-vercel"`.

### Wrong handler runs, or Bun-only APIs crash on Node

**Symptom:** Function logs show errors from `dist/index.js`, or Bun-only globals are undefined, although the entry is `src/app.ts`.

**Cause:** With no `buildCommand`, Vercel ran the package's `build` script, which writes a Bun-target bundle to `dist/`, and served that. Functions run Node (`nodejs24.x`), not Bun.

**Fix:** Set `"buildCommand": "bun run build:vercel"` (see `build:vercel` in `example-backend/package.json`) and `"outputDirectory": "dist-vercel"`.

### `require_authRecovery is not a function`

**Symptom:** The function crashes at startup with `TypeError: require_authRecovery is not a function` (or a similar `require_<name>` error).

**Cause:** Vercel's newer backends builder (`VERCEL_EXPERIMENTAL_BACKENDS=1`, which remote builds may use) inlined workspace-linked packages such as `@terreno/api`, whose real path is outside `node_modules`, and hit a circular CommonJS require.

**Fix:** Build locally and deploy the output: `bunx vercel build` then `bunx vercel deploy --prebuilt`.

### `ERR_REQUIRE_ESM` at startup

**Symptom:** Function logs show `Error [ERR_REQUIRE_ESM]: require() of ES Module /var/task/node_modules/better-auth/dist/index.mjs from /var/task/api/dist/betterAuthSetup.js not supported`, and every request returns 500. The same build boots fine with a local `node`.

**Cause:** Dependencies were left external (`--packages external`). Vercel's Node launcher refuses `require()` of an ES module, and `@terreno/api`'s CommonJS build requires ESM-only packages.

**Fix:** Bundle dependencies: drop `--packages external` from `build:vercel`. Reproduce locally with `node --no-experimental-require-module`.

### `mkdir '/var/task/.terreno/logs'` fails

**Symptom:** `Error: ENOENT: no such file or directory, mkdir '/var/task/.terreno/logs'` at startup.

**Cause:** Bun inlined `process.env.NODE_ENV` as `"development"` at bundle time, so dev-only code (the JSONL log file) runs on Vercel's read-only filesystem.

**Fix:** Build with `--define 'process.env.NODE_ENV="production"'`.

### `No entrypoint found which imports express`

**Symptom:** `vercel build` fails with `No entrypoint found which imports express. Found possible entrypoint: app.js`.

**Cause:** Vercel's Express preset scans the entry's text for an express import, and a full bundle inlines express.

**Fix:** Keep the `--banner` comment in `build:vercel` that contains `import "express"`.

### Vercel picks the Cloud Run entry

**Symptom:** The function tries to bind `PORT` or starts the jobs worker, and requests time out.

**Cause:** Vercel's Express preset serves the first of `app`, `index`, `server` (root, then `src/`) whose source imports `express`. Without `src/app.ts`, it picks `src/index.ts`.

**Fix:** Add `src/app.ts` that imports `express` (types are enough) and exports the `http.Server` from `createVercelServer()`.

### Function cannot reach MongoDB

**Symptom:** `/health` returns `"healthy":false` with `"database":"disconnected"`, or logs show `MongoServerSelectionError` timeouts.

**Cause:** Atlas network access does not allow Vercel. Vercel has no static egress IPs without Secure Compute or Static IPs.

**Fix:** Ask the user to allow Vercel in Atlas network access, or to buy static egress and allow those IPs. Do not change Atlas settings yourself.

## Server output (advanced)

### Streaming replies arrive all at once

**Symptom:** With `web.output: "server"`, AI chat replies from `/gpt/prompt` appear in one piece after a long pause instead of streaming token by token.

**Cause:** Responses through `expo-server/adapter/vercel` may be buffered, which defeats Server-Sent Events.

**Fix:** Keep `@terreno/ai` streaming on the `@terreno/api` backend and call it directly from the client. Do not proxy `/gpt/prompt` through an Expo API route.
