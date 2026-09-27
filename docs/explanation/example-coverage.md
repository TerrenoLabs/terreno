# Example app coverage

The `example-backend` and `example-frontend` apps are the living checklist for
framework capabilities. When you add a capability to `@terreno/*`, update this
matrix in the same slice.

Citations are paths from the repository root. A "yes" means a reader can follow
that file (and its imports) to a working example. Gaps stay explicit.

## Capability matrix

| Capability | example-backend | example-frontend | Notes |
| --- | --- | --- | --- |
| `modelRouter` CRUD | yes — `example-backend/src/api/todos.ts` | yes — `example-frontend/components/SyncTodosScreen.tsx` (syncdb hooks generated from the same collection) | Todos are synced; list/create/update/delete go through `@terreno/syncdb`, not RTK collection hooks. |
| Owner permissions | yes — `OwnerQueryFilter` + `Permissions.IsOwner` in `example-backend/src/api/todos.ts` | yes — the todos screen only shows the signed-in user's rows after sync scopes apply | Also gated by RBAC `access: {resource: "todo"}`. |
| Admin panel (embedded) | yes — Admin plugin registration in `example-backend/src/server.ts` | yes — `example-frontend/app/admin/` | Expo routes wrap `@terreno/admin-frontend` screens. |
| Admin SPA | yes — `AdminSpaServeApp` in `example-backend/src/server.ts` | n/a | Standalone SPA is served from the backend; not a frontend route. |
| AI streaming chat | yes — `example-backend/src/api/ai.ts` (`addGptRoutes`) | yes — `example-frontend/app/(tabs)/ai.tsx` (`GPTChat`, optional `mascot`) | Empty-chat mascot is consumer-owned; the example fox is not a framework default. |
| Agent asks | yes — `asks: true` in `example-backend/src/api/ai.ts`, which also passes `chat` to `addGptHistoryRoutes` for the headless `pendingAsks` and `turn` endpoints; keyless scripted agent with short compact-surface replies in `example-backend/src/api/demoAgent.ts` | yes — `example-frontend/app/(tabs)/ai.tsx` (`onAskSubmit`, `askErrors`), helpers in `example-frontend/lib/gptAsks.ts` | Without `GEMINI_API_KEY`, "Help me pick a plan" asks a `choice` in chat, "Pick toppings" asks a `select: "many"` `choice` with an Other field, "Send the weekly report" and "Archive old chats" ask a `confirm` (the second `destructive`), and "Draft an announcement" asks a `markdown` edit of a draft. e2e: `example-frontend/e2e/ai-chat.spec.ts`. Small clients: the curl walkthrough in the how-to and the demo's watch-sized `SimpleAskCard` story. Steps: [agent-ui-asks.md](../how-to/agent-ui-asks.md). |
| AI structured output | no | no | `@terreno/ai` supports structured generation; the example only streams chat. Recorded gap — not claimed by a current tutorial. |
| Feature flags + live updates | yes — `FeatureFlagsApp` in `example-backend/src/server.ts`, seed `example-backend/src/scripts/seed-feature-flags.ts` | yes — `useTerrenoFeatureFlags` in `example-frontend/app/_layout.tsx` | Socket-backed live updates share the realtime connection. |
| Websockets / realtime | yes — `RealtimeApp` in `example-backend/src/server.ts`, `example-backend/src/websockets.ts` | yes — `useSocketConnection` in `example-frontend/app/_layout.tsx` | Sync deltas also use the socket (`SyncApp` + `@terreno/syncdb`). |
| Consent forms | yes — `example-backend/src/consentDefinitions.ts`, seed scripts | yes — `example-frontend/app/(tabs)/consents.tsx`, admin `example-frontend/app/admin/consent-forms/` | First-login flow is covered by e2e (`example-frontend/e2e/consents.spec.ts`). |
| File upload / GCS | yes — `example-backend/src/api/settings.ts`, AI file routes in `example-backend/src/api/ai.ts` | yes — `example-frontend/app/(tabs)/files.tsx`, `example-frontend/app/gcs-settings.tsx` | |
| Better Auth | yes — `example-backend/src/utils/betterAuthConfig.ts`, `BetterAuthApp` in `example-backend/src/server.ts` | yes — `example-frontend/app/login.tsx`, `example-frontend/lib/betterAuth.ts` | Default `AUTH_PROVIDER` is `better-auth`. |
| syncdb local-first | yes — `SyncApp` in `example-backend/src/server.ts` | yes — `example-frontend/store/syncdb.ts`, `example-frontend/app/(tabs)/index.tsx` | PR #869 closed without merge; `@terreno/syncdb` shipped on the launch line and is the example todos path. |
| SyncDB diagnostics | n/a | yes — `debug` registration in `example-frontend/store/syncdb.ts`, debugger UI at `example-frontend/app/syncdb-debug.tsx` | `terreno-mcp-local` can inspect, snapshot/compare/merge, mutate, flush, reconcile/resync, and exercise offline/conflict paths against the running development client. |
| RBAC | yes — `example-backend/src/rbacRoles.ts`, `access.ts`, `access: {resource: "todo"}` on the todo router | yes — `example-frontend/app/admin/roles.tsx` | Shipped. The IP snapshot that marked RBAC "not shipped" is stale. Plan: [rbac-permissions.md](../implementationPlans/rbac-permissions.md). |
| Organizations | yes — `createAccess({organizations: true})`, `organizationSettingsSchema`, `orgScopedPlugin` on projects | yes — admin org directory/settings at `example-frontend/app/admin/orgs/` | Settings live on `Organization.settings`; example registers a nested timezone schema. |
| Background jobs | no | no | No generic job queue example. Admin maintenance scripts (`example-backend/src/adminScripts.ts`, script runner widget) are a related but different surface. Plan: [admin-script-runner.md](../implementationPlans/admin-script-runner.md). |

## Gaps

| Gap | Why it stays | Follow-up |
| --- | --- | --- |
| AI structured output | Chat streaming already demonstrates the AI pillar; structured `generateObject`-style routes are unused by current tutorials | Track with [AI-first tutorials #1010](https://github.com/TerrenoLabs/terreno/issues/1010) (`add-ai-features.md` requires one structured-output call). |
| Generic background jobs | Unshipped as a first-class example; do not invent a queue UI here | Track with [Durable background jobs #1188](https://github.com/TerrenoLabs/terreno/issues/1188). Admin script runner is a related surface — [admin-script-runner.md](../implementationPlans/admin-script-runner.md). |

## Keeping the matrix true

When you add a framework capability:

1. Exercise it in `example-backend` and/or `example-frontend`.
2. Update this page (cite the file).
3. Mention the example in the PR.
