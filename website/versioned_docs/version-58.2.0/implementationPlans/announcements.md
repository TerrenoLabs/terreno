# Product Update Announcements — In-App Core Feature

**Status:** Complete — shipped with @terreno/announcements (57.6.x)
**Roadmap:** Area=`api`, Target=`Released`, Impact=`Feature`  
**Branch:** `cursor/announcements-grow-bf9c`  
**Owner:** Terreno  
**Created:** 2026-09-08  
**Linear:** https://linear.app/flourish-health/project/product-update-announcements-in-app-944f756c05c9/overview

**Follow-up (same PR):** [Announcement surfaces, targeting, and click tracking](announcements-surfaces.md) — display modes, `audienceType`, acknowledgement policy, client frequency caps, min build, CTA clicks. That IP overrides the v1 non-goals “no role targeting built into Terreno” and “no CTA tracking” for the slice listed there.

## Goal

Ship a **core Terreno feature** for admin-managed, in-app product update announcements — similar in scope to feature flags and consent forms. Admins create markdown announcements with scheduling, targeting metadata, and lifecycle controls. Authenticated users see a **priority-ordered modal queue** (one at a time) and can browse a **changelog feed**. Consumers (e.g. Flourish) configure audience matching and acknowledgement policy without forking the package.

**Tracer bullet (v1 proof):** `GET /announcements/pending` → `AnnouncementNavigator` → `POST /announcements/:id/acknowledge`.

## Non-Goals

- Image upload / Terreno CDN hosting (v1 is **URL-only** markdown for images and video links).
- Multi-locale content maps (v1 is single `title` + `body`).
- Real-time socket push when announcements publish (poll/refetch on focus for v1).
- Snooze / remind-later UX.
- Role-based targeting built into Terreno (consumers supply `matchAudience` callback).
- Replacing email/push comms (`@terreno/comms` remains separate).

## Decisions

| Question | Decision |
|----------|----------|
| Q1 — Package placement | New workspace package **`@terreno/announcements`** (plugin pattern like `@terreno/feature-flags`). |
| Q2 — Consumer UI | Ship **`AnnouncementNavigator`** + **`AnnouncementScreen`** in **`@terreno/ui`** (mirror `ConsentNavigator`). |
| Q3 — Targeting | `audience: Mixed` on `Announcement` + consumer **`matchAudience(user, announcement)`** callback. |
| Q4 — Acknowledgement | **Superseded** by [announcements-surfaces.md](announcements-surfaces.md): per-announcement **`acknowledgementPolicy`** (`required` \| `dismiss-only`) + consumer **`defaultAcknowledgementPolicy`** (default `dismiss-only`). Legacy v1 `requiresAcknowledgement` / `acknowledgementMode` are removed. |
| Q5 — Lifecycle | **`draft` → `published` → `archived`**; priority queue; **one modal at a time**. |
| Q6 — Media (defaults) | **URL-only markdown** in v1 — no upload/CDN pipeline. |
| Q7 — Re-show on edit (defaults) | **Auto `version` bump** when a **published** announcement's `title` or `body` changes; acknowledgements are per `(userId, announcementId, version)`. |
| Q8 — Localization (defaults) | **Single `title` + `body`** strings in v1 (no locale map). |
| Q9 — Admin UX | **Custom manager screen** with live markdown preview + publish/archive actions (like `ConsentFormEditor`), not generic CRUD only. |
| Q10 — v1 extras | **`publishAt`**, **`expiresAt`**, **`platforms`**, **`primaryAction`**, **impression tracking**, **changelog feed** (`GET /announcements/feed`). |

## Architecture

