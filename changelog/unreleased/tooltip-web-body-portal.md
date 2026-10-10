---
category: Fixed
---

`Tooltip` on web no longer mounts a full-screen layer over the app while it is open.
The bubble now renders into `document.body` with `position: fixed` instead of through
the `PortalHost` layer, so nothing covers the page and the content below stays
clickable. Web tooltips also use `zIndex: 9999`, matching the body-level overlays
(`Modal`, `DropdownPanel`), so tooltips inside a modal show on top of it. Native keeps
the `PortalHost` path.
