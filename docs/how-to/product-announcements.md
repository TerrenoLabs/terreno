# Product announcements

Use `@terreno/announcements` on the backend and `AnnouncementNavigator` on the frontend to show admin-managed update surfaces.

## Backend

1. Register the plugin on your `TerrenoApp`:

```typescript
import {AnnouncementsApp} from "@terreno/announcements";

new AnnouncementsApp({
  defaultAcknowledgementPolicy: "dismiss-only",
  uploadToken: process.env.ANNOUNCEMENTS_UPLOAD_TOKEN,
  // audienceType staff/patient/all is applied inside the plugin via matchAudienceByType.
  isStaff: (user) => (user as {admin?: boolean}).admin === true,
  matchAudience: (user, announcement) => {
    const audience = announcement.audience as {organizationIds?: string[]};
    if (!audience.organizationIds?.length) {
      return true;
    }
    const userOrganizationIds = (user as {organizationIds?: string[]}).organizationIds ?? [];
    return audience.organizationIds.some((organizationId) =>
      userOrganizationIds.includes(organizationId)
    );
  },
});
```

Use admin `audienceType` for staff vs patient vs all. Reserve the `audience` JSON field for custom segments (orgs, tiers, feature cohorts) in `matchAudience`. Do **not** call `matchAudienceByType` in your app — the plugin composes it before your callback.

When the admin shell uses Terreno RBAC without the legacy `user.admin` flag, pass the same read permission to the overview:

```typescript
new AnnouncementsApp({
  adminOverviewPermissions: [access.permission({adminAnnouncement: ["read"]})],
});
```

For Flourish-style surfaces on one collection:

| Audience | Typical `displayMode` | `acknowledgementPolicy` |
|----------|----------------------|-------------------------|
| `staff` | `modal` (blocking) | `required` |
| `patient` | `banner` or `feed` | `dismiss-only` |
| `all` | any | per announcement or `defaultAcknowledgementPolicy` |

2. Create announcements in admin (draft → publish). Use `AnnouncementOverview`, `AnnouncementEditor`, and (optionally) `AnnouncementList` from `@terreno/admin-frontend` with dedicated Expo routes (see `example-frontend/app/admin/announcements/`). The built-in admin screen widget key `announcements` renders the overview when your host uses `AdminScreenRouter` for custom screens. Published `title`/`body` edits auto-increment `version`, which re-shows the surface to users who only acknowledged the previous version.

For release-driven batches, use an [announcement release pack](../reference/announcement-release-packs.md). It keeps one `pack.yaml` manifest plus multiple Markdown announcements in source control, validates release and build versioning, and can import idempotent drafts or explicitly publish the whole pack through a dedicated bearer token. The example Cloud Run service accepts `Authorization: Bearer terreno-example-announcement-upload` (Terraform variable `announcements_upload_token`).

### Admin editor fields

`AnnouncementEditor` exposes structured targeting controls (no raw `requiresAcknowledgement` boolean):

| Field | Control | Notes |
|-------|---------|-------|
| `displayMode` | Select | `modal`, `banner`, or `feed` |
| `audienceType` | Select | `all`, `staff`, or `patient` — composed with `matchAudience` |
| `acknowledgementPolicy` | Select | `required` or `dismiss-only`. On **create**, pre-filled from `GET /announcements/config` (`defaultAcknowledgementPolicy`); defaults to `dismiss-only` when config is unavailable |
| `minBuildNumber` | Number (optional) | Minimum client build; cleared with `null` on edit when empty |
| `platforms` | Multiselect | One or more of iOS, Android, and web; at least one is required |
| `audience` | JSON textarea (advanced) | Opaque metadata for `matchAudience`; use audience type for staff/patient/all |

### Admin overview

`AnnouncementOverview` calls `GET /announcements/overview` (via RTK `injectEndpoints`) and shows:

- Launch workflow guidance (draft → targeting → preview → publish) with a primary **Create announcement** action
- Summary cards for published, drafts, impressions, acknowledgements, and CTA clicks
- A paginated table with per-row metrics and an edit action
- Optional quick links to the raw acknowledgement, impression, and click-event admin tables

Register the screen through `AnnouncementsApp.adminContribution()` (`customScreens: [{ name: "announcements", displayName: "Overview", group: "Announcements" }]`) and rely on `ANNOUNCEMENTS_ADMIN_WIDGETS` from `@terreno/admin-frontend` (merged into `BUILT_IN_SCREEN_WIDGETS`). Grouped custom screens appear in the **Announcements** sidebar group before model links; ungrouped screens stay under **Screens**.

`AnnouncementList` remains available for a CRUD-style list; the overview is the launch dashboard.

`AnnouncementEditor` uses `MultiselectField` for platforms and requires at least one platform before save.

<img alt="Announcement overview with delivery metrics" src="/img/announcements/admin-overview.png" />

<img alt="Platform multiselect in the announcement editor" src="/img/announcements/admin-editor-platforms.png" />

