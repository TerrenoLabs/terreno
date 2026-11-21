# Show release notes with WhatsNewBanner

Use `WhatsNewBanner` from `@terreno/ui` to tell people about a new release without blocking
them. The banner reads "What's new in 57.16.2" until the viewer opens or dismisses it, then
stays hidden until a newer release is listed. Use it instead of a required announcement modal
for routine release notes.

## Add the banner

1. Build a list of releases, newest first. Each entry has a `version`, Markdown `body`, and
   an optional `date`:

   ```typescript
   import type {WhatsNewRelease} from "@terreno/ui";

   export const RELEASES: WhatsNewRelease[] = [
     {body: "### Fixed\n\n- Exports finish on slow networks.", date: "2026-10-13", version: "2.4.1"},
     {body: "### Added\n\n- Bulk-complete todos.", date: "2026-10-01", version: "2.4.0"},
   ];
   ```

2. Render it near the top of a screen people see after signing in:

   ```tsx
   import {WhatsNewBanner} from "@terreno/ui";

   <WhatsNewBanner releases={RELEASES} testID="home-whats-new-banner" />
   ```

3. Open the app. The banner shows the latest version and how many earlier releases the viewer
   has not seen. **See what's new** opens a modal with the notes for every unseen release.

The last seen version is stored on the device under `@TerrenoUI:whatsNew:lastSeenVersion`.
Pass `storageKey` to keep separate histories, for example one per product.

## Generate releases from CHANGELOG.md

The example app builds its list from the repository changelog, so every release appears in the
banner without hand edits:

- `bun run whats-new:generate` writes the 10 most recent `CHANGELOG.md` releases to
  `example-frontend/constants/whatsNew.generated.json`. Repo-relative links and `(#123)` pull
  request numbers become GitHub URLs.
- `bun run changelog:assemble <version>` regenerates that file when it cuts a release.
- `bun run check:whats-new` fails when the file does not match `CHANGELOG.md`. CircleCI runs it
  in the lint job, next to `check:changelog`.

`example-frontend/constants/whatsNew.ts` types the JSON as `WhatsNewRelease[]`, and
`SyncTodosScreen` renders the banner above the todo list.

## When to use announcements instead

`WhatsNewBanner` is static and per device. Use [product announcements](./product-announcements.md)
when you need audience targeting, required acknowledgement, scheduling, or analytics. Props are
listed in the [UI reference](../reference/ui.md#whatsnewbanner).
