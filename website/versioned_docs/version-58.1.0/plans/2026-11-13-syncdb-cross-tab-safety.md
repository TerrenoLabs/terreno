# Stop two browser tabs from losing each other's offline writes

On the web, `@terreno/syncdb` keeps the whole local store, including the queue of writes waiting to reach the server, as one encrypted record in IndexedDB. Every open tab holds its own copy in memory and saves the whole record. Nothing coordinates the tabs, so the tab that saves last wins, and a write queued in another tab can vanish from disk. A write made less than half a second before a tab closes can also miss its save. The audit reported this as suspected data loss and did not reproduce it. This plan first proves the loss with failing tests, then makes saves merge instead of overwrite, and makes a best-effort flush when a tab is hidden. Anyone who uses a Terreno web app in two tabs while offline is affected; nobody else sees a change.

Source: codebase audit `docs/audits/2026-11-12/REPORT.md` findings 4.7 and 3.14 (detail in `code-refactoring.md` 9 and `security-performance.md` 9). The server-side findings of the same group are planned in `docs/plans/2026-11-13-sync-and-query-performance.md`.

## The idea

The store is a TinyBase `MergeableStore`: every cell carries a timestamp, and two copies can be merged without losing either side's changes. Today the web persister ignores that and writes its own copy over whatever is on disk (`syncdb/src/persisters/encryptedIndexedDbPersister.ts`, "Nothing mutates the blob outside this persister").

After this plan a save does this, inside a Web Lock named for the database: read a small write token stored beside the record (a random id, replaced on every write); if it is not the one this tab last read or wrote, another tab has written, so read and decrypt the record and merge it into memory; write the merged record and a fresh token. Two tabs can no longer erase each other, and a tab that is alone pays one extra tiny read per save. The persister also flushes when the page is hidden. That narrows the half-second window but cannot close it: the flush is asynchronous and a browser may kill the page first.

The encrypted record keeps its format. The write token is a new sibling record, so an older build still reads the data and a rollback is safe.

Rejected: electing one leader tab that owns persistence and relays other tabs' writes. When the leader closes, the next leader still has to merge what is on disk with what it holds, so the merge is needed anyway and the relay is extra machinery.

Per-partition persistence (audit 3.14: stop rewriting the whole store on every save) is not in this plan, and that is the one decision here the owner should make (Q1). It is weeks of work with an on-device storage migration on web and native, and no measurement yet says how large real stores get. It is listed as Expansion X1 with a suggested IP slug. This plan ships the audit's short-term advice for 3.14: a warning when the store gets large, a documented ceiling, and `saveDebounceMs` on `createSyncDb`.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Reproduce the cross-tab loss with expected-fail tests | none | syncdb persister test, example-frontend e2e | A unit test and a two-tab browser test that fail today for the stated reason, committed as expected failures |
| T2 | Merge before write, under a lock, with a write token | T1 | syncdb web persister, idb helper, wipe | T1's unit test passes without the expected-fail marker; owner-mismatch, wipe and no-lock cases |
| T6 | Keep the outbox send order correct after a merge | T2 | syncdb outbox, replay coordinator | After merging another tab's queue, the next queued write is ordered after every existing one; equal orders send in a fixed order |
| T3 | Flush when the page is hidden (best effort) | T2 | syncdb web persister | A write queued 10 ms before `visibilitychange: hidden` is on disk without waiting for the debounce |
| T4 | Two-tab browser proof and documentation | T2, T3, T6 | example-frontend e2e, docs | T1's browser test passes without the expected-fail marker; server holds exactly one copy of each todo |
| T5 | Warn when the persisted store is large; `saveDebounceMs` on `createSyncDb` | T3, T4 | syncdb web persister, client config, docs | One `console.warn` when a save exceeds 5 MB; the configured debounce reaches the persister |

