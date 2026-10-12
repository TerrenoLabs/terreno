---
name: deploy-vercel
description: 'Deploy a Terreno Expo Router web app to Vercel, and optionally its @terreno/api backend to Vercel Functions: detect the app''s output mode and existing vercel.json, configure the build, set EXPO_PUBLIC_API_URL per Vercel environment, hand the user the backend CORS and Better Auth origin changes, deploy a preview, gate production on explicit confirmation, and verify the root URL, deep links, login, and the WebSocket. Use when asked to "deploy to Vercel", "deploy the web app", "put this online", "ship a preview to Vercel", or to debug a broken Vercel deploy. Not for native builds (EAS) or Cloud Run.'
---
# Deploy to Vercel

Get a Terreno app onto Vercel and prove it works, including the realtime socket. The human guide is `docs/how-to/deploy-to-vercel.md`; socket details for a backend on Functions are in `docs/how-to/vercel-function-websockets.md`. Every command below also appears in the guide. Do not run commands that are not in the guide.

## Rules

- **Never deploy to production without explicit confirmation in this conversation.** Ask after the preview passes verification. "Deploy it" at the start of the session does not count as approval for production.
- **Never set `corsOrigin: true` or `"*"`.** With Better Auth's credentialed requests, reflecting every origin lets any website call the API as the signed-in user. Allow exact origins, or a narrow wildcard pattern.
- **Stop before backend origin changes.** Print the exact `CORS_ORIGINS` / `corsOrigin` and `trustedOrigins` changes and wait until the user says they are applied. A deployed backend's config is theirs to change.
- **Never set `"buildCommand": ""`** in a backend `vercel.json`. Vercel then serves the source tree as static files.
- Do not commit `.vercel/`. It holds project and org IDs and pulled environment values.
- "Vercel" in `@terreno/ai` means the Vercel AI SDK, a model library. It has nothing to do with this skill.

## When to use

- A Terreno Expo Router app needs a public web URL on Vercel.
- The user wants the backend on Vercel too (all-in-one topology). Confirm they accept the trade-offs first: no in-process jobs worker, no GCS uploads through a service account, sockets that close at the Function max duration, and Function billing while sockets are open. If any of those is a blocker, keep the backend on Cloud Run (`docs/how-to/deploy-backend-to-cloud-run.md`) and deploy only the web app.

Not for: native app distribution (EAS), Cloud Run, or the Vercel AI SDK.

## 1. Detect

Read, do not change, these first:

1. **Expo Router app?** `expo-router` in the app's `package.json` and an `app/` directory.
2. **Output mode:** `expo.web.output` in `app.json` (`single`, `static`, or `server`). `static` and `single` use the static `vercel.json`. `server` is the advanced path in the guide's "Advanced: server output" section.
3. **Existing `vercel.json`** in the app directory. If present, compare it with the guide and change only what differs.
4. **Backend URL.** Where does the API run? Get the exact `https://` origin from the user, or plan to deploy the backend first (step 4).
5. **Socket clients.** Find `useSocketConnection(` and `createSyncDb(` calls and note whether they pass `transports` / `socketTransports`.

## 2. Configure the web app

1. Create one Vercel project per app with **Root Directory** set to the app folder, and link the checkout from the repository root:

   ```bash
   bunx vercel link --project <web-project>
   ```

2. Write `vercel.json` for static output, as in the guide's "Web app on Vercel" section: `framework: null`, `outputDirectory: "dist"`, `cleanUrls: true`, and the fallback rewrite `{"source": "/(.*)", "destination": "/"}`. Without the rewrite, deep links 404 on refresh.
3. Make the build set `extra.BASE_URL` from `EXPO_PUBLIC_API_URL` before `expo export`. `@terreno/rtk` reads `extra.BASE_URL` in production because `EXPO_PUBLIC_*` values are not inlined into `node_modules`. Copy `example-frontend/scripts/vercelBuild.ts` and its `build:vercel` script (`bun run build:vercel`), and point `buildCommand` at it.
4. If the backend will run on Vercel Functions, the socket clients must use WebSocket only: `useSocketConnection({transports: ["websocket"]})` and `createSyncDb({socketTransports: ["websocket"]})`. `example-frontend` does this through `extra.SOCKET_TRANSPORTS`.

## 3. Set the backend URL per environment

Set `EXPO_PUBLIC_API_URL` on the web project for each Vercel environment:

