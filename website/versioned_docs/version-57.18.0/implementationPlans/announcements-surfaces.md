# Announcement Surfaces, Targeting, and Click Tracking

**Status:** Complete — shipped with announcements
**Parent IP:** [announcements](announcements.md)  
**Branch:** `cursor/announcements-grow-bf9c`  
**Owner:** Terreno  
**Created:** 2026-09-15  
**Linear:** https://linear.app/flourish-health/project/product-update-announcements-in-app-944f756c05c9/overview

v1 (`@terreno/announcements` + blocking `AnnouncementNavigator`) lives on this same PR. This follow-up ships on that branch — do not open a second PR.

## Goal

One `Announcement` collection can serve **staff** (blocking modal + required ack) and **patients** (non-blocking banner / feed-only, dismiss-only) without a second plugin. Admins pick display mode, audience type, acknowledgement policy, and optional min build. Clients cap interrupt frequency locally. Primary-action clicks are first-class analytics.

**Tracer bullet:** `GET /announcements/pending?platform=&version=` → `AnnouncementNavigator` renders **banner or modal** from `displayMode` → `POST /announcements/:id/click` on primary action.

## Non-Goals

- Multi-locale `title` / `body`.
- Socket push when an announcement publishes.
- Snooze / remind-later.
- Per-platform min builds (`{ios, android, web}`).
- Server-enforced cooldown or cross-device frequency caps.
- Email/push digest (`@terreno/comms` stays separate).
- Replacing opaque `audience` JSON — `audienceType` is additive; `matchAudience` still owns custom targeting.

## Decisions

| Question | Decision |
|----------|----------|
| Q1 — Min app version | Optional `minBuildNumber` (integer, same scale as `VersionCheckPlugin`). Client sends `?version=` on pending/feed/help. Omit/`0` on the announcement = no gate. Omit `version` query = do not hide gated items. |
| Q2 — Frequency caps | Client-only in `AnnouncementNavigator` (AsyncStorage). Plugin UI props: `maxInterruptionsPerSession` (default `1`), `cooldownHours` (default unset = off), `skipFirstLaunch` (default `false`). Server still returns the full interrupt queue. |
| Q3 — Acknowledgement | Per-announcement `acknowledgementPolicy: "required" \| "dismiss-only"`. Drop `acknowledgementMode` and `requiresAcknowledgement`. Consumer `defaultAcknowledgementPolicy` on `AnnouncementsApp` fills omitted policy at read time and pre-fills the admin editor. |
| Q4 — CTA clicks | New `AnnouncementClickEvent` + `POST /announcements/:id/click` with `{action: "primaryAction"}`. Do not overload impressions. |
| Q5 — Pending queue | `GET /pending` returns only `displayMode: "modal" \| "banner"`. `feed` is changelog-only. Existing rows default `displayMode: "modal"`. |
| Q6 — Targeting | First-class `audienceType: "staff" \| "patient" \| "all"` (default `"all"`) composed with existing `audience` + `matchAudience`. Package exports `matchAudienceByType`. |
| Q7 — Collection | Still one Mongoose `Announcement` model / one `AnnouncementsApp`. |

## Architecture

```
Announcement
  displayMode, audienceType, acknowledgementPolicy, minBuildNumber
  + existing lifecycle / audience / platforms / primaryAction

GET  /announcements/pending?platform=&version=   → interrupt queue only (modal + banner)
GET  /announcements/feed?platform=&version=      → changelog (all display modes)
GET  /announcements/config                       → { defaultAcknowledgementPolicy } (admin)
POST /announcements/:id/click                    → AnnouncementClickEvent
POST /announcements/:id/acknowledge | impression → same visibility as pending/feed (404 if hidden)

AnnouncementNavigator
  modal  → blocks children (today)
  banner → children stay mounted; AnnouncementBanner overlay (one at a time)
  frequency caps applied client-side after pending fetch
```

v1 is **not published**. Replace `requiresAcknowledgement` / `acknowledgementMode` in this PR. Read-path fallback if a local doc still has the boolean: `true` → `"required"`, else `defaultAcknowledgementPolicy`.

## Models

### Announcement (additive + replace ack fields)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `displayMode` | `"modal" \| "banner" \| "feed"` | `"modal"` | Pending includes `modal` and `banner` only. |
| `audienceType` | `"staff" \| "patient" \| "all"` | `"all"` | Admin control + `matchAudienceByType`. Opaque `audience` Mixed stays. |
| `acknowledgementPolicy` | `"required" \| "dismiss-only"` | unset | Resolve: field ?? `defaultAcknowledgementPolicy` ?? `"dismiss-only"`. |
| `minBuildNumber` | `number` optional | unset | Hide when query `version` is a finite integer **and** `version < minBuildNumber`. |

