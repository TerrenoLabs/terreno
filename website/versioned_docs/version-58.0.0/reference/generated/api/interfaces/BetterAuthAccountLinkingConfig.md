How a sign-in with a new method relates to an existing account with the same email.
Better Auth's `requireLocalEmailVerified` stays `true` in every mode.

## Properties

### mode

> **mode**: [`BetterAuthAccountLinkingMode`](../type-aliases/BetterAuthAccountLinkingMode.md)

- `verified-email`: a sign-in whose verified email matches an account whose own email is
  verified joins that account.
- `explicit`: no linking at sign-in; a signed-in user links a method themselves.
- `never`: no linking. A same-email sign-in with a new method is refused.

***

### trustedProviders?

> `optional` **trustedProviders?**: `string`[]

Providers Better Auth trusts to own the email they report: their sign-ins link even without
a verified-email claim, and Better Auth also skips the verified-email check for them on an
explicit `/link-social` and its callback. List only providers that prove email ownership
(such as Google for Gmail addresses); a provider that lets users set any email turns this
into an account-takeover path.
