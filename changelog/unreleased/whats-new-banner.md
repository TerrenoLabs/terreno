---
category: Added
---

- `WhatsNewBanner` in `@terreno/ui` shows non-blocking release notes, such as "What's new
  in 57.16.2", until the viewer opens or dismisses it, then hidden until a newer release. See
  [Show release notes with WhatsNewBanner](docs/how-to/whats-new-banner.md).
- The example app's what's new banner lists the 10 most recent `CHANGELOG.md` releases.
  `bun run whats-new:generate` writes them, `changelog:assemble` refreshes them on each
  release, and CI fails through `bun run check:whats-new` when they are stale.
- `BannerButton` accepts an optional `testID`.
