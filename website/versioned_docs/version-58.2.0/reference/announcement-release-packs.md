# Announcement release packs

An announcement release pack is a reviewable directory containing one manifest and one Markdown file per announcement. Import the pack through `POST /announcements/import-release`; imports are idempotent by product, release version, channel, and announcement slug.

## Directory format

```text
announcements/releases/1.14.0/
  pack.yaml
  staff-required.md
  patient-banner.md
  changelog.md
```

`pack.yaml` carries release metadata, shared defaults, and the ordered file list:

```yaml
schema: terreno.announcement-pack/v1
release:
  product: example
  version: "1.14.0"
  buildNumber: 1842
  channel: production
defaults:
  platforms: [ios, android, web]
  audienceType: all
  displayMode: feed
  acknowledgementPolicy: dismiss-only
  priority: 0
announcements:
  - staff-required.md
  - patient-banner.md
  - changelog.md
```

Each announcement is Markdown with YAML frontmatter:

```markdown
---
slug: staff-1-14-required
title: "Staff: version 1.14.0 is live"
displayMode: modal
audienceType: staff
acknowledgementPolicy: required
priority: 20
primaryAction:
  label: Read the release notes
  url: https://example.com/releases/1.14.0
---

## What changed in 1.14.0

The updated workflow is now available.
```

Frontmatter overrides manifest defaults. Supported fields are:

| Field | Required | Description |
| --- | --- | --- |
| `slug` | Yes | Lowercase, hyphenated stable ID within the release. Re-importing the same slug updates instead of duplicating. |
| `title` | Yes | Surface title. Include the user-facing release version. |
| `displayMode` | No | `modal`, `banner`, or `feed`. |
| `audienceType` | No | `all`, `staff`, or `patient`. |
| `acknowledgementPolicy` | No | `required` or `dismiss-only`. |
| `platforms` | No | Any non-empty subset of `ios`, `android`, and `web`. |
| `priority` | No | Higher values appear first. |
| `minBuildNumber` | No | Per-item override for the release build number. |
| `publishAt`, `expiresAt` | No | ISO 8601 timestamps. |
| `audience` | No | Consumer-defined targeting object. |
| `primaryAction` | No | Object containing `label` and absolute `url`. |

## Versioning

The format has three separate versions:

1. `schema` versions the pack contract. The current value is `terreno.announcement-pack/v1`.
2. `release.version` is the user-facing product version and is stored with each imported announcement.
3. `release.buildNumber` is the client build and becomes `minBuildNumber` unless an announcement overrides it.

The announcement model's numeric `version` is server-managed content revision metadata. Do not put it in a pack. Editing the title or body of an already-published imported announcement increments it and re-shows required content where applicable.

## Example pack

`example-backend/announcements/releases/1.14.0/` is a complete pack with a required staff modal, a patient banner, and a changelog feed item. The example backend ships a loader that parses the pack, validates it with `announcementReleaseImportSchema`, and prints or uploads the JSON body:

```bash
cd example-backend
bun run announcements:pack announcements/releases/1.14.0                  # print JSON
bun run announcements:pack announcements/releases/1.14.0 --upload http://localhost:4000
bun run announcements:pack announcements/releases/1.14.0 --publish --upload <api-url>
```

Uploads use `ANNOUNCEMENTS_UPLOAD_TOKEN`, falling back to the example default `terreno-example-announcement-upload`. Uploads are drafts unless `--publish` is passed.

## Import API

Enable automation with a dedicated secret:

```typescript
new AnnouncementsApp({
  uploadToken: process.env.ANNOUNCEMENTS_UPLOAD_TOKEN,
});
```

The example Cloud Run backend seeds `ANNOUNCEMENTS_UPLOAD_TOKEN` from Terraform (`announcements_upload_token`, default `terreno-example-announcement-upload`). Use that bearer token against the example preview or production URL. Preview deploys use the same default until the secret exists.

Send the parsed manifest and Markdown files as JSON:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ANNOUNCEMENTS_UPLOAD_TOKEN" \
  -H "Content-Type: application/json" \
  --data @announcement-release.json \
  https://api.example.com/announcements/import-release
```

The request shape is:

```json
{
  "release": {
    "product": "example",
    "version": "1.14.0",
    "buildNumber": 1842,
    "channel": "production"
  },
  "defaults": {
    "platforms": ["ios", "android", "web"],
    "displayMode": "feed"
  },
  "announcements": [
    {
      "slug": "changelog",
      "title": "Version 1.14.0",
      "body": "## What changed\n\nRelease details."
    }
  ],
  "publish": false
}
```

`publish` defaults to `false`, so new rows are drafts. Pass `"publish": true` only for an intentional live import. Draft re-imports do not unpublish an existing live announcement. An authenticated admin may also call the endpoint without the dedicated upload token.

The response reports `created`, `updated`, `unchanged`, and `published` counts plus the ID, slug, status, and content version of each row.

The body is validated with the exported Zod schema `announcementReleaseImportSchema` before any row is written. Unknown keys, malformed slugs, empty titles or bodies, invalid enum values, missing `release.product` / `release.version`, and duplicate slugs return **400** `Validation failed` with per-field messages in `meta.fields`. `importAnnouncementRelease` runs the same schema when called directly from server code.
