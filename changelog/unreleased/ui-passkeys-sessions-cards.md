---
category: Added
---

`@terreno/ui` adds `PasskeysCard` and `SessionsCard` to the account security cards.
`PasskeysCard` lists passkeys with their added and last-used dates and a "Synced" badge for
backed-up ones (an unnamed passkey shows `authenticatorName`, for example from
`getAuthenticatorName(aaguid)`, else "Unnamed passkey"), and adds (with an optional name, `onAdd(name?)`), renames (`onRename(id, name)`)
and removes (confirmed, `onRemove(passkey)`) them; `supported={false}` hides Add and explains that
the device can't create passkeys. `SessionsCard` lists sessions with the browser and OS parsed
from the user agent, location and IP when known, "Signed in" (`createdAt`) and "Last refreshed"
(`updatedAt`, which Better Auth moves only once per `session.updateAge`) as Luxon relative times
that recompute every minute (inject `now` for deterministic output). The current session, matched by `currentSessionId` or
`currentSessionToken`, comes first, is marked "This device", and can't be revoked on its own;
other sessions have Sign out (`onRevoke(session)`), and "Sign out everywhere else"
(`onRevokeOthers()`) asks for confirmation and is disabled when no other session exists. Better
Auth's `listUserPasskeys()` and `listSessions()` items fit the new `AccountPasskey` and
`AccountSession` types as is. Also exported: `parseUserAgent` and `describeUserAgent`, a small
dependency-free user agent parser that also recognizes React Native app clients. The account
security docs and examples now unwrap Better Auth's `{data, error}` results and throw, since the
client does not reject and the cards only show errors from rejected callbacks.
