---
category: Added
---

- Vercel hosting: `example-backend` runs on Vercel Functions (exported `http.Server` with Socket.IO, full Bun bundle), and `example-frontend` and `demo` deploy as static Expo exports. CircleCI deploys all three to the `terrenolabs` Vercel team alongside Cloud Run and Netlify. See `docs/how-to/deploy-to-vercel.md` and `docs/how-to/vercel-function-websockets.md`.
- `@terreno/rtk`: `useSocketConnection({transports})` chooses the Socket.IO transports (default unchanged: polling, then websocket). Use `["websocket"]` on hosts without session affinity, such as Vercel Functions.
- `@terreno/syncdb`: `createSyncDb({socketTransports})` does the same for the default socket transport.
- New `deploy-vercel` agent skill.