```bash
bunx vercel env add EXPO_PUBLIC_API_URL production
bunx vercel env add EXPO_PUBLIC_API_URL preview
```

Tell the user: the URL is baked in at build time, so promoting a preview deployment to production keeps the preview backend. Production must come from a production build.

## 4. Backend on Vercel Functions (only if chosen)

Follow the guide's "Backend on Vercel Functions" section:

1. Add a Vercel entry (`src/app.ts`) that imports `express` types, creates an `http.Server`, passes it to `TerrenoApp` as `httpServer`, waits for `whenReady()`, and does `export default server`. Export the server, not the Express app, or `/socket.io/` is never mounted.
2. Write `vercel.json` with `framework: "express"`, `buildCommand: "bun run build:vercel"`, and `outputDirectory: "dist-vercel"`, where `build:vercel` is the full-bundle script from the guide (dependencies bundled, `NODE_ENV` defined as production, express banner).
3. Ask the user to confirm Fluid compute is on (**Settings → Functions → Fluid Compute**) and to raise **Function Max Duration** as far as their plan allows.
4. List the environment variables from the guide (`MONGO_URI`, `AUTH_PROVIDER`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGINS`, `CROSS_DOMAIN_AUTH_COOKIES`, `NODE_ENV`, `JOBS_START_WORKER=false`) for the user to set. Do not ask them to paste secrets into the conversation.
5. Remind them that MongoDB Atlas must accept connections from Vercel's dynamic IPs.

## 5. Hand over the origin changes, then stop

Print exactly what the backend must allow, for example:

```text
CORS_ORIGINS=https://<web-project>.vercel.app,https://<web-project>-*-<team>.vercel.app
```

For a backend that is not `example-backend`, show the equivalent `corsOrigin` array (strings and `RegExp`s) and the `trustedOrigins` entries, including the native deep-link schemes the app already uses. Point out that:

- the wildcard trusts every matching name on the shared `vercel.app` namespace, so a custom preview domain is safer;
- OAuth providers need each redirect URI registered exactly, so social sign-in works only on fixed origins.

**Stop here** until the user confirms the backend change is deployed. Do not edit a deployed backend's environment yourself.

## 6. Deploy a preview

Compile workspace packages the app imports (`bun run compile`), then from the repository root:

```bash
bunx vercel pull --yes --environment=preview
bunx vercel build
bunx vercel deploy --prebuilt
```

For a backend project, check it before the web app:

```bash
curl -fsS https://<backend-host>/health
```

Expect `"healthy":true`. In the Terreno monorepo, CI deploys with `scripts/ci/vercel-deploy.sh`; check what it would do without deploying:

```bash
scripts/ci/vercel-deploy.sh frontend preview <pr-number> --plan
```

## 7. Verify

Run all four checks on the preview URL and report each result to the user:

1. **Root URL loads** the app (login screen). Blank page: see the troubleshooting reference.
2. **Deep link on refresh** (a nested route, for example `/admin/todos`) loads the same screen, not a Vercel 404.
3. **Login works.** Network requests go to the backend host, not `localhost:4000`, with no CORS error in the console.
4. **WebSocket connects.** DevTools → Network → **WS** shows `/socket.io/?EIO=4&transport=websocket` with status **101** and frames flowing. With the backend on Functions, there must be no `transport=polling` requests. For detail, set `WEBSOCKETS_DEBUG` to `"true"` in `app.json` `extra` and rebuild.

Do not mark the deploy done without check 4. The app looks fine with no socket while realtime sync and live feature flags are broken.

## 8. Production (after confirmation)

Ask: "The preview passed all four checks. Deploy to production now?" Continue only on an explicit yes. Then build fresh for production; do not promote the preview:

```bash
bunx vercel pull --yes --environment=production
bunx vercel build --prod
bunx vercel deploy --prebuilt --prod
```

Repeat the four checks on the production URL.

## Troubleshooting

Match the literal symptom in [references/troubleshooting.md](references/troubleshooting.md) and apply that fix. If nothing matches, read `docs/how-to/deploy-to-vercel.md#troubleshooting` and `docs/how-to/vercel-function-websockets.md` before guessing.

## Done when

- The preview passed all four checks, with the WebSocket check reported explicitly.
- The user confirmed the backend origin changes were applied.
- Production was deployed only after explicit confirmation, from a production build, and passed the same four checks.