Tracer: `createEncryptedIndexedDbPersister` — two persisters over one shared storage map is the smallest setup that shows the loss and the fix.
Gate: if T1 cannot make either test fail, the finding is disproved. Stop with `BLOCKED`, report what was tried, and do not build T2–T4.
E2E: 1 spec (browser), `example-frontend/e2e/syncdb-cross-tab.spec.ts`. The page-hide flush has no browser spec: see `## E2E tests`.
Regression: None — no hard-to-automate change; two tabs in one browser are driven by Playwright.
User guide: None — no new screen, label or step. One thing looks different: after a tab saves, it shows todos and a queued count that include another tab's offline writes. The Todos guide pages describe one tab and stay correct.
Design: None — no canvas.
Out of scope: per-partition persistence, live cross-tab view, one-tab-drains lock, native storage (see Expansions).
Open risks: after a merge a tab holds queued writes it did not create, some possibly marked in flight by a tab that has since closed (T6 states and tests what happens); merging is by cell timestamp, so correctness leans on TinyBase's merge and on tab clocks (same device, so one clock); a tab left open on an old build writes without replacing the write token (Assumption A4); a stale tab still signed in as a previous user can still overwrite the new user's record, as today (Q4).
Elephant: merging makes it possible, for the first time, for one tab's local data to flow into another tab's store — if two tabs are ever signed in as different users with a shared device key, that would mix two people's records; T2 forbids the merge unless the stored user matches, and that guard is the part of this plan that must not be wrong.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `example-frontend/e2e/syncdb-cross-tab.spec.ts` | browser | Two tabs of one signed-in browser each queue a todo offline; after the first tab closes and the second reloads, both todos are shown and queued; after reconnect the server lists each title exactly once | T1 (expected-fail), T4 (passing) |

T3's page-hide flush has no browser row. Whether an asynchronous IndexedDB write finishes while a real tab closes is up to the browser, so a spec that closes a page at once would be flaky by design. T3 is proven at the persister seam with an injected event target, and the plan claims best effort only.

## Regression cases

None — no hard-to-automate change. Two tabs sharing IndexedDB are two pages of one Playwright browser context, which E1 drives.

## User guide

None — no new screen, label or step, so no page needs a row. One thing a user can notice: after a tab saves, its list and its queued count include writes made offline in another tab, where before they could silently disappear. The existing Todos pages describe a single tab and remain accurate.

## Design

None — no canvas.

## Tasks

Supporting skills: `terreno:terreno-frontend-tests`, `terreno:terreno-data-fetching`, `terreno:update-docs`; `terreno:debug-syncdb-with-mcp` when a browser run misbehaves. Unit commands run from `syncdb/` (`bun test --only-failures <path>`). The browser spec runs with `bun run --cwd example-frontend test:e2e syncdb-cross-tab.spec.ts` and needs the replica-set MongoDB described in `docs/how-to/run-tests-locally.md`.

- [ ] **T1** — Reproduce the cross-tab loss with expected-fail tests
  - Depends on: none
  - Files: syncdb/src/persisters/crossTab.test.ts, example-frontend/e2e/syncdb-cross-tab.spec.ts, example-frontend/e2e/helpers/syncdbSuite.ts, example-frontend/e2e/fixtures/testUsers.ts
  - Criteria:
    - A unit test builds two syncdb stores with the real table schema (the store factory in `syncdb/src/storage/store.ts`, collections `["todos"]`; use `store.raw` for TinyBase calls), each with its own `createEncryptedIndexedDbPersister`, sharing one in-memory storage map through the `idbGetImpl` / `idbSetImpl` overrides and one codec, with `saveDebounceMs: 0`. It asserts that a row written by the first store survives a later save by the second. It is committed with Bun's `test.failing` and a comment naming this IP, so the suite stays green while the bug exists.
    - A browser spec opens a second page in the same browser context (`page.context().newPage()`, not `openSecondSession`, which creates a separate context with separate IndexedDB), runs the sequence in E1, and is committed with Playwright's `test.fail()`.
    - Each test is shown to fail on the missing row or todo, not on setup. The failing assertion message is quoted in the stage result.
    - If the unit test passes without `test.failing`, or the browser assertion passes, stop: emit `BLOCKED` with the evidence. Do not weaken the scenario to force a failure.
  - Seam: `createEncryptedIndexedDbPersister` (exported factory); the example app's sync Todos screen in Chromium.
  - Interface: unit — `createEncryptedIndexedDbPersister({store, databaseName: "t", codec, saveDebounceMs: 0, idbGetImpl, idbSetImpl})` then TinyBase `persister.load()` / `persister.save()`. Browser — test ids `todos-title-input`, `todos-create-button`, `sync-queued-count`, `todo-item-{id}`; helpers `installOfflineControl`, `goSyncOffline`, `goSyncOnline`, `openSyncTodos`, `todoItemByTitle` from `example-frontend/e2e/helpers/syncdbSuite.ts`; a new helper `openSecondTab(page)` there; a new dedicated user `SYNCDB_CROSS_TAB_USER` in `fixtures/testUsers.ts`.
  - Cases:
    - Unit: A and B both `load()` from the empty shared map. A writes an outbox row `m1` with `status: "queued"` into the outbox table (`OUTBOX_TABLE` from `syncdb/src/storage/types.ts`, every schema cell set) and `save()`s. B writes an entity row `t2` into the `todos` table and `save()`s. A fresh store C `load()`s → expected outbox row `m1` has `status === "queued"` and `todos` row `t2` exists. Today C has no outbox row `m1`.
    - Unit (control, must pass today, no marker): only A writes and saves; C loads → outbox row `m1` present.
    - Browser: sign in, open Sync Todos in tab 1 and tab 2, wait for the sentinel todo in both, go offline in both. Tab 1 creates "Tab one offline"; wait until its `sync-queued-count` shows 1 and the IndexedDB record has been rewritten (`readSyncDbBlobLength` changes). Tab 2 creates "Tab two offline"; wait the same way. Close tab 1. Reload tab 2 (still offline). Expected: both titles visible in tab 2 and `sync-queued-count` contains 2. Today one of the two titles is missing (which one depends on which tab saved last).
  - Blast radius: none (tests only). The new user keeps the spec independent of the other `syncdb-*.spec.ts` files.
  - Test skills: terreno-frontend-tests
  - Verification: `cd syncdb && bun test src/persisters/crossTab.test.ts` (reports the expected failure as passing); `bun run --cwd example-frontend test:e2e syncdb-cross-tab.spec.ts` (expected failure). Temporarily removing each marker shows the real failure; restore before commit.