## Frontend

Wrap authenticated app content:

```tsx
import {AnnouncementNavigator} from "@terreno/ui";

<AnnouncementNavigator api={terrenoApi}>
  <AppTabs />
</AnnouncementNavigator>
```

Place it after consent/onboarding wrappers if you use `ConsentNavigator`. The navigator sends the native platform (`ios` / `android` / `web`) and, when available, the app build number from `Constants.expoConfig.extra.buildNumber` (same source as `useUpgradeCheck`) on pending and feed requests. Only pending failures block the app — changelog feed errors are non-fatal. These surfaces are not in the `@terreno/ui` component demo; wire them in the app (`example-frontend`) the same way.

## Modal vs banner

| `displayMode` | Navigator behavior |
|---------------|-------------------|
| `modal` | Renders `AnnouncementScreen` and hides children until the announcement is cleared. |
| `banner` | Keeps children mounted and renders `AnnouncementBanner` above them (one interrupt at a time). |
| `feed` | Changelog-only; never shown by `AnnouncementNavigator` even if it appears unexpectedly in `pending.current`. |

`AnnouncementBanner` composes the existing `Banner` component: title text, a dismiss or acknowledgement action, and an optional primary-action button. When used inside `AnnouncementNavigator`, primary CTA presses call `POST /announcements/:id/click` (via `useAcknowledgeAnnouncement().recordClick`) and then open the URL; tracking failures never block navigation.

Acknowledgement policy still resolves to `requiresAcknowledgement` on the public DTO:

| Policy | Banner / modal behavior |
|--------|-------------------------|
| `required` | Primary action is **Got it**, which acknowledges through the existing handler. |
| `dismiss-only` | Dismiss records an impression only. |

Impressions are recorded once per announcement version while the modal or banner is visible.

## Client frequency caps

Interrupt frequency is enforced **client-side** in `AnnouncementNavigator` before a modal or banner is shown. The server still returns the full pending queue; caps never filter `useAnnouncements` feed data.

```tsx
<AnnouncementNavigator
  api={terrenoApi}
  frequency={{
    cooldownHours: 24,
    skipFirstLaunch: false,
    userId: currentUser?.id,
  }}
>
  <AppTabs />
</AnnouncementNavigator>
```

`maxInterruptionsPerSession` defaults to `1` when omitted. The example app sets `skipFirstLaunch: false` so seeded interrupts still appear on first launch.

| Prop | Default | Behavior |
|------|---------|----------|
| `maxInterruptionsPerSession` | `1` | In-memory module session counter. After the cap is reached, pending interrupts are skipped until the JS runtime reloads (cold start / full app restart). Remounting `AnnouncementNavigator` alone does **not** reset the counter. |
| `cooldownHours` | off | When set, skips interrupts if the last shown interrupt was within this many hours. Timestamp is persisted in AsyncStorage when an interrupt becomes visible. |
| `skipFirstLaunch` | `false` | When `true`, the first app launch ever (no `hasLaunched` key) records the flag and skips interrupts for that launch only. |
| `userId` | `"anon"` | AsyncStorage namespace for frequency keys when a signed-in user id is available. |

When a cap applies, the navigator renders children (does not block the app) and does **not** record an impression. AsyncStorage read/write failures fail open with a `console.warn` and allow the interrupt to show. If `hasLaunched` cannot be persisted on first launch, the interrupt is shown and the in-memory first-launch skip is not armed for the rest of the session.

Tests call `resetFrequencySessionStateForTests()` to simulate a cold start; that helper is not part of the production API.

## Media in markdown

Paste YouTube or Loom URLs in the announcement `body` using markdown links or images, for example `[Watch the demo](https://www.youtube.com/watch?v=...)`. `MarkdownView` renders them as embeds (iframe on web, WebView on native). Banner surfaces show the title only; use modal mode or the feed when the full body should be visible.

## Example app

`example-backend` registers `AnnouncementsApp` with `isStaff: (user) => user.admin === true` and an optional `matchAudience` org filter. `bun run backend:seed` idempotently seeds:

- **Staff modal (required)** — `audienceType: "staff"`, `displayMode: "modal"`, `acknowledgementPolicy: "required"` (`Example staff operations bulletin`)
- **Patient banner (dismiss-only)** — `audienceType: "patient"`, `displayMode: "banner"`, `acknowledgementPolicy: "dismiss-only"` (`Example patient care tip`)

The staff launch example is rich markdown with a YouTube embed, overview/editor screenshots, and a tracked docs CTA. Re-running the seed updates that example in place. An existing legacy welcome row (`Welcome to Terreno announcements`) is archived idempotently so it no longer blocks the patient banner. `example-frontend` wraps authenticated users with `AnnouncementNavigator` (`skipFirstLaunch: false`, `userId` from the profile); non-staff users therefore see only the patient banner interrupt under the default session cap of `1`.
