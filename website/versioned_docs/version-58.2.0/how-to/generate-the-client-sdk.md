# Generate the client SDK

Run this after any backend change to routes, models, permissions, or OpenAPI docs. The
backend must serve `/openapi.json` (Terreno `TerrenoApp` / `setupServer` does).

1. Start the backend: `bun run backend:dev` (port 4000).
2. Generate both SDK files from the app's frontend package:

```bash
bunx terreno-syncdb-codegen \
  --schema http://localhost:4000/openapi.json \
  --out ./store/syncDbSdk.ts \
  --api-out ./store/apiSdk.ts \
  --config ./syncdb-codegen.json
```

3. Commit both generated files. Never edit them by hand.

| File | Holds | Use for |
|------|-------|---------|
| `store/syncDbSdk.ts` | Collection hooks + `SYNC_COLLECTIONS` | Synced collections (`useTodos`, `useCreateTodo`) |
| `store/apiSdk.ts` | Typed query/mutation hooks + request builders | Every other route (`useGetAuthMeQuery`, `usePostAuthForgotPasswordMutation`) |

A route missing from `apiSdk.ts` is missing from the OpenAPI spec. Document it in the
backend (modelRouter actions are documented automatically; hand-written routes use
`createOpenApiBuilder`) and regenerate. To leave routes out, add `excludePaths` to
`syncdb-codegen.json`:

```json
{"excludePaths": ["/admin/", "^/internal/"]}
```

Reference: [`@terreno/syncdb` codegen](../reference/syncdb.md#codegen).