```
@terreno/announcements (TerrenoPlugin)
  ├─ Announcement model (admin CRUD via modelRouter + adminContribution)
  ├─ AnnouncementAcknowledgement model
  ├─ AnnouncementImpression model
  ├─ GET  /announcements/pending   → modal queue for current user
  ├─ GET  /announcements/feed      → published changelog (paginated)
  ├─ POST /announcements/:id/acknowledge
  └─ POST /announcements/:id/impression

@terreno/ui
  ├─ AnnouncementNavigator (blocks children while queue non-empty)
  ├─ AnnouncementScreen (markdown body, primary action, acknowledge/dismiss)
  ├─ useAnnouncements / useAcknowledgeAnnouncement (RTK inject pattern)
  └─ MarkdownView enhancement (YouTube + Loom embeds)

@terreno/admin-frontend
  ├─ AnnouncementEditor (MarkdownEditor + preview + publish)
  └─ AnnouncementList

Consumer app (example-frontend, later Flourish)
  └─ AnnouncementsApp({ isStaff, defaultAcknowledgementPolicy, matchAudience })
       + <AnnouncementNavigator api={terrenoApi} frequency={{ skipFirstLaunch: false, userId }} />
```

Mirror existing patterns:

| Concern | Reference |
|---------|-----------|
| Plugin package | `feature-flags/src/featureFlagsApp.ts` |
| User-blocking navigator | `ui/src/ConsentNavigator.tsx` |
| Admin custom editor | `admin-frontend/src/ConsentFormEditor.tsx` |
| Markdown admin widget | `admin-frontend/src/widgets/builtInFieldWidgets.tsx` (`widget: "markdown"`) |
| RTK hook injection | `rtk/src/useTerrenoFeatureFlags.ts` |

## Models

### Announcement

Admin-managed product update definition.

```typescript
{
  title: string;                    // required, trim
  body: string;                     // required, markdown
  status: "draft" | "published" | "archived";
  version: number;                  // default 1; auto-increment on published title/body edit
  priority: number;                 // higher = shown first in modal queue; default 0
  acknowledgementPolicy: "required" | "dismiss-only"; // per-announcement; see announcements-surfaces.md
  audience: Mixed;                  // opaque JSON for consumer matchAudience (roles, segments, etc.)
  publishAt?: Date;                 // optional scheduled publish (null = immediate when published)
  expiresAt?: Date;                 // optional; excluded from pending/feed after expiry
  platforms: ("ios" | "android" | "web")[]; // default all three
  primaryAction?: {
    label: string;
    url: string;                    // deep link or external URL
  };
  publishedAt?: Date;               // set when status becomes published
  archivedAt?: Date;
}
```

Indexes: `{ status: 1, publishAt: 1 }`, `{ status: 1, priority: -1, publishedAt: -1 }`.

Plugins: `createdUpdatedPlugin`, `isDeletedPlugin`, `findExactlyOne`, `findOneOrNone`.

**Pre-save hook:** When `status === "published"` and `title` or `body` changes vs previous document, increment `version` (forces re-ack for users who only acknowledged the prior version).

### AnnouncementAcknowledgement

```typescript
{
  userId: ObjectId;           // ref User, required, indexed
  announcementId: ObjectId;   // ref Announcement, required, indexed
  version: number;            // announcement version at acknowledge time
  acknowledgedAt: Date;
}
```

Compound unique index: `{ userId: 1, announcementId: 1, version: 1 }`.

### AnnouncementImpression

```typescript
{
  userId: ObjectId;
  announcementId: ObjectId;
  version: number;
  viewedAt: Date;
  platform?: "ios" | "android" | "web";
}
```

Index: `{ announcementId: 1, viewedAt: -1 }` (admin analytics). Not unique — one row per view event is acceptable for v1.

## APIs

Base path configurable (default **`/announcements`**). All routes behind `authenticateMiddleware()`.

### Admin routes (IsAdmin) — via modelRouter + custom actions

| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PATCH/DELETE | `/announcements` | CRUD on `Announcement` |
| POST | `/announcements/:id/publish` | `draft` → `published`; sets `publishedAt`; validates `publishAt` ≤ now unless scheduling |
| POST | `/announcements/:id/archive` | `published` → `archived`; sets `archivedAt` |
| GET | `/announcement-acknowledgements` | List acks (admin read) |
| GET | `/announcement-impressions` | List impressions (admin read) |

