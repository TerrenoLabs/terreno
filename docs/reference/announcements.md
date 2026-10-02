# Announcements reference

`@terreno/announcements` provides admin-managed in-app product update announcements.

## Plugin

```typescript
import {AnnouncementsApp} from "@terreno/announcements";

new TerrenoApp({ userModel: User })
  .register(new AnnouncementsApp({
    defaultAcknowledgementPolicy: "dismiss-only",
    help: {enabled: true},
    isStaff: (user) => user.admin === true,
    matchAudience: (user, announcement) => true,
  }))
  .start();
```

### Plugin options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adminOverviewPermissions` | `PermissionMethod[]` | `IsAdmin` | Access methods for `GET /announcements/overview`; pass the consumer RBAC `adminAnnouncement:read` permission when the admin shell uses RBAC-only users |
| `basePath` | `string` | `"/announcements"` | Mount path for user and admin routes |
| `defaultAcknowledgementPolicy` | `"required" \| "dismiss-only"` | `"dismiss-only"` | Fills omitted per-announcement `acknowledgementPolicy` at read time and pre-fills the admin editor |
| `help.enabled` | `boolean` | `false` | Registers help search/detail routes for MCP and in-app help |
| `matchAudience` | `(user, announcement) => boolean` | always `true` | Opaque audience JSON filter composed with `audienceType` via `matchAudienceByType` |
| `isStaff` | `(user) => boolean` | `user.admin === true` | Staff check used by `matchAudienceByType` for `audienceType` |
| `uploadToken` | `string` | unset | Dedicated bearer token for idempotent `POST /announcements/import-release` automation |
| `permissions` | partial CRUD overrides | admin-only | Overrides default `IsAdmin` permissions on announcement CRUD |

## Acknowledgement policy

Per-announcement `acknowledgementPolicy` controls whether users must acknowledge or may dismiss with an impression only.

| Policy | Pending queue advancement | Public DTO `requiresAcknowledgement` |
|--------|---------------------------|--------------------------------------|
| `required` | User must POST `/acknowledge` for the current `version` | `true` |
| `dismiss-only` | User may dismiss; POST `/impression` clears the item | `false` |

**Resolution order** (pending, feed, help, public DTO):

```
policy = announcement.acknowledgementPolicy
  ?? (legacy requiresAcknowledgement === true ? "required" : undefined)
  ?? defaultAcknowledgementPolicy
  ?? "dismiss-only"
requiresAcknowledgement = policy === "required"
```

Legacy MongoDB documents that still store `requiresAcknowledgement: true` map to `"required"` on read. The boolean field is not part of the schema or admin create/update payloads.

## Models

- **Announcement** — `title`, `body` (markdown), `status` (`draft` | `published` | `archived`), `version`, `priority`, `displayMode` (`modal` | `banner` | `feed`, default `modal`), `audienceType` (`staff` | `patient` | `all`, default `all`), `acknowledgementPolicy`, optional `minBuildNumber`, `audience` (Mixed), `publishAt`, `expiresAt`, `platforms`, `primaryAction`, and optional imported `release` metadata plus `releaseSlug`
- **AnnouncementAcknowledgement** — per-user acknowledgement at a specific `version`
- **AnnouncementImpression** — per-view analytics row
- **AnnouncementClickEvent** — per-click analytics row (`action: "primaryAction"`, `version` at click time, optional `platform`)

Legacy MongoDB documents without `displayMode` or `audienceType` behave as `modal` and `all` at read time.

### `matchAudienceByType`

Exported helper composed with the plugin `matchAudience` callback (both must pass):

```typescript
import {matchAudienceByType} from "@terreno/announcements";

matchAudienceByType({
  user,
  announcement,
  isStaff: (candidate) => candidate.admin === true,
});
// all → true; staff → isStaff(user); patient → !isStaff(user)
```

The plugin applies `matchAudienceByType` before `matchAudience`. When `isStaff` is omitted on `AnnouncementsApp`, it defaults to `user.admin === true`.

