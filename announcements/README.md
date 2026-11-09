# @terreno/announcements

In-app product update announcements for Terreno backends.

## Install

```bash
bun add @terreno/announcements
```

Peer dependency: `mongoose ^8.0.0 || ^9.0.0`. `@terreno/api` is required at runtime.

## Quick start

```typescript
import {AnnouncementsApp} from "@terreno/announcements";
import {TerrenoApp} from "@terreno/api";

new TerrenoApp({userModel: User})
  .register(
    new AnnouncementsApp({
      defaultAcknowledgementPolicy: "dismiss-only",
      help: {enabled: true},
      isStaff: (user) => user.admin === true,
      matchAudience: (user, announcement) => true,
    })
  )
  .start();
```

Wrap authenticated app content with `AnnouncementNavigator` from `@terreno/ui` on the frontend.

## What's included

- `AnnouncementsApp` — user routes (`/pending`, `/feed`, acknowledge, impression, click) plus admin CRUD
- Optional help API for MCP and agent search (`/announcements/help/*`)
- First-class `audienceType` (`staff` | `patient` | `all`) composed via exported `matchAudienceByType` and optional `isStaff`
- Custom segments via `matchAudience` and opaque `audience` JSON on each announcement
- Per-announcement `acknowledgementPolicy` with consumer `defaultAcknowledgementPolicy`
- Platform targeting (`ios`, `android`, `web`) with user-agent fallback when `platform` is omitted

## Documentation

- Reference: [docs/reference/announcements.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/announcements.md)
- How-to: [docs/how-to/product-announcements.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/product-announcements.md)
- Implementation plan: [docs/implementationPlans/announcements.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/announcements.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
