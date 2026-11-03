Whether new users can create accounts.

## Properties

### mode

> **mode**: `"closed"` \| `"open"`

- `open` (default): anyone can sign up.
- `closed`: email sign-up is refused, and a social or generic OAuth sign-in for an unknown
  email fails with `signup_disabled`, even with `requestSignUp: true`.

`closed` covers email and password, `socialProviders`, and every OAuth provider in Better
Auth's provider list (including `genericOAuth` ones from `plugins`). Other sign-in plugins
added through `plugins` (`magicLink`, `emailOTP`, `phoneNumber`, `anonymous`, ...) create
users on their own terms and need their own `disableSignUp` (or equivalent) option. With
`oauthProxy`, a preview's OAuth sign-in is finished by the production server, so it follows
the production server's sign-up mode: give both the same `signUp.mode`.
