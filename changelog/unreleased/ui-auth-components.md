---
category: Added
---

`@terreno/ui` adds `AccountSecurityScreen`, a security settings screen composed from the account
security cards. Pass each card's props as one object (`linkedAccounts`, `password`, `passkeys`,
`twoFactor`, `sessions`); a card renders only when its object is given, so a feature the server
has off hides its card. Cards appear in a fixed order (sign-in methods, then passkeys, two-factor
and sessions) in one centered column up to `maxWidth` (720px by default), under a "Security"
heading with optional `description` and `header`. `isLoading` shows a spinner, `error` shows a
page-level alert with Try again (`onRetry`), and `children` add app-specific content after the
cards. The screen wraps itself in a scrolling `Page`; pass `withPage={false}` to place it inside
your own `Page` or `ScrollView`. Also exported: the `AccountSecurityScreenProps` type.

`Heading` gains an optional `level` (1–6): with it, the heading renders `role="heading"` and
`aria-level` (an `<h1>`–`<h6>` on web, the header accessibility role on native); without it,
output is unchanged. The account security cards' titles are now level 2 headings and the screen
title level 1. Below the desktop floor (`isSupportedDesktopWidth`), `Card` and
`AccountSecurityScreen` draw edge to edge.
