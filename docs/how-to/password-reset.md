# Password reset and email verification

Wire JWT recovery routes and Better Auth to `@terreno/comms` mail, then add a reset screen.

## 1. User schema

1. Apply `emailVerificationPlugin` so `emailVerified` defaults to false.
2. Add `tokenEpoch` (number, default 0) so password reset can invalidate refresh tokens.

```typescript
import {emailVerificationPlugin} from "@terreno/api";

userSchema.plugin(emailVerificationPlugin);
```

## 2. JWT `authOptions`

Set `publicAppUrl` and `sendMail`. Forgot-password always returns 202.

```typescript
authOptions: {
  publicAppUrl: process.env.FRONTEND_URL || "http://localhost:8082",
  // Set false if the host already owns POST /resetPassword.
  legacyResetPasswordRoute: false,
  sendMail: async (message) => {
    await getCommsService().sendMail(message);
  },
  requireEmailVerification: false,
}
```

| Action | Path | Body |
| --- | --- | --- |
| Forgot | `POST /auth/forgotPassword` | `{email}` → 202 |
| Reset | `POST /auth/resetPassword` or `POST /resetPassword` | `{token, password}` or `{token, newPassword}` |
| Send verify | `POST /auth/sendVerification` | authenticated → 202 after delivery; 501 if `publicAppUrl` is missing |
| Verify | `POST /auth/verifyEmail` | `{token}` |

Recovery routes default on for compatibility. Set `authOptions.passwordReset: false` to omit
both password-reset routes and forgot-password. Set `authOptions.emailVerification: false` to
omit both verification routes. Set `authOptions.legacyResetPasswordRoute: false` when the host
owns `POST /resetPassword`; `POST /auth/resetPassword` remains registered.

Reset links: `${publicAppUrl}/resetPassword?token=...`. Verify links: `${publicAppUrl}/verifyEmail?token=...`.

Set `requireEmailVerification: true` to return 403 `email-not-verified` on JWT login until verify succeeds. Signup still returns JWTs and sends the verify mail.

## 3. Comms templates

```typescript
import {renderAuthMail} from "@terreno/comms";

const mail = renderAuthMail({
  publicAppUrl: "https://app.example.com",
  templateId: "resetPassword",
  token,
});
```

Pass `templates` to override subject/text/html. Variables: `resetUrl`, `verifyUrl`, `publicAppUrl`, `token`.

## 4. Better Auth

On `BetterAuthConfig` set the same `publicAppUrl`, `sendMail`, and `renderAuthMail` from `@terreno/comms`. That wires `sendResetPassword` and `sendVerificationEmail` to those templates. Those hooks do not send (they throw 501) when `publicAppUrl` is empty.

## 5. Frontend

1. Pass `onForgotPassword` (or `onForgotPasswordPress`) to `LoginScreen`.
2. Add `/forgotPassword` (email form) and `/resetPassword` that reads `token` from the query string.
3. On Better Auth apps, request reset with `authClient.requestPasswordReset` and submit with `authClient.resetPassword({newPassword, token})`. JWT apps use `POST /auth/forgotPassword` and the RTK `resetPassword` mutation (`POST /resetPassword`). The example app falls back to the JWT request or reset route when Better Auth rejects the operation, so either auth mode can complete.
4. Show a profile banner when `emailVerified` is false, with Resend calling `POST /auth/sendVerification`.
5. Add `/verifyEmail` that reads `token` from the query string. JWT apps call `POST /auth/verifyEmail`. Better Auth apps try `GET /verify-email?token=...` first, then the JWT route so either token type can complete.

A new `issueFor` for the same user and type invalidates earlier unused tokens of that type. Changing the mailbox through `PATCH /auth/me` invalidates unused `passwordReset` tokens even when the User schema has no `emailVerified` field. When `emailVerificationPlugin` is applied, mailbox change also sets `emailVerified` to false and invalidates unused `emailVerification` tokens. Letter casing alone does not count as a mailbox change. `emailVerified` and `tokenEpoch` are privileged user fields: signup and `PATCH /auth/me` drop them.

Better Auth password reset revokes that user's Better Auth sessions (`revokeSessionsOnPasswordReset`) and, when an app User exists, updates the JWT password and `tokenEpoch` so `POST /auth/login` cannot keep the old passport hash. JWT `POST /auth/resetPassword` does the reverse for Better Auth when `BetterAuthApp` is registered: it updates the Better Auth password and deletes Better Auth sessions. Console mail in development prints length only; check `CommsMessage` / console adapter logs for delivery, not the raw token in logger output. Request logs redact `password`, `newPassword`, `oldPassword`, `token`, and `refreshToken` in bodies and in URL query strings.
