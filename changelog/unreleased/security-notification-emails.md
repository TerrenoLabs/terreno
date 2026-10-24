---
category: Added
---

- `AccountSecurityApp` emails the affected user about every security action, admin and
  self-service.
  - Each email says who acted ("you" or "an administrator", never the admin's name), when, and how
    to get help.
  - It names the org only with `notifications.includeOrgName: true` (default `false`), and never
    includes tokens, links, passkey names, or other secrets.
  - Mail goes out only when `sendMail` is configured. `notifications: {enabled: false}` turns it
    off, and `notifications.sendMail` supplies a mailer outside `TerrenoApp`.
  - `notifications.throttleMinutes` (default 10) sends at most one email per user, template,
    origin (self or admin), and org per window, so an admin action is never hidden behind the
    user's own change.
  - A failed delivery is logged and never fails the action.
  - `send-password-reset` sends no extra email, because its reset mail is the notice.
    `issue-sign-in-link` tells the user a link was created, without the link.
  - The newest registered `AccountSecurityApp` owns the emails, so two apps in one process never
    email twice. `unsubscribeNotifications()` stops them.
- `createBetterAuth` records the user's own security changes as security actions with
  `origin: "self"`, written as `AuditEvent`s when `AuditApp` is registered.
  - Recorded: a provider linked or unlinked, a passkey added or removed, two-factor turned on or
    off, a password changed or reset with a link, and other sessions signed out.
  - Two-factor changes are read from the database, not the cookie-cached session.
  - The new action ids are `password-reset` and `other-sessions-revoked`.
- The emails render with a built-in renderer. `BetterAuthConfig.renderAuthMail` is not used for
  them; opt in to a custom renderer with `notifications.render`. `BetterAuthConfig.authMailTemplates`
  accepts the new `security*` ids as overrides.
- `@terreno/comms` `renderAuthMail` renders the `security*` template ids (subject, text, and HTML),
  so it can be passed as `notifications.render`. It takes optional `data`, `token` is now optional,
  and HTML bodies get HTML-escaped values.