Remove schema + options field `requiresAcknowledgement` and plugin option `acknowledgementMode`. Public DTO still includes **resolved** `requiresAcknowledgement: boolean` plus `displayMode` so the navigator does not re-implement policy.

Every new schema field needs a `description` (OpenAPI). Types in `announcements/src/types.ts` updated in the same commit.

### AnnouncementClickEvent (new)

```typescript
{
  userId: ObjectId;           // ref User, required, indexed
  announcementId: ObjectId;   // ref Announcement, required, indexed
  version: number;            // announcement version at click
  action: "primaryAction";    // enum — only this value in this slice
  clickedAt: Date;
  platform?: "ios" | "android" | "web";
}
```

Plugins: `createdUpdatedPlugin`, `isDeletedPlugin`, `findExactlyOne`, `findOneOrNone`.  
Index: `{ announcementId: 1, clickedAt: -1 }`. Not unique.

## APIs

Base path unchanged (`/announcements`). Auth: user routes `IsAuthenticated`; config + click-list `IsAdmin`.

| Method | Path | Change |
|--------|------|--------|
| GET | `/announcements/pending` | Query `platform`, `version`. Filter: visible now, platform, min build, `matchAudience`, ack/impression pending rules, **`displayMode` in `modal`/`banner`**. Sort unchanged. `{ current, remainingCount }` among interrupts only. |
| GET | `/announcements/feed` | Same visibility + min build + audience; **all** display modes. |
| GET | `/announcements/help/*` | Same min-build and audience filters as pending/feed visibility. |
| GET | `/announcements/config` | Admin. `{ data: { defaultAcknowledgementPolicy } }`. |
| POST | `/announcements/:id/click` | Body `{ action: "primaryAction", platform? }`. 404 if announcement not visible to user. 400 if no `primaryAction` or bad `action`. |
| GET | `/announcement-click-events` | Admin list/read via modelRouter (same pattern as impressions). |

**Policy resolution** (pending, feed, help, public DTO):

```
policy = announcement.acknowledgementPolicy
  ?? options.defaultAcknowledgementPolicy
  ?? "dismiss-only"
requiresAcknowledgement = policy === "required"
```

Queue advancement: required → acknowledgement row; dismiss-only → impression (unchanged).

**`matchAudienceByType`:**

```typescript
matchAudienceByType({
  announcement,
  isStaff: (user) => boolean,
}): boolean
// all → true; staff → isStaff(user); patient → !isStaff(user)
```

Consumers compose: `matchAudienceByType(...) && customAudienceJson(...)`.

## Notifications

None. Still poll/refetch on navigator mount and focus.

## UI

### `@terreno/ui`

| Piece | Behavior |
|-------|----------|
| `AnnouncementPublic` | Add `displayMode`. Keep resolved `requiresAcknowledgement`. |
| `useAnnouncements` | Send `platform` and integer `version` (Expo `Constants.expoConfig.extra.buildNumber` / same source as `useUpgradeCheck`). |
| `AnnouncementNavigator` | If `current.displayMode === "modal"`, block children (v1). If `"banner"`, render children **and** `AnnouncementBanner`. Frequency filter runs on `current` before show. |
| `AnnouncementBanner` | Compose existing `Banner`. Title, dismiss (or ack when required), optional primary action. Impression on show. |
| `AnnouncementScreen` | Unchanged modal body; primary action also `POST /click`. |
| `useAcknowledgeAnnouncement` | Add `recordClick(id)`. |
| Frequency helper | AsyncStorage keys namespaced by user id when available, else `"anon"`. Session counter in memory. Skip first launch: if no `hasLaunched` key, set it and skip interrupts this launch. Cooldown: last interrupt timestamp. Caps apply to **interrupts only**, not the feed screen. |

```tsx
<AnnouncementNavigator
  api={terrenoApi}
  frequency={{
    maxInterruptionsPerSession: 1,
    cooldownHours: 24,
    skipFirstLaunch: true,
  }}
>
  <AppTabs />
</AnnouncementNavigator>
```

Example app: leave `skipFirstLaunch: false` so the seeded modal still appears on first run.

### `@terreno/admin-frontend`

`AnnouncementEditor` / `AnnouncementList`: structured selects for `displayMode`, `audienceType`, `acknowledgementPolicy` (pre-filled from `/announcements/config`), optional `minBuildNumber`. Keep `audience` JSON as an advanced field. List columns: status, displayMode, audienceType, policy.