- [ ] **T2** — Merge before write, under a lock, with a write token
  - Depends on: T1
  - Files: syncdb/src/persisters/encryptedIndexedDbPersister.ts, syncdb/src/persisters/crossTabLock.ts, syncdb/src/storage/idb.ts, syncdb/src/storage/wipe.ts, syncdb/src/persisters/defaultPersisterFactory.web.ts, syncdb/src/persisters/types.ts, syncdb/src/persisters/crossTab.test.ts, syncdb/src/persisters/encryptedIndexedDbPersister.test.ts, changelog/unreleased/syncdb-cross-tab-merge.md
  - Criteria:
    - Every write to IndexedDB runs inside `navigator.locks.request("terreno-syncdb:" + databaseName, …)`. Where `navigator.locks` is missing (older browsers, tests, SSR) the same steps run without a lock.
    - A new record under the key `"writeToken"` in the same object store holds a random string (`crypto.randomUUID()`), replaced on every write. It is a random id, not a counter, so it cannot repeat after the database is deleted and recreated. The persister remembers the token it last loaded or wrote; a missing record is remembered as `undefined`.
    - Inside the lock: read the token. If it differs from the remembered one, read and decrypt the content record and merge it into the in-memory store with TinyBase's CRDT merge (never `setMergeableContent`, which replaces). Then serialize the store, encrypt, and write the content record and a fresh token in one IndexedDB transaction (a new `idbSetMany` helper in `syncdb/src/storage/idb.ts`). Remember the new token.
    - Owner guard. The factory passes `getOwnerUserId: () => string | undefined`, which returns the user id recorded in the in-memory store (set by `store.setLastUserId`). Before merging, the persister reads the same value from the decrypted disk content. The merge happens only when both ids are equal, or both are absent. One side absent and the other present is a mismatch. On a mismatch, or when the disk record cannot be decrypted, the merge is skipped and the write proceeds as it does today. When `getOwnerUserId` is not passed, the persister never merges (today's behaviour). Data from another user is never merged.
    - A merge leaves no ghost rows: a row deleted in one tab (an acked outbox row) is absent after the merge, not present with empty cells. `syncdb/src/storage/schema.ts` documents this hazard for tombstones that pass through JSON. If this cannot be met without changing how the content record is encoded, stop with `BLOCKED`: a storage-format change needs the owner's decision.
    - Schema guard. The merge also requires the disk content's `schemaVersion` value to equal the in-memory store's. A different version means another tab runs a different build; the merge is skipped and the write proceeds as today, leaving the startup schema check (`syncdb/src/client.ts`, wipe on version mismatch) in charge.
    - Existing `idbSetImpl` callers keep working: when `idbSetImpl` is supplied and `idbSetManyImpl` is not, the persister writes the content record and then the token through `idbSetImpl` (two calls, not atomic; a test-only path). `createSyncDb` and `DefaultPersisterFactoryConfig` are not changed by this task, so `syncdb/src/client.test.ts` keeps passing unmodified.
    - The persister calls an optional `onMerged?: () => void` after a merge changed the in-memory store (T6 uses it).
    - Wipe never merges. `SyncPersister` gains `overwrite?: () => Promise<void>`, which writes the current in-memory content and a fresh token without reading or merging. `wipeLocalData` (`syncdb/src/storage/wipe.ts`) calls `overwrite()` when the persister has it, instead of `save()`, so the emptied store is not refilled from disk before the database is deleted.
    - `load()` remembers the token it read. The content record's format and key are unchanged.
    - No save loop: the zero-debounce path gains the same content-hash check the debounced path has, so a save whose content equals what was just written (the autosave fired by the merge itself) writes nothing.
    - T1's unit test loses its `test.failing` marker and passes.
  - Seam: `createEncryptedIndexedDbPersister` with the shared-map overrides (extended with an `idbSetManyImpl` override and a `locks` override for a fake lock manager), real syncdb stores as in T1; `wipeLocalData` as an exported function.
  - Interface: `createEncryptedIndexedDbPersister({…existing, getOwnerUserId?: () => string | undefined, onMerged?: () => void, locks?: {request: (name: string, fn: () => Promise<void>) => Promise<void>}, idbSetManyImpl?})`. `idbSetMany({databaseName, entries: Array<{key: string, value: unknown}>}): Promise<void>` writes all entries in one `readwrite` transaction. Returned persister adds `overwrite(): Promise<void>`.
  - Cases (stores A, B, C share one map; `getOwnerUserId` returns `"u1"` unless stated):
    - T1's unit sequence → C has outbox row `m1` with `status === "queued"` and `todos` row `t2`; the map's `writeToken` is a non-empty string that differs from the token after A's save
    - same cell edited in both: A sets the `data` cell of `todos` row `t1` to `"A"` first, B sets it to `"B"` afterwards; B saves, then A saves → C reads `"B"` (the later edit wins, not the later save)
    - A deletes outbox row `m1` (after an ack) and saves; B, which still holds `m1`, saves afterwards → C's outbox table has no row `m1` (`hasRow` is false, and the table's row ids do not include `m1`)
    - single tab: 3 saves of changed content → the content record is read 0 times after the initial load
    - legacy data: the map has a content record and no `writeToken` → load works, first save writes a token, and no merge read happens
    - disk record encrypted with a different key → no merge, no throw, the save completes, `onDecryptFailure` is not called by the save path
    - disk content's user is `"u1"`, B's `getOwnerUserId` returns `"u2"` → after B saves, B's memory holds none of the disk's rows
    - disk content's user is `"u1"`, B's `getOwnerUserId` returns `undefined` (a just-wiped store) → after B saves, B's memory is still empty
    - disk content's `schemaVersion` is the in-memory value plus 1, same user → after B saves, B's memory holds none of the disk's rows
    - `idbSetImpl` spy supplied, no `idbSetManyImpl` → a save calls the spy 2 times, first with key `"content"`, then with key `"writeToken"`
    - a save that merged at least one new row → `onMerged` called 1 time; a save with nothing to merge → 0 times
    - `getOwnerUserId` not passed → no merge read ever happens
    - database deleted and recreated: A saves (token t1), the map is cleared, B saves (token t2), then A saves again → A reads the content record (t2 differs from t1) before writing
    - `wipeLocalData({store: A, persister, databaseNames: ["t"]})` while the map holds B's newer content for the same user → A's store is empty afterwards and the map has no records for `"t"`
    - `locks` override records calls → each save calls `request` exactly once with name `"terreno-syncdb:t"`; with `locks` undefined and no `navigator.locks` → save still completes
    - `idbSetManyImpl` rejects → `onSaveFailure` called once, remembered token unchanged, a retry save succeeds
    - two saves started together from A and B (the fake lock serializes them) → C holds both tabs' rows
    - `saveDebounceMs: 0`, two `save()` calls with no change between them → 1 write
    - `destroy()` during a pending debounced save → nothing is written (existing behaviour kept)
  - Blast radius: every web save and load, and every wipe (logout, user switch, schema mismatch, decrypt failure all go through `wipeLocalData`, which saves through the persister before deleting the database). Existing `syncdb/src/persisters/encryptedIndexedDbPersister.test.ts`, `defaultPersisterFactory.test.ts` and the wipe tests stay green. Native and the memory persister are untouched (`overwrite` is optional). Browser specs `syncdb-offline.spec.ts`, `syncdb-storage.spec.ts` (user switch and wipe), `syncdb-conflicts.spec.ts` stay green in Brew/CI.
  - Test skills: terreno-frontend-tests
  - Docs: none in this task (T4 writes them once the browser proof passes).
  - Verification: `cd syncdb && bun test src/persisters/ src/storage/`

