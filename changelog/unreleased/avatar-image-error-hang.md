---
category: Fixed
---

`Avatar` no longer freezes release builds when its image fails to load. The image error handler passed the native error event to `console.warn`, and with Sentry enabled the app hung while turning that event into a breadcrumb. It now logs only the error message.