## Phases

| Phase | Scope |
|-------|--------|
| **1 — Backend contracts** | Schema, pending/feed/help filters, config route, click model + POST, tests |
| **2 — Consumer UI** | Banner navigator, version query, frequency, click mutation |
| **3 — Admin + example + docs** | Editor fields, example `matchAudienceByType` + seeds, how-to/reference |
| **4 — Admin launch overview** | Overview API + admin dashboard UI + nav/media wiring |

## Phase 4 — Admin launch overview

Launch-quality admin landing for announcements: one overview screen backed by aggregate metrics instead of scanning raw event collections.

| Deliverable | Scope |
|-------------|--------|
| **4.1 API** | `GET /announcements/overview?page=&limit=` — admin-only; rows with resolved list fields + per-announcement metrics across all event versions; global totals and status counts via aggregation; deterministic sort (`priority` desc, `publishedAt` desc); pagination `{ data, totals, page, limit, total, more }`; OpenAPI for SDK |
| **4.2 UI** | `@terreno/admin-frontend` overview screen consuming overview hook; summary cards from `totals`; table from `data` with metrics columns |
| **4.3 Nav/media** | Grouped Announcements sidebar (overview + audit models), example route, platform multiselect, and rich launch seed with YouTube/screenshots |

Task checklist: **`docs/tasks/announcements-surfaces.md`** (Phase 4).

## Feature Flags & Migrations

- Opt-in remains `AnnouncementsApp` registration.
- No production backfill: package unreleased. Schema defaults cover new fields. Read-path maps leftover `requiresAcknowledgement` boolean.
- Click collection is new. Admin `listFields` / `queryFields` updated for new announcement columns.

## Activity Log & User Updates

No activity-log integration. Admins list click events like impressions.

## Not Included / Future Work

- Localization, sockets, snooze, comms digest.
- Per-platform `minBuildNumber`.
- Server-side / cross-device frequency.
- Additional `action` enum values beyond `primaryAction`.

## Files to Create / Modify

| Area | Files |
|------|--------|
| Models / types | `announcements/src/models/announcement.ts`, `announcementClickEvent.ts`, `announcements/src/types.ts`, `pending.ts` |
| Plugin | `announcements/src/announcementsApp.ts`, `help.ts`, tests under `announcements/src/tests/` |
| UI | `ui/src/AnnouncementBanner.tsx`, `AnnouncementNavigator.tsx`, `AnnouncementScreen.tsx`, `useAnnouncements.ts`, `useAcknowledgeAnnouncement.ts`, `announcementFrequency.ts` (+ tests) |
| Admin | `admin-frontend/src/AnnouncementEditor.tsx`, `AnnouncementList.tsx` (+ tests) |
| Example | `example-backend/src/server.ts`, seed scripts, `example-frontend` navigator props |
| Docs | `docs/reference/announcements.md`, `docs/how-to/product-announcements.md`, this IP, parent IP pointer |
| Knip | `knip.jsonc` only if a new entry file is not already reachable |

## Task List

Executable checklist: **`docs/tasks/announcements-surfaces.md`**.

## Acceptance Criteria

- [x] Pending never returns `displayMode: "feed"`. Feed still lists feed-only items.
- [x] `minBuildNumber` hides the item from pending/feed/help when `version` is present and lower; omitted `version` does not hide.
- [x] `acknowledgementPolicy` + `defaultAcknowledgementPolicy` resolve to public `requiresAcknowledgement`; `acknowledgementMode` is gone.
- [x] `audienceType` is stored and honored by `matchAudienceByType`; example-backend uses `user.admin` as staff.
- [x] Navigator: modal blocks; banner does not; frequency caps skip extra interrupts this session / cooldown / first launch.
- [x] Primary action records `AnnouncementClickEvent` via `POST /announcements/:id/click`.
- [x] Admin editor exposes display mode, audience type, policy, min build without requiring raw JSON for those fields.
- [x] Admin overview shows launch guidance, aggregate totals, and per-announcement impressions, acknowledgements, and CTA clicks.
- [x] Announcement admin routes share one Announcements sidebar group; the editor uses a platform multiselect.
- [x] Example staff launch content renders markdown with a YouTube embed, feature screenshots, and tracked CTA.
- [x] Reference + how-to match shipped behavior in the same slice. New files ≥90% coverage. `bun run announcements:test`, `ui` announcement tests, `admin-frontend` editor tests, `bun run lint`, `bun run compile`, `bun run analyze:full` pass.
