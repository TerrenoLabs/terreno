# RTK deprecation announcement (draft)

**Do not post until maintainers review.** Target: GitHub Discussions → Announcements.

---

## `@terreno/rtk` data sync is deprecated — migrate to `@terreno/syncdb`

Starting with **56.0.0**, Terreno's default frontend data path is **local-first** via [`@terreno/syncdb`](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/syncdb.md). Collection reads and writes apply to an on-device store first; the server reconciles over the sync protocol. This replaces RTK Query hooks for CRUD lists and mutations.

### What changed

- **New:** `@terreno/syncdb` — `useQuery`, `useMutate`, offline outbox, conflict resolution, sync status UX
- **Deprecated:** RTK Query hooks for synced collections (`useGetTodosQuery`, `usePostTodosMutation`, manual optimistic updates)
- **Unchanged:** `bun run sdk` still generates the OpenAPI SDK for auth, profile, admin, AI, and other non-synced routes

### What you need to do

1. **By next major:** move collection screens from RTK Query to syncdb. `@terreno/rtk` will not publish in the next major line.
2. **Support window:** `@terreno/rtk` continues to publish with a deprecation notice through the **current major** (56.x beta and stable 0.x).
3. **Recommended order:** migrate to **Better Auth** first, then syncdb per screen ([migration guide](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/migrate-rtk-to-syncdb.md)).

### Why local-first

Instant UI, durable offline writes, and simpler screen code — at the cost of explicit conflict and sync-status handling. See [local-first data](https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/local-first-data.md).

### Questions

Open a thread in [Docs feedback](https://github.com/TerrenoLabs/terreno/discussions/categories/docs-feedback) or reply here.
