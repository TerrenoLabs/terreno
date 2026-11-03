# Implementation Plan: Remove legacy RTK realtime in Terreno 58

**Status:** Approved  
**Roadmap:** Area=`api`, Target=`58`, Impact=`Breaking`  
**Branch:** `cursor/deprecate-realtime-for-58`  
**Owner:** unassigned  
**Created:** 2026-08-25  
**Target:** Terreno **58.0.0** (breaking)

## Goal

Delete the **legacy RTK cache-patching realtime path** in Terreno 58. Collection live updates go through `@terreno/syncdb` (`sync` on `modelRouter` + `sync:delta`). This IP does **not** remove `RealtimeApp`: that plugin still hosts Socket.io, change streams, and the syncdb socket channel.

The current minor ships deprecation warnings so apps can migrate before 58.

## Non-Goals

- Removing `RealtimeApp`, Socket.io, change streams, or `sync:delta`.
- Removing `admin.realtime` (admin `admin:model.changed` events).
- Removing `useSocketConnection` or feature-flag sockets.
- Unpublishing `@terreno/rtk` (separate RTK deprecation window).

## Decisions

| Question | Decision |
|----------|----------|
| What is “realtime” here? | `modelRouter` `realtime`, the `sync` event (not `sync:delta`), and `@terreno/rtk` `realtimeList` / `realtimeDocument` / `setRealtimeSocket` / `getRealtimeSocket`. |
| What stays? | `RealtimeApp`, `SyncApp`, `modelRouter.sync`, admin `realtime` boolean, socket auth, session revalidation. |
| When is it removed? | Terreno 58.0.0. Deprecation warnings ship on the 57.x line. |
| Replacement | `@terreno/syncdb` and [migrate-rtk-to-syncdb.md](../how-to/migrate-rtk-to-syncdb.md). |

## Architecture

Today a model can enable both `realtime` (RTK `sync` events + cache patching) and `sync` (`sync:delta` for syncdb). 58 keeps only the syncdb path.

`TerrenoApp({ realtime: true })` / `new RealtimeApp()` stay as the socket host. Do not treat those constructors as deprecated.

## Phases

1. **57.x (this slice):** JSDoc `@deprecated` + one-time runtime warnings; changelog; upgrade-note copy for the next 57.x release; task list for 58.
2. **58.0.0:** Delete the APIs, registry, client helpers, example wiring, and docs; keep `RealtimeApp` for sync.

## Files to Create / Modify

- `api/src/api.ts`, `api/src/realtime/types.ts`, `api/src/realtime/deprecation.ts` (57.x warnings)
- `rtk/src/realtime.ts` (57.x warnings)
- `docs/tasks/remove-legacy-realtime.md` (58 deletion checklist)
- 58: `api/src/realtime/registry.ts` consumers, change-stream legacy `sync` emit, `rtk/src/realtime.ts`, examples, skills

## Task List

[`docs/tasks/remove-legacy-realtime.md`](../tasks/remove-legacy-realtime.md)

## Acceptance Criteria

- [x] Using `modelRouter` `realtime` logs a one-time warning that names Terreno 58 and syncdb.
- [x] Using `realtimeList` / `realtimeDocument` / `setRealtimeSocket` logs a one-time warning that names Terreno 58 and syncdb.
- [x] Task list describes 58 deletion without removing `RealtimeApp`.
- [ ] Terreno 58 removes the deprecated APIs (later).
