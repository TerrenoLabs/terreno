---
category: Added
---

`@terreno/ui` adds `LinkedAccountsCard` and `PasswordCard`, the first account security cards.
`LinkedAccountsCard` shows one row per linked account (so two Google accounts are each
unlinkable) with its email and linked date, and a Link row for each offered provider without
one. Unlink asks for confirmation and calls `onUnlink(providerId, account)`; pass `account.id`
(Better Auth's account row id) to `unlinkAccount({accountId})`. The acting row shows a spinner
while `onLink` or `onUnlink` runs, and Unlink is disabled with an explanation when it would
remove the user's last sign-in method (the `credential` password account and
`otherMethodCount` count; `canUnlinkLast` opts out). `PasswordCard` shows "Change password"
(current, new, confirm, optional "Sign out of other devices" sent as `revokeOtherSessions`) or
"Set a password" for provider-only users, with inline length and confirmation errors, focus on
the first invalid field plus an alert summary, Enter to submit, and a promise-based `onSubmit`.
Also exported: the `LinkedAccount` (`linkedAt` accepts a `Date` or ISO string),
`LinkableProvider` and `PasswordCardSubmission` types, `CREDENTIAL_PROVIDER_ID`, and
`hasPasswordCredential(accounts)`.
