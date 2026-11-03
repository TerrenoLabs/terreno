---
category: Added
---

- `AdminSpaServeApp` options `internalOrigin` (where server renders fetch API data, default `http://127.0.0.1:${PORT ?? 4000}`) and `ssrApiPrefixes` (API paths a render may fetch). The plugin also serves Expo's root `/_expo/loaders/*`, with `Cache-Control: no-store, private` on pages and loader data.
- `@terreno/syncdb`: `SessionProvider` / session store `initialSession`, and the request client's `primeQuery(args, data)`, to start from data a server render already read.
- `@terreno/admin-frontend`: `AdminRpcSeed` and `adminRpcSeedKey` seed `useAdminRpcQuery` with server-fetched bodies; `buildAdminReadUrl`, `buildAdminListQueryParams`, `buildAdminApiListQueryRequest` and `homeWidgetUrls` build the exact URLs the screens request.
