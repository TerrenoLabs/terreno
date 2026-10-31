# Build for web

Export your Terreno Expo app as static files for hosting on GCS, Netlify, or any CDN.

See the [deployment baseline](../explanation/deployment-baseline.md) for requirements that apply to every host.

## Prerequisites

- Backend running and reachable from browsers (CORS configured).
- MongoDB replica set for realtime features (see baseline).

## 1. Set the API URL at build time

`EXPO_PUBLIC_API_URL` is **inlined into the JavaScript bundle** during export. Setting it on the hosting platform after deploy does nothing.

```bash
cd example-frontend
EXPO_PUBLIC_API_URL=https://api.example.com bun run export
```

The export script in `example-frontend/package.json` is:

```bash
bun expo export --platform web
```

### Alternative: `app.json` `extra.BASE_URL`

`@terreno/rtk` resolves the API base from `expo-constants` `extra.BASE_URL` and `EXPO_PUBLIC_API_URL` (see `rtk/src/constants.ts` `resolveBaseUrls`). Priority in **production** builds:

1. `EXPO_PUBLIC_API_URL` environment variable (set before export)
2. `extra.BASE_URL` in app config (when env var is unset)
3. Development fallbacks (hostUri, experience URL, localhost) — only in `__DEV__`

For production, prefer `EXPO_PUBLIC_API_URL` so CI and local builds behave the same.

## 2. Run the export

```bash
EXPO_PUBLIC_API_URL=https://api.example.com bun run export
```

Output lands in `dist/` (Expo default for web export). Contents depend on the configured web `output` mode — today Terreno apps use the `single` SPA mode (one `index.html`).

## 3. Verify locally before uploading

Serve the `dist/` folder with any static server and confirm API calls hit your backend:

```bash
npx serve dist -p 4173
```

Open `http://localhost:4173`, log in, and check the network tab — requests must go to your `EXPO_PUBLIC_API_URL`, not `localhost`.

## 4. Deploy the static files

Upload `dist/` to your host. **Client-side routing** requires the host to serve `index.html` for unknown paths (SPA fallback):

| Host | Configuration |
|------|---------------|
| GCS + CDN | `notFoundPage=index.html` on the bucket — see [Deploy web to GCS + CDN](deploy-web-to-gcs-cdn.md) |
| Netlify | `_redirects` or `netlify.toml` `/* /index.html 200` |

## Provider guides

- [Deploy to GCP](deploy-to-gcp.md) — GCS + Cloud CDN (static web) + Cloud Run (backend)
- Deployment baseline — [seven requirements](../explanation/deployment-baseline.md)

For server-rendered web (future), see [Web SSR and admin SPA](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/web-ssr-and-admin-spa.md).