### User routes (IsAuthenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/announcements/pending` | Modal queue: published, in window (`publishAt` ≤ now, `expiresAt` null or > now), platform match, `matchAudience` pass, not acknowledged at current `version` (when ack required). Sorted by `priority` desc, then `publishedAt` desc. Returns **at most one** “current” item plus `remainingCount` for UI hint. |
| GET | `/announcements/feed` | Paginated published changelog (same filters except acknowledgement). Query: `limit`, `page` / cursor. |
| POST | `/announcements/:id/acknowledge` | Create `AnnouncementAcknowledgement` for current version. Idempotent per version. |
| POST | `/announcements/:id/impression` | Record view when modal opens or feed item becomes visible. Body optional `{ platform }`. |

### Plugin constructor

```typescript
interface AnnouncementsOptions {
  basePath?: string;  // default "/announcements"
  defaultAcknowledgementPolicy?: "required" | "dismiss-only";  // default "dismiss-only"
  isStaff?: (user: User) => boolean;  // default user.admin === true
  matchAudience?: (
    user: User,
    announcement: AnnouncementDocument
  ) => boolean | Promise<boolean>;
  permissions?: Partial<ModelRouterPermissions>;       // override IsAdmin defaults
}

class AnnouncementsApp implements TerrenoPlugin {
  constructor(options?: AnnouncementsOptions);
  register(app: express.Application, openApi?: unknown): void;
  adminContribution(): AdminContribution;
}
```

**Acknowledgement resolution:** per-announcement `acknowledgementPolicy` with consumer `defaultAcknowledgementPolicy`. Legacy `requiresAcknowledgement: true` maps to `"required"` on read. See [announcements-surfaces.md](announcements-surfaces.md) and `docs/reference/announcements.md`.

## Notifications

None in v1. Queue is fetched on app launch / navigator mount and on RTK refetch (window focus). No push/email integration.

## UI

### `@terreno/ui`

| Component | Description |
|-----------|-------------|
| `AnnouncementNavigator` | Wraps app content. Fetches `GET /announcements/pending`. While queue non-empty, renders `AnnouncementScreen` for current item. On acknowledge/dismiss, advances or refetches. Auth errors pass through to children (same as `ConsentNavigator`). |
| `AnnouncementScreen` | Title, scrollable `MarkdownView` body, optional `primaryAction` link button, acknowledge button (when required) or dismiss. Records impression on mount. |
| `useAnnouncements` | RTK-injected query for pending + feed. |
| `useAcknowledgeAnnouncement` | RTK mutation; invalidates pending cache. |
| `MarkdownView` (enhancement) | Custom link/image renderer: YouTube and Loom URLs render as embedded players (web: iframe; native: WebView or platform-appropriate embed). Plain image URLs continue to render as images. |

### `@terreno/admin-frontend`

| Component | Description |
|-----------|-------------|
| `AnnouncementEditor` | Create/edit: title, body (`MarkdownEditor`), priority, `displayMode`, `audienceType`, `acknowledgementPolicy` (pre-filled from config), optional `minBuildNumber`, advanced `audience` JSON, publishAt/expiresAt, platforms multi-select, primaryAction fields. Live preview pane. Actions: Save draft, Publish, Archive. |
| `AnnouncementList` | Table: title, status, displayMode, audienceType, acknowledgement policy, priority, version, publishedAt, expiresAt. Row → editor. |

Register via `AnnouncementsApp.adminContribution()` with custom routes pointing at these screens (same pattern as consent admin overrides).

### Client integration

