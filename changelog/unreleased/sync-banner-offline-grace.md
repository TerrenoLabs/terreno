---
category: Changed
---

`@terreno/ui`: `SyncStatusBanner` no longer flashes "Offline" while the sync socket first connects or during brief drops. The badge appears only after `isOnline` stays false for `offlineGraceMs` (default 3000 ms) and hides as soon as the client reconnects. Pass `offlineGraceMs={0}` to show it immediately, as before.