## User routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/announcements/pending` | Current interrupt (`modal` or `banner` only) + `remainingCount` (`platform` query: `ios` \| `android` \| `web`; optional `version` build number) |
| GET | `/announcements/feed` | Paginated published changelog — all display modes (`platform` and optional `version` as above) |
| POST | `/announcements/:id/acknowledge` | Record acknowledgement (idempotent per version). Same visibility as pending/feed; **404** when not visible. |
| POST | `/announcements/:id/impression` | Record a view (`{ platform? }`). Same visibility as pending/feed; **404** when not visible. **400** for unknown keys or an invalid `platform`. |
| POST | `/announcements/:id/click` | Record a primary-action click (`{ action: "primaryAction", platform? }`; optional `?version=` for min-build visibility). Returns **404** when not visible (checked before action/CTA validation). **400** when `action` is invalid, `primaryAction` is absent, or an explicit `platform` value is invalid. |

`current` and feed items include resolved `requiresAcknowledgement` (boolean) and `displayMode` derived from policy resolution and stored fields above.

### Query `version`

Optional integer build number on `GET /pending`, `GET /feed`, and help routes. When an announcement has `minBuildNumber` set:

- `?version=9` hides the item when `minBuildNumber` is `10`
- `?version=10` (or higher) shows it
- omitting `version` does **not** hide gated items

`POST /announcements/:id/acknowledge`, `POST /announcements/:id/impression`, and `POST /announcements/:id/click` use the same visibility rules as pending/feed (schedule, expiry, platform, min build, `audienceType`, and `matchAudience`). All three return **404** when the announcement is not visible to the caller, so targeted IDs cannot be confirmed by writing event rows. Impression and click bodies are validated with strict Zod schemas (`{ platform? }` and `{ action: "primaryAction", platform? }`); unknown keys or invalid values return **400** `Validation failed` with per-field messages in `meta.fields`. Click validates `platform` first, then checks visibility before validating `action` and the CTA. Returns **400** when `action` is not `"primaryAction"`, the announcement has no `primaryAction`, or an explicit body `platform` is not `ios` / `android` / `web` (omit `platform` to use query/user-agent resolution). Each click inserts a new row (not idempotent). Acknowledge is idempotent per `(userId, announcementId, version)`.

## Admin routes

Admin CRUD is on `/announcements` via `modelRouter`. Custom actions:

- `GET /announcements/config` — returns `{ data: { defaultAcknowledgementPolicy } }` from the plugin constructor (admin only; defaults to `"dismiss-only"` when omitted). Used to pre-fill the admin editor acknowledgement policy field.
- `GET /announcements/overview` — paginated admin dashboard with per-announcement metrics and aggregate totals. Access uses `adminOverviewPermissions` (defaults to `IsAdmin`). Query: `page` (default `1`), `limit` (default `20`, max `100`).
- `POST /announcements/import-release` — idempotently imports up to 100 announcements keyed by release product/version/channel plus slug. Admin auth or the configured `uploadToken` bearer token is required. New items default to draft; request `publish: true` to publish them. The example deployment's token is `terreno-example-announcement-upload`, seeded by Terraform.
- `POST /announcements/:id/publish` — draft → published
- `POST /announcements/:id/archive` — published → archived

See [Announcement release packs](announcement-release-packs.md) for the Markdown/frontmatter format, JSON request shape, version rules, and draft/live behavior.

### `GET /announcements/overview`

Admin-only list for launch dashboards. Includes **all** lifecycle statuses (`draft`, `published`, `archived`). Soft-deleted announcements and event rows are excluded.

**Query**

| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `page` | `1` | — | 1-based page index |
| `limit` | `20` | `100` | Rows per page |

**Response** `{ data, totals, page, limit, total, more }`

- `data[]` — announcement rows sorted by `priority` desc, then `publishedAt` desc, then `_id` desc (deterministic pagination).
- Each row: `_id`, `title`, `status`, resolved `displayMode`, resolved `audienceType`, resolved `acknowledgementPolicy`, `priority`, `version`, `publishedAt`, `expiresAt` (ISO strings when set), and `metrics: { impressions, acknowledgements, clicks }`.
- Per-row metrics count **all event versions** for that announcement (aggregation grouped by `announcementId`, not N+1 queries).
- `totals` — `announcements`, `published`, `draft`, `archived`, plus global `impressions`, `acknowledgements`, and `clicks` across non-deleted event rows.

