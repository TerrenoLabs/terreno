---
category: Added
---

- `@terreno/syncdb/auth` adds `TerrenoAccountSecurityScreen`, a drop-in account security screen, and `useAccountSecurity`, the hook behind it. It renders `@terreno/ui`'s `AccountSecurityScreen` with the cards the server's `/terreno/methods` turns on: linked providers (linking through the OAuth handoff in bearer mode), the password (change, or set a first one), passkeys (web), two-factor (enrolment returns the backup codes to the card), and signed-in sessions ("Sign out everywhere else" calls `revokeOtherSessions`). Every Better Auth `{error}` becomes the calling card's error, each change reloads only the affected section, the screen never asks the server to remove a user's only sign-in method, `SESSION_NOT_FRESH` reads "Sign in again to manage this.", and a credential row without a password switches the password card to set mode.
- `useAuthMethods` returns `refetch()` for a Try again button and takes `{skip: true}` for callers that already have the methods.
- A link's `?error=`, an error code, or a provider id that matches an `Object.prototype` key (`__proto__`, `constructor`, `toString`) reads as the generic link error or goes unlabelled, instead of crashing the screen with a non-string value.