- [ ] **T6** — Keep the outbox send order correct after a merge
  - Depends on: T2 (uses the `onMerged` hook T2 adds)
  - Files: syncdb/src/mutations/outbox.ts, syncdb/src/mutations/outboxMergeOrder.test.ts, syncdb/src/sync/replayCoordinator.ts, syncdb/src/persisters/defaultPersisterFactory.web.ts, syncdb/src/persisters/types.ts
  - Why: queued writes are sent in one global order (`enqueueOrder`, INV-1 in `syncdb/src/sync/replayCoordinator.ts`). Each tab numbers its writes from a counter stored in the store (`outboxMaxEnqueueOrder`, `syncdb/src/mutations/outbox.ts`). A merge keeps whichever tab's counter was written last, which can be lower than orders already in the merged queue, so a later update could be numbered, and sent, before the create it depends on.
  - Criteria:
    - After a merge (`onMerged`), the stored counter is raised to the highest `enqueueOrder` in the outbox table when it is lower. `nextEnqueueOrder` therefore always returns a number greater than every row's order.
    - Two rows with the same `enqueueOrder` (queued independently in two tabs before either merged) are sent in ascending `mutationId` order, in every tab.
    - A merged row that another tab marked in flight is not sent by this tab while it runs; it is recovered and sent after the next start, by the existing startup recovery of in-flight rows (`syncdb/src/client.ts`, around line 2035). The server applies it once (A3).
    - An ack or nack for a row that a merge has already removed is ignored without an error or a warning-level log.
  - Seam: the outbox factory in `syncdb/src/mutations/outbox.ts` over a real syncdb store, and the replay coordinator with `createFakeTransport` from `@terreno/syncdb/testing`.
  - Interface: new exported `reconcileOutboxOrder({store}): void` in `syncdb/src/mutations/outbox.ts`; the web persister factory passes `onMerged: () => reconcileOutboxOrder({store})`.
  - Cases:
    - store has outbox rows with orders 5, 6, 7 and the counter value 5 (as after merging a tab whose counter was written later) → `reconcileOutboxOrder` sets the counter to 7; the next `enqueue` gets order 8
    - counter 9, highest row order 7 → counter stays 9
    - empty outbox, counter 0 → counter stays 0; the next `enqueue` gets order 1
    - rows `mB` (order 5) and `mA` (order 5), both queued → the fake transport receives `mA` before `mB`
    - a row with the in-flight status that this coordinator did not send → a `replay()` sends 0 mutations for it; after a fresh client start over the same store it is sent 1 time
    - coordinator has `m1` in flight; `m1`'s row is deleted from the store (as a merge of another tab's ack would); the transport then acks `m1` → no throw, `console.warn` and `console.error` not called
  - Blast radius: every drain. Existing `syncdb/src/mutations/` and `syncdb/src/sync/` tests stay green; single-tab ordering is unchanged because the counter only ever rises. Browser specs `syncdb-offline.spec.ts` and `syncdb-chaos.spec.ts` stay green in Brew/CI.
  - Test skills: terreno-frontend-tests
  - Verification: `cd syncdb && bun test src/mutations/ src/sync/`