**Auth:** `401` unauthenticated; `403` when `adminOverviewPermissions` denies access.

Read-only admin lists: `/announcement-acknowledgements`, `/announcement-impressions`, `/announcement-click-events`.

Terreno RBAC includes `adminAnnouncementAcknowledgement`, `adminAnnouncementImpression`, and `adminAnnouncementClickEvent`. The built-in `admin` role receives read access to these audit models; `superadmin` receives all declared actions.

## Help API (optional)

When `help.enabled` is true, authenticated users can search product update notes for MCP and in-app help. Draft announcements are never exposed. Results respect `matchAudienceByType`, `matchAudience`, `publishAt` / `expiresAt`, optional `?version=` min-build gating, and the same visibility rules as `/pending`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/announcements/help/search` | Search published notes (`q`, `limit`, `includeArchived`) |
| GET | `/announcements/help/:id` | Full update note by Mongo id (`includeArchived`) |

`includeArchived=true` includes `archived` announcements alongside `published`. Omit it (default) to search only published notes.

## MCP integration

`@terreno/mcp` exposes three optional tools that search bundled `@terreno/*` upgrade markdown and, when configured, announcement help routes on your backend:

- `terreno_search_update_notes` — keyword search; returns summaries with ids
- `terreno_get_update_note` — full note by id (`upgrade:<semver>` or `announcement:<mongoId>`)
- `terreno_ask_update_help` — natural-language question with ranked matches and full bodies

Set these environment variables on the MCP server to include live announcements:

| Variable | Description |
|----------|-------------|
| `TERRENO_HELP_API_URL` | Backend base URL (e.g. `http://localhost:4000`) |
| `TERRENO_HELP_API_TOKEN` | Optional Bearer token for authenticated help routes |

## Consumer UI

`@terreno/ui` exports `AnnouncementNavigator`, `AnnouncementScreen`, `AnnouncementBanner`, `useAnnouncements`, and `useAcknowledgeAnnouncement`. These are app-level product surfaces — they are not registered in the isolated UI component demo. Wire them in a consumer app (`example-frontend`) with a real API.

- Pending and feed requests send the current client platform (`ios`, `android`, or `web`) and, when available, the app build number from `Constants.expoConfig.extra.buildNumber` (same source as `useUpgradeCheck`).
- `requiresAcknowledgement` on pending/feed items is resolved server-side from `acknowledgementPolicy` and `defaultAcknowledgementPolicy`; the navigator trusts that flag.
- Feed failures do not block the modal queue — only pending errors surface in `AnnouncementNavigator`.
- Markdown bodies support YouTube and Loom embeds via `MarkdownView`; ordinary links open with `Linking.openURL`.

### `useAcknowledgeAnnouncement`

Injects RTK Query mutations for acknowledgement, impression, and primary-action click tracking:

| Method | Route | Notes |
|--------|-------|-------|
| `acknowledge(id)` | `POST /announcements/:id/acknowledge` | Invalidates pending queue. Query includes `platform` and, when available, `version` (same visibility gate as pending/feed). |
| `recordImpression(id)` | `POST /announcements/:id/impression` | Sends current `platform` in body |
| `recordClick(id)` | `POST /announcements/:id/click` | Body `{ action: "primaryAction", platform }`; query includes `platform` and, when available, `version` (same visibility gate as pending/feed) |

`AnnouncementNavigator` wires `onPrimaryAction` for modal and banner surfaces: it calls `recordClick` once per primary CTA press (only when `primaryAction` is present), then opens the URL with `Linking`. Click POST failures log `console.warn` and do not block navigation. Standalone `AnnouncementScreen` / `AnnouncementBanner` usage without `onPrimaryAction` still opens the URL directly.
