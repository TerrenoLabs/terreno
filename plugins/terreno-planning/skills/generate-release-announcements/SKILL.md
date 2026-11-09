---
name: generate-release-announcements
description: >-
  Generate, validate, and optionally upload a multi-announcement Markdown release
  pack for @terreno/announcements. Use when asked to announce a product release,
  turn release notes or a Linear Release into in-app announcements, create an
  announcement pack, or upload release announcements as drafts or live.
targets:
  - '*'
---

# Generate release announcements

Create a source-controlled `terreno.announcement-pack/v1` directory from release notes. Human reference: `docs/reference/announcement-release-packs.md` in Terreno or the published Terreno announcement release-pack reference.

## 1. Collect the release

Determine:

- product identifier
- user-facing version
- client build number when one exists
- channel (`production` unless the user names another)
- release notes source: provided text/file, GitHub release/tag, changelog range, or Linear Release

For a Linear URL, use the available Linear connector to read the release and completed issues. If Linear is unavailable, stop only that source lookup and ask for the exported release notes; do not invent issue contents.

The collection step is complete when every feature, fix, breaking change, and operator action in the source is accounted for or explicitly excluded.

## 2. Choose the surfaces

Generate one or more focused announcements rather than copying raw issue lists:

1. Always create a `feed` changelog containing the complete user-relevant release.
2. Create a `modal` only for required action, breaking workflow, or high-impact staff rollout.
3. Create a `banner` for a short, non-blocking user-facing highlight.
4. Split staff and patient/user copy when their actions or vocabulary differ.

Default to `dismiss-only`. Use `required` only when the reader must take an action or confirm operational information.

The surface step is complete when each item has one audience, one purpose, and a title containing the release version.

## 3. Write the pack

Create:

```text
announcements/releases/<version>/
  pack.yaml
  <one-or-more-slugs>.md
```

Write `pack.yaml`:

```yaml
schema: terreno.announcement-pack/v1
release:
  product: <product>
  version: "<version>"
  buildNumber: <positive integer; omit when unknown>
  channel: production
defaults:
  platforms: [ios, android, web]
  audienceType: all
  displayMode: feed
  acknowledgementPolicy: dismiss-only
  priority: 0
announcements:
  - changelog.md
```

Each listed file uses YAML frontmatter plus Markdown:

```markdown
---
slug: changelog
title: "Version <version>"
displayMode: feed
audienceType: all
acknowledgementPolicy: dismiss-only
---

## What changed in <version>

<reader-focused release copy>
```

Frontmatter may override `platforms`, `priority`, `minBuildNumber`, `publishAt`, `expiresAt`, `audience`, and `primaryAction` (`label` plus absolute `url`). The release build number becomes `minBuildNumber` unless an item overrides it.

Do not write the server-managed numeric announcement `version`; that is a content revision, not the product release version.

The writing step is complete when every manifest file exists and every body is useful without reading another announcement.

## 4. Validate

Fail before upload when any check fails:

- manifest `schema` is exactly `terreno.announcement-pack/v1`
- product and release version are non-empty
- build number, when present, is a positive integer
- every listed Markdown file exists exactly once
- every item has a unique lowercase hyphenated `slug`, a title, and a non-empty body
- enum values match the announcement reference
- platforms are non-empty
- timestamps are ISO 8601 and primary-action URLs are absolute
- required modals state the required action clearly

Print the product, release version, build number, channel, item count, and a table of slug/surface/audience/policy. The validation step is complete only when all checks pass.

## 5. Optionally upload

Do not upload unless the user asked for API posting. Convert manifest defaults and each file's frontmatter/body into the JSON request documented by `POST /announcements/import-release`.

Use:

- API base URL from the user or app configuration
- token from `ANNOUNCEMENTS_UPLOAD_TOKEN` unless the user names another environment variable
- `Authorization: Bearer <token>`
- `"publish": false` by default

Write request JSON to a temporary file outside the repository, then:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ANNOUNCEMENTS_UPLOAD_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/terreno-announcement-release.json \
  "$API_URL/announcements/import-release"
```

Never print the token or commit the temporary JSON.

Set `"publish": true` only when the user explicitly says `live`, `publish`, or equivalent. Before a live upload, show the validated item table and require confirmation unless the original unattended task explicitly authorized live publication. A normal request to “upload” means drafts.

The upload step is complete when the API reports every item as created, updated, or unchanged. Report returned IDs and statuses. Delete the temporary JSON.

## Completion

Return:

- pack directory
- product version and build number
- generated item count and surfaces
- validation result
- upload result (`not requested`, `draft`, or `live`)
