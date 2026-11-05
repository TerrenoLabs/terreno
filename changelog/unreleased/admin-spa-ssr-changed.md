---
category: Changed
---

The admin comms dashboard's default 7-day range now ends at the next whole minute, so a server render and the hydrating browser request the same URL.

`useAdminRpcQuery` treats the request's `X-Organization-Id` as part of its key. When the selected organization changes on the same URL, it drops the previous organization's data and loads again, even with `keepPreviousData`, so one organization's rows never show under another.

`useAdminModelApi`'s `useReadQuery` builds its URL with `buildAdminReadUrl`, which encodes the id.