```typescript
import {AnnouncementNavigator} from "@terreno/ui";
import {AnnouncementsApp} from "@terreno/announcements";

// server.ts
new TerrenoApp({ userModel: User })
  .register(new AnnouncementsApp({
    defaultAcknowledgementPolicy: "dismiss-only",
    isStaff: (user) => user.admin === true,
    matchAudience: (user, a) => mySegmentMatcher(user, a.audience),
  }))
  .start();

// _layout.tsx (after auth)
<AnnouncementNavigator api={terrenoApi}>
  <AppTabs />
</AnnouncementNavigator>
```

## Phases

| Phase | Scope | Deliverable |
|-------|--------|-------------|
| **1 — Package + API** | Models, `AnnouncementsApp`, pending/feed/ack/impression routes, version bump hook, unit tests | `@terreno/announcements` backend complete |
| **2 — Markdown embeds** | YouTube/Loom embed rules in `MarkdownView` + tests | Rich media in announcement body |
| **3 — Consumer UI** | `AnnouncementNavigator`, `AnnouncementScreen`, hooks, tests | `@terreno/ui` integration |
| **4 — Admin UI** | `AnnouncementEditor`, `AnnouncementList`, adminContribution wiring | Admins manage announcements |
| **5 — Example + docs** | example-backend/frontend, SDK regen, reference/how-to docs | End-to-end demo |

Phases 2 and 3 can run in parallel after Phase 1. Phase 4 can start after Phase 1 (admin does not require navigator).

## Feature Flags & Migrations

- **Feature flags:** None. Opt-in via `AnnouncementsApp` registration.
- **Migrations:** New collections only. No changes to existing schemas.
- **Workspace:** Add `announcements/` to root `package.json` workspaces; publish as `@terreno/announcements`.

## Activity Log & User Updates

No Terreno activity-log integration in v1. `AnnouncementAcknowledgement` and `AnnouncementImpression` provide audit/analytics for admins.

## Not Included / Future Work

Surfaces, `audienceType`, per-announcement acknowledgement policy, frequency caps, min build, and CTA click tracking are specified in **[announcements-surfaces.md](announcements-surfaces.md)** (same PR). Remaining later:

- Terreno media upload / CDN for inline images.
- Multi-locale `title` / `body` maps.
- Socket live push when announcements publish.
- Snooze / remind-later.
- A/B variants of announcement content.
- Email digest of changelog.

## Files to Create / Modify

| Area | Files |
|------|--------|
| New package | `announcements/package.json`, `announcements/src/announcementsApp.ts`, `announcements/src/models/*.ts`, `announcements/src/index.ts`, tests |
| UI | `ui/src/AnnouncementNavigator.tsx`, `ui/src/AnnouncementScreen.tsx`, `ui/src/useAnnouncements.ts`, `ui/src/MarkdownView.tsx` (embed rules) |
| Admin | `admin-frontend/src/AnnouncementEditor.tsx`, `admin-frontend/src/AnnouncementList.tsx` |
| Example | `example-backend/src/server.ts`, `example-frontend/app/_layout.tsx`, SDK regen |
| Docs | `docs/reference/announcements.md`, `docs/how-to/product-announcements.md` |
| Root | `package.json` workspaces, root scripts (`announcements:compile`, `announcements:test`) |

## Task List

Executable checklist: **`docs/tasks/announcements.md`**.

## Acceptance Criteria

- [ ] `@terreno/announcements` registers as `TerrenoPlugin` with `adminContribution()`.
- [ ] Admin can create draft, publish, and archive announcements via custom editor.
- [ ] Published `title`/`body` edit bumps `version`; users with old ack see announcement again when ack required.
- [ ] `GET /announcements/pending` respects `matchAudience`, `platforms`, schedule window, and acknowledgement state.
- [ ] `AnnouncementNavigator` shows one modal at a time; children render when queue empty.
- [ ] YouTube and Loom links in markdown render as embeds (web verified).
- [ ] `GET /announcements/feed` returns paginated changelog for in-app “What’s new”.
- [ ] Impression and acknowledgement records persist for admin list views.
- [ ] Example app demonstrates full flow end-to-end.
- [ ] Reference and how-to docs updated in same slice as implementation.