- [ ] **T3** — Flush when the page is hidden (best effort)
  - Depends on: T2 (same file)
  - Files: syncdb/src/persisters/encryptedIndexedDbPersister.ts, syncdb/src/persisters/pageHideFlush.test.ts, changelog/unreleased/syncdb-flush-on-page-hide.md
  - Criteria:
    - On the web, the persister listens for `visibilitychange` (when `document.visibilityState === "hidden"`) and `pagehide`, and calls its own `flush()`, bypassing the debounce. Listeners are added when the persister is created and removed in `destroy()`. Where `document` or `addEventListener` is missing, nothing is registered.
    - A flush failure goes to `onSaveFailure` and never throws out of the event handler.
    - The changelog fragment and docs call this best effort: the write is asynchronous and may not finish if the browser discards the page.
  - Seam: `createEncryptedIndexedDbPersister` with an injected event target.
  - Interface: new optional `lifecycleTarget?: {addEventListener, removeEventListener, visibilityState?: () => string}`. Without it, `visibilitychange` is registered on `globalThis.document` and `pagehide` on `globalThis` (the window), each only when present. An injected target replaces both.
  - Cases:
    - `saveDebounceMs: 500`; set a row, start a save, 10 ms later dispatch `visibilitychange` with state `hidden` → the shared map holds the row while fake timers have advanced less than 500 ms (the test awaits a promise that resolves when the storage-write spy is called; it does not call `flush()` itself)
    - `visibilitychange` with state `visible` → no write
    - `pagehide` → write happens
    - no pending change → the event causes 0 writes
    - after `destroy()` → dispatching either event causes 0 writes, and `removeEventListener` was called for both
    - no `lifecycleTarget` and no `document` (Bun) → creating the persister does not throw
    - `idbSetManyImpl` rejects during the hidden flush → `onSaveFailure` called once, no unhandled rejection
  - Blast radius: none beyond T2's.
  - Test skills: terreno-frontend-tests
  - Verification: `cd syncdb && bun test src/persisters/pageHideFlush.test.ts src/persisters/`

