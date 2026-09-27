# terreno-demo

Interactive Expo app for developing, testing, and showcasing `@terreno/ui` components. Private workspace package — not published to npm.

## Install

From the monorepo root:

```bash
bun bootstrap
```

## Quick start

From the repo root:

```bash
bun run demo:start
```

Or from this directory:

```bash
bun run web
```

The demo serves on **port 8085**. Open the Expo web URL that the CLI prints (typically `http://localhost:8085`).

- **Demo mode** — polished component showcase
- **Dev mode** — raw prop playground (toggle from the header)

## What's included

- `stories/` — one `*.stories.tsx` file per component demo
- `story-config/` — `DemoConfiguration` objects consumed by `demoConfig.tsx`
- `demoConfig.tsx` — registers stories so they appear in the home grid and `[component]` routes
- `app/demo/` — user-facing showcase routes
- `app/dev/` — developer playground routes
- `assets/terreno-garden-banner.png` — two-card-wide banner at the upper-left of the demo grid
- `assets/icon.png`, `adaptive-icon.png`, `favicon.png` — demo checklist branding
- Product announcements (`AnnouncementNavigator`, `AnnouncementBanner`, `AnnouncementScreen`) and in-app notifications (`NotificationBell`, `NotificationInbox`, `NotificationPreferences`) are **not** demoed here — use `example-frontend`
- From the repo root, `bun run check:demo-coverage` fails CI when a `@terreno/ui` export has no story and no allowlist reason
- `bun run --filter terreno-demo test:ci` mounts every registered story with `renderWithTheme`

## Catalog contract

Each story config can set `usageExample` (copyable usage), `related` names that match another
component's `name`, and per-story `showInDemo`, `stability` (`stable` or `exclude` with
`excludeReason`), and `interactions`. Boolean controls without a default use `false`. Number
controls without a default use `0`. Demo mode hides stories with `showInDemo: false`.

## Add a story

1. Create `stories/MyComponent.stories.tsx` with a `React.FC` demo using `@terreno/ui`.
2. Add a `story-config/MyComponent.config.tsx` export (`name`, `interfaceName`, category).
3. Import that config in `demoConfig.tsx` and add it to the exported list.

## Home grid cards must not nest pressables

The home grid renders every story preview inside a card, and the card's press target is an
absolutely positioned sibling that covers the card rather than a wrapper around it. A wrapper
would put one pressable inside another, which on web means `<button>` inside `<button>`. The
HTML parser repairs that by closing the outer button early, so the static-rendered page loses
the rest of the grid out of `#root` and onto `<body>`. `components/DemoCard.test.tsx`
renders every configured card and fails if any pressable ends up inside another.

## Documentation

UI reference: [docs/reference/ui.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/ui.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