- [ ] **T4** — Two-tab browser proof and documentation
  - Depends on: T2, T3, T6
  - Files: example-frontend/e2e/syncdb-cross-tab.spec.ts, docs/explanation/local-first-data.md, docs/reference/syncdb.md, docs/how-to/use-syncdb-correctly.md, docs/testing/e2e/example-frontend.md
  - Criteria:
    - The browser spec from T1 loses `test.fail()` and passes. It gains a final step: go online in tab 2, wait for `sync-queued-count` to hide, then the API (`listTodosAs`) lists "Tab one offline" exactly once and "Tab two offline" exactly once.
    - A second test in the spec, where both tabs hold the same queued write: both tabs offline; tab 1 creates "Dup check" and its record is rewritten; tab 2 then creates "Dup partner" (its save merges tab 1's queued write) and tab 2's `sync-queued-count` contains 2; both tabs go online; both `sync-queued-count` hide → the API lists "Dup check" exactly once and "Dup partner" exactly once.
    - `docs/testing/e2e/example-frontend.md` lists the new spec with the other syncdb specs and notes that two tabs are two pages of one browser context.
    - `docs/explanation/local-first-data.md` gains a section "More than one tab" covering: tabs share one store on disk and merge on save; a tab does not show another tab's offline changes until it saves or reloads; both tabs may send the same queued write and the server applies it once; the write token record; the best-effort flush on page hide; behaviour without Web Locks. `docs/reference/syncdb.md` documents the `writeToken` record and the storage-compatibility note. `docs/how-to/use-syncdb-correctly.md` links to the section.
  - Seam: the example app in Chromium (browser layer of `docs/testing/e2e.md`).
  - Interface: as T1.
  - Cases: the E1 sequence with the reconnect step, and the "Dup check" / "Dup partner" sequence, with the literal titles above.
  - Blast radius: none (spec and docs).
  - Test skills: terreno-frontend-tests
  - Verification: `bun run --cwd example-frontend test:e2e syncdb-cross-tab.spec.ts`; the docs check from `terreno:update-docs`.

- [ ] **T5** — Warn when the persisted store is large; `saveDebounceMs` on `createSyncDb`
  - Depends on: T3 (same persister file), T4 (same two docs pages)
  - Files: syncdb/src/persisters/encryptedIndexedDbPersister.ts, syncdb/src/persisters/types.ts, syncdb/src/client.ts, syncdb/src/persisters/storeSizeWarning.test.ts, syncdb/src/client.test.ts, docs/how-to/use-syncdb-correctly.md, docs/reference/syncdb.md, changelog/unreleased/syncdb-large-store-warning.md
  - Criteria:
    - After each successful write the persister records the serialized size in bytes and the save duration in ms, readable through a new `getLastSaveStats(): {bytes: number, durationMs: number} | undefined` on the returned persister.
    - The first time a write exceeds `largeStoreWarnBytes` (new option, default 5 × 1024 × 1024) it logs one `console.warn` naming the size, the fact that every save rewrites the whole store, and the two remedies (`queryCollections` with `useWindowQuery`, and a larger `saveDebounceMs`). It does not warn again for that persister. `largeStoreWarnBytes: 0` disables it.
    - `docs/how-to/use-syncdb-correctly.md` gains "How much data to sync": the whole-store save cost, the 5 MB warning, when to move a collection to `queryCollections`, and how to raise `saveDebounceMs`.
    - `createSyncDb` config gains `saveDebounceMs?: number`, forwarded to `createDefaultPersisterFactory` at the one call site in `syncdb/src/client.ts` that already forwards `idbGetImpl`, `idbSetImpl` and `keyProvider`. Omitted means the current default (500 ms). It has no effect with a custom `persisterFactory` or on native.
  - Seam: `createEncryptedIndexedDbPersister` with the shared-map overrides and a `console.warn` spy; `createSyncDb` with `idbGetImpl` / `idbSetImpl` overrides and a fake transport (`createFakeTransport` from `@terreno/syncdb/testing`).
  - Interface: `largeStoreWarnBytes?: number`; `getLastSaveStats()`; `createSyncDb({…, saveDebounceMs?: number})`.
  - Cases:
    - before any save → `getLastSaveStats()` is `undefined`
    - save a store whose JSON is about 1 KB with `largeStoreWarnBytes: 100` → 1 warn whose text contains `queryCollections`; `getLastSaveStats().bytes` is greater than 100
    - two more large saves → still 1 warn in total
    - `largeStoreWarnBytes: 0` → 0 warns
    - default threshold with a 1 KB store → 0 warns
    - in `syncdb/src/client.test.ts`: `createSyncDb({…, saveDebounceMs: 0, idbSetImpl: spy})`, start, one `mutate` create → the spy is called with key `"content"` without advancing timers; with `saveDebounceMs` omitted and fake timers, the spy is not called with key `"content"` for that create until 500 ms have elapsed
  - Blast radius: none for apps that do not set the new option; the log line is the only default change. `syncdb/src/client.ts` is also the file `api-foundations` plans to split; this task adds one config field and one forwarded argument, so whichever lands second rebases a two-line change.
  - Test skills: terreno-frontend-tests
  - Verification: `cd syncdb && bun test src/persisters/`

## Assumptions

- A1. The loss reproduces. Reading the code, tab B's save serializes only B's memory and overwrites the single record, and tab A does not rewrite until its own content changes. T1 tests this assumption before anything is built on it.
- A2. Unproven until T2: a TinyBase `MergeableStore` merge of content that has passed through JSON keeps a deleted row deleted. Deletions carry timestamps, but `syncdb/src/storage/schema.ts` records that tombstones have come back as ghost rows before. T2's third case tests it with the real schema, and T2 stops with `BLOCKED` if it needs an encoding change.
- A8. T5 is one task with two small behaviours (the size warning and forwarding `saveDebounceMs`) because both are the audit's short-term advice for 3.14 and share the docs section; each has its own cases.
- A3. The server applies a mutation id once (`api/src/sync/models.ts:487`, "unique so concurrent deliveries claim exactly once"), so two tabs sending the same queued write is safe. T4's second test checks it end to end.
- A4. A tab still running a build from before this change writes without replacing the write token, so a new-build tab will not notice that write. That is today's behaviour for that pair of tabs and ends when the old tab reloads.
- A5. The client always passes a real user id to the default web persister (`createAndStartPersister(userId)` in `syncdb/src/client.ts`), and the store records its last user, so the owner check has something to compare.
- A6. The audit's "two-context test" wording is read as two tabs. Two Playwright browser contexts do not share IndexedDB, so they cannot show this bug; two pages in one context do.
- A7. IP path follows the user-level convention `docs/plans/YYYY-MM-DD-<slug>.md`.

## Audit corrections

- 4.7 asks for "a two-context Playwright test". Separate browser contexts have separate IndexedDB; the test must use two pages in one context (A6). The existing `openSecondSession` helper creates a new context and is the wrong tool here.
- 3.14 recommends "expose `saveDebounceMs`". It is already an option on `createDefaultPersisterFactory` (`syncdb/src/persisters/types.ts`). It is not reachable from `createSyncDb` config without passing a custom `persisterFactory`; T5 forwards it.
- 4.7's claim that no flush runs on enqueue or page hide is confirmed: `flush()` is called only after conflict resolution (`syncdb/src/client.ts:2266`).

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 (fundamental) | Is per-partition persistence (audit 3.14) part of this work, or its own plan later? | Its own IP, `syncdb-partitioned-persistence`, after this one lands and after one measurement of real store sizes (T5 adds the counter). | Weeks of work, a storage-format migration on web and native that cannot be undone cheaply once devices hold the new format, and it should build on the lock and token protocol proven here. The S1 data-loss fix should not wait for it. | Yes, now: this IP grows by an estimated 8–12 tasks, T2's write path is designed per partition from the start, and an on-device migration with a rollback plan must be decided before T2 is built. | T2, T5 |
| Q2 | Should a tab show another tab's offline changes live? | No (Expansion X2). | Not needed to stop the loss; adds a BroadcastChannel and a load path, and more duplicate sends. | Yes: one more task after T2 (broadcast after write, merge-load on message) and one more browser case. | new task |
| Q3 | Should only one tab send queued writes at a time? | No, rely on the server applying each mutation id once (Expansion X3). | The server already guarantees it; a drain lock means editing the 2,491-line `client.ts` that `api-foundations` plans to split. | Yes: a task adds a second Web Lock around the drain pass in the coordinator; coordinate with `api-foundations`. | new task |
| Q4 | When the record on disk belongs to another user, should this tab refuse to write instead of overwriting? | Overwrite, as today; never merge. | The persister cannot tell which tab is stale. If it refused, a tab that just signed in as the new user would be locked out of saving whenever an old tab had written last, with no way to recover. Deciding which session is current belongs with sign-out handling in `secure-defaults`. The cost: a stale tab still signed in as the previous user can write that user's local data back to disk after a sign-out wipe, exactly as it can today. | Refuse: T2 adds an `owner-changed` save failure and `persistence: "error"` status, and the user-switch browser spec (`syncdb-storage.spec.ts`) must be re-proved. | T2 |
| Q5 | Is 5 MB the right warning threshold? | Yes, as a first value. | No measurement exists; 5 MB is where a JSON stringify plus AES-GCM pass becomes visible on a mid-range phone browser. It is a constant and an option. | Different number: one constant. | T5 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Per-partition persistence: save only the collections or row chunks that changed, on web and native, with a storage migration. Suggested IP slug `syncdb-partitioned-persistence`. | Audit 3.14; Q1 | L (weeks) | T2 |
| X2 | Live cross-tab view: broadcast after a save, merge-load in other tabs | Q2 | M | T2 |
| X3 | One tab drains the outbox at a time; a tab sends only its own writes and adopts a closed tab's | Q3 | M | T2, `api-foundations` (client split) |
| X4 | Flush immediately when a write is queued, not only on page hide | Would shrink the loss window on a crash | S | T3, `api-foundations` (client split) |
| X5 | Stop a stale tab (previous user's session) from writing after another tab signs out or switches user | Q4 | S–M | `secure-defaults` (wipe on sign-out) |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |

None. The human was not asked; every open question above stands on its recommendation.

Compatibility record (required by the request): on-device storage — the encrypted content record keeps its key and format; one sibling record `writeToken` is added to the same object store; older builds ignore it, so upgrade and rollback need no migration. No wire format or REST change in this plan. Per-partition persistence, which would change the storage format, is deferred to X1 and must record its own migration decision.

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagent each), 19 findings: 16 fixed, 2 moved to questions (per-partition scope → Q1 fundamental; refuse-to-write on owner mismatch → Q4 with the liveness reason), 1 rebutted in part (a real-browser spec for the page-hide flush would be flaky by design; the claim was cut to best effort instead). Round 2's two blocking findings (outbox order after a merge; `idbSetImpl` compatibility) were fixed by adding T6 and a compatibility rule in T2; no third round was run, so T6 is unreviewed.
