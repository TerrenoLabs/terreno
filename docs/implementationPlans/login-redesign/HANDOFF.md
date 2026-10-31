# Login screen redesign — build handoff

**Repo:** `TerrenoLabs/terreno`, branch `auth-experience` (PR #1613)
**Design canvas:** https://claude.ai/artifact/4AExCVaPYePwyRym9twPsn (12 boards; static HTML copies are in `boards/` next to this file)
**Scope:** visual and layout changes to the login flow in `@terreno/ui` and `@terreno/rtk`. No API, auth-logic or server changes.

Build everything with existing `@terreno/ui` primitives (`Box`, `Text`, `Heading`, `Button`, `TextField`, `Banner`, `Avatar`, `Icon`, `IconButton`, `Badge`, `Spinner`) and theme roles. Never hard-code hex values; the boards use raw hex only because they are static mockups. The role each color maps to is listed under "Tokens" below.

---

## 1. What is wrong today (current `ui/src/login/LoginScreen.tsx`)

1. Up to three section dividers ("Or sign in another way", "Or log in with email", "Or continue with") on one screen.
2. The passkey button is stranded at the very bottom, below "Sign up".
3. The `error` text renders under the password field even when the failure came from a social button at the top ("Auth cancelled").
4. Each remembered account is its own bordered card with a grey "Forget" pill button and a third "Uses Apple" line.
5. `LastUsedBadge` floats right-aligned *above* the button it labels.
6. Social buttons are three different fills (black, white, near-black).
7. "Forgot password?" is a `muted` pill button and "Need an account? Sign Up" is a full-width outline button, so secondary actions look like primary ones.

---

## 2. Target layout

Mobile-first, centered column, `maxWidth={400}`, screen padding `spacing4` horizontally. Vertical rhythm: `gap={6}` (24px) between blocks, `gap={3}` (12px) inside a button stack, `gap={4}` (16px) between form fields.

Order, top to bottom (each block only renders when it applies):

1. **Logo** (`logo` prop, unchanged).
2. **Heading block** — `Heading size="xl"` + one line of `Text color="secondaryLight"` subtitle.
   - With continue-as accounts: "Welcome back" / "Pick up where you left off."
   - Without: "Sign in" / "Choose how you want to sign in."
   - Add a `subtitle?: string` prop; keep `title` overridable. Default titles above replace "Welcome Back".
3. **Feedback banner** — the single place for `notice` *and* `error` (see §4). Never under a field, except field-level errors (§4.3).
4. **Continue-as list** (§3.1), if there are accounts.
5. **Methods**:
   - With accounts: collapsed behind one `Button variant="muted" fullWidth text="Sign in another way"`. Pressing it expands, in place, a divider "or sign in another way" followed by the method stack and the email form. (Local `useState`; reset to collapsed on unmount.)
   - Without accounts: always expanded.
6. **Method stack** — every social provider, generic provider and passkey as identical full-width outline pills (§3.2), in this order: last-used method first, then branded providers in their given order, then generic providers, then passkey.
7. **One divider** — "or use your email" (only when there is a form *and* at least one method above it).
8. **Email form** — fields, then the primary submit. "Forgot password?" is a text link on the password field's label row (§3.3).
9. **Footer** — pushed to the bottom: `Text`: "New here? " + link "Create an account" (`onSignUpPress`). Not a button.

There is never more than **one visible divider** above the form (two total in the expanded returning state: one before methods, one before email).

---

## 3. Components

### 3.1 Continue-as list (rewrite `LoginAccountCard.tsx`, add a list wrapper)

- Section header row: `Heading size="sm"` "Continue as" on the left; text link "Edit" on the right (only when `onForget` is set and at least one remembered account exists).
- One container: `border="default"`, `rounding="lg"` (16px), `overflow hidden`. Rows separated by a 1px `border-hover` top border, no per-row borders.
- Row (whole row is the `Pressable`, min height 68, padding `spacing3`/`spacing4`):
  - `Avatar size="sm"` (40px) or the `circle-user` icon fallback.
  - Line 1: name, `Text bold`, truncate; if this account's method equals `lastUsedMethod`, an inline "Last used" pill right after the name (§3.4).
  - Line 2 (`size="sm" color="secondaryLight"`): provider icon (12px, brands set: `apple`/`google`/`github`; `key` for passkey; `envelope` for email) + "`{Provider} · {masked email}`". For a session row: green presence dot + "Signed in · {email}".
  - Trailing `chevron-right` icon, `color="secondaryLight"`.
  - Remove the "Uses Apple" line and the "Forget" button from the row.
- **Edit mode** (new local state, header link toggles "Edit" ↔ "Done"):
  - Header text becomes "Accounts on this device".
  - Rows stop being pressable; chevron is replaced by a `Button variant="ghost"` with `text="Remove"` in error text color, 44px touch height, `accessibilityLabel="Remove {name}, {Provider}, from this device"`. Calls `onForget`.
  - Session rows show `Text size="sm" color="secondaryLight"` "Can't remove" instead (sessions were never forgettable — keep that rule).
  - Under the list: `Text size="sm" color="secondaryLight"`: "Removing an account only forgets it on this device. It doesn't sign you out anywhere else or delete the account."
  - If the last remembered account is removed, exit edit mode automatically.
- Keep testIDs: `${testID}-continue-${index}` on each row; `${testID}-forget-${index}` moves to the Remove button. Add `${testID}-accounts-edit`.

### 3.2 Method buttons (`OAuthButtons` / `SocialLoginButton`)

- Use `SocialLoginButton variant="outline"` for every provider (Apple, Google, GitHub) — it already exists. Do not use the black/`#24292e` fills on the login screen.
- Icons: monochrome, `text.primary`, 18px, pinned left at 20px inside the pill; label centered. Height 48, `radius3xl`.
- Passkey: same style, `iconName="key"`, "Sign in with a passkey". It lives in the method stack, never below the form.
- Generic providers: same style; use their icon if provided, else none.
- `OAuthButtons` currently draws its own divider (`dividerPosition`/`dividerText`). On the login screen pass `dividerPosition="none"`; `LoginScreen` owns the single divider.

### 3.3 Email form

- `TextField` titles: "Email", "Password". Email placeholder "you@example.com"; password has no placeholder.
- "Forgot password?" → text link (`Text`/`Link` in `text.link`, bold, 14px) right-aligned on the same row as the Password label. If `TextField` cannot take a label accessory, render the label row yourself above a title-less `TextField` and keep `accessibilityLabel`.
- Submit: `Button variant="primary" fullWidth` text **"Sign in"** (was "Log In"). `loading` shows the spinner inside the button with text "Signing in"; all fields and other buttons `disabled`; wrap the screen with `aria-busy`.
- Keep the `FormContainer`, Enter-moves-focus and autofill behaviour from this PR untouched.

### 3.4 "Last used" pill (replace `LastUsedBadge.tsx`)

- Inline pill, not a stacked badge: `Text size="sm" bold`, `color="secondaryDark"`, background `surface.secondaryExtraLight`, 1px border `surface.secondaryLight`, `radius3xl`, padding 2×8.
- On a method button: absolutely positioned on the right inside the pill, and the button itself gets `surface.secondaryExtraLight` fill with a 2px `surface.secondaryLight` border. The button also moves to the top of the stack (existing behaviour).
- On an account row: inline after the name.
- Email last used: pill on the "Email" label row instead of above the fields.
- Keep the testIDs `${testID}-last-used-${method}` and the `withLastUsedLabel` accessibility label.

### 3.5 Continue as an email account (password-only step)

When a remembered/ session account with `method === "email"` and a usable email is tapped (today `useLoginController` just sets `initialValues`):

- Replace the whole screen body with:
  - Top-left back link: `chevron-left` + "All sign-in options" (returns to the list, clears the prefill).
  - `Heading` "Enter your password".
  - Identity chip: `Box` with `surface.secondaryExtraLight` fill, 1px `surface.secondaryLight` border, `rounding="lg"`: avatar, name (bold), email (`sm`, secondaryLight), trailing "Not you?" link (same action as back).
  - Hidden email input with `autocomplete="username"` so password managers still pair correctly; visible password field autofocused; "Forgot password?" on its label row; "Sign in" primary button.
  - Footer unchanged.
- Implement as a `step` in `LoginScreen` (e.g. a new optional prop `continuingAccount?: LoginAccountOption` + `onCancelContinue?: () => void`), set by `useLoginController` instead of only `initialValues`. Fall back to today's info notice when the account has no usable email.

---

## 4. Feedback

### 4.1 Placement
`notice` and `error` both render as a banner directly under the heading block, above accounts and methods. Remove the `<Text color="error">` under the fields. Only one banner at a time; `notice` wins if both are set.

### 4.2 Banner styles (extend `NoticeBox`, or use `Banner` if it can take a title and an action)

| Tone | Fill | Border | Icon (left, 20px) | Text |
|---|---|---|---|---|
| info | `surface.secondaryExtraLight` | `surface.secondaryLight` | `circle-info`, `text.secondaryDark` | `text.secondaryDark` |
| warning | `surface.warningLight` | `border.warning` | `triangle-exclamation`, `text.warning` | `text.primary` |
| error | `surface.errorLight` | `border.error` | `circle-exclamation`, `text.error` | `text.primary` |

- `rounding="lg"`, padding `spacing3`/`spacing4`, 16px text.
- Optional bold title line (add `title?: string` to `LoginNotice`).
- Optional action: small outline pill button under the text (`actionLabel`/`onAction`, already in the type).
- Info banners are dismissible (`IconButton` "xmark", `accessibilityLabel="Dismiss"`); warnings/errors are not.
- `role="status"` for info, `role="alert"` for warning/error.

### 4.3 Copy and which tone (edit `rtk/src/auth/loginErrors.ts` and `useLoginController.ts`)

| Situation | Tone | Title | Text | Action |
|---|---|---|---|---|
| Social sign-in cancelled by the user (today: "Auth cancelled") | info | — | "{Provider} sign-in was cancelled. Tap an account to try again." (no accounts: "…Try again or choose another way.") | — |
| `account_not_linked`, mode `explicit` | warning | "You already have an account" | "That email is already used with {originalMethod}. Sign in with {originalMethod}, then link {Provider} from Security." | "Sign in with {originalMethod}" (focuses that method / email field) |
| `account_not_linked`, mode `never` | warning | "You already have an account" | "That email already has an account. Sign in with {originalMethod} instead." | same |
| `account_not_linked`, `verified-email` | warning | "Verify your email first" | keep current text | — |
| Verify email / linking disabled / sign-up closed | warning | short noun title | keep current text | existing |
| Provider not found / generic failure | error | — | keep current text | — |
| Wrong email or password | **field error**, not a banner | — | "That password doesn't match. Try again or reset it." under the password field; field gets a 2px `border.error`, `aria-invalid`, `aria-describedby` | — |
| Continue with email account but no usable email | info | — | keep current "Enter your email and password to continue as {who}." | — |

The cancelled case needs a distinct failure code from the social flow so it isn't treated as an error; check how "Auth cancelled" reaches `getLoginFeedback` today and map it to the info notice.

---

## 5. Two-factor challenge (`ui/src/login/TwoFactorChallengeScreen.tsx`)

- Top-left back link `chevron-left` "Back" (`onCancel`).
- 56px badge: `rounding="lg"`, `surface.secondaryExtraLight`, `shield-halved` icon (TOTP) / `lock` icon (backup) in `text.secondaryDark`.
- `Heading` "Enter your code" (TOTP) / "Use a backup code" (backup). Default `title` changes from "Two-factor authentication".
- Subtitle: "Open your authenticator app and enter the 6-digit code for {masked email}." (add optional `accountLabel` prop; omit "for …" without it). Backup: "Enter one of the backup codes you saved when you turned on two-factor sign-in. Each code works once."
- `OtpField`: six boxes 48×56, 8px gaps, `radiusMd`, centered bold 24px digits; the active box gets the focus ring. Error: all boxes 2px `border.error` + message below with icon: "That code didn't work. Codes change every 30 seconds, so enter the one your app shows now." Keep single tab stop, paste and `one-time-code` autofill.
- Backup field: monospace, letter-spacing 2px, placeholder "xxxxx-xxxxx", helper "Dashes and spaces are optional."
- Trust device: checkbox + "Trust this device", helper line `sm` secondaryLight "We won't ask for a code here for {trustDeviceDays} days." Checked by default for TOTP. Only rendered with `trustDeviceDays`.
- Primary "Verify" button; below it a centered text link toggling "Use a backup code instead" / "Use your authenticator app"; bottom of screen a grey text link "Sign in a different way" (`cancelText` default changes from "Use another method").

---

## 6. Tokens used (light / dark come from the theme automatically)

| Role | Use |
|---|---|
| `surface.base` | screen, rows, outline buttons |
| `surface.baseAlternate` | "Sign in another way" muted button; disabled field fill |
| `surface.primary` | primary "Sign in"/"Verify", focus border |
| `surface.secondaryExtraLight` / `surface.secondaryLight` | last-used pill & highlighted button, identity chip, info banner, 2FA badge |
| `surface.warningLight` + `border.warning` | warning banner |
| `surface.errorLight` + `border.error`, `text.error` | error banner, field errors |
| `text.primary`, `text.secondaryLight`, `text.secondaryDark`, `text.link` | body, captions, pill/info text, links |
| `text.extraLight` | placeholders only |
| `border.default` | inputs, outline buttons, account list |
| `border.hover` | row separators |
| `border.focus` | 3px focus ring |
| `status.active` | session dot |

Type: `Heading` (Titillium Web) for titles: `xl` 32px page title, `sm` section titles. `Text` (Nunito) 16px body, 12px (`sm`) metadata. Primary buttons follow the library's 19px bold for contrast on `surface.primary`. Radii: inputs `radiusMd` 4px, lists/banners/chips `radiusLg` 16px, buttons and pills `radius3xl`. No shadows.

---

## 7. Implementation plan

1. `ui/src/login/loginTypes.ts`: add `subtitle`, `LoginNotice.title`, `LoginNotice.tone: "info" | "warning" | "error"`, `continuingAccount`, `onCancelContinue`; add `accountLabel` to the 2FA props. All optional; keep backwards compatibility.
2. `LastUsedBadge.tsx` → inline `LastUsedPill`.
3. `LoginAccountCard.tsx` → row component; new `LoginAccountList.tsx` with header + edit mode.
4. `LoginScreen.tsx`: new block order (§2), single banner (§4.1), collapse/expand with accounts, one divider, link-style forgot/sign-up, "Sign in" copy, continuing-account step (§3.5). Pass `dividerPosition="none"` and `variant="outline"` to `OAuthButtons`.
5. `NoticeBox`: tones, title, action, dismiss (§4.2).
6. `TwoFactorChallengeScreen.tsx` + `OtpField`: §5.
7. `rtk/src/auth/loginErrors.ts`, `useLoginController.ts`, `TerrenoLoginScreen.tsx`: copy table §4.3, cancelled-as-info, field-level wrong password, set `continuingAccount`.
8. Update tests and snapshots: `LoginScreen.test.tsx`, `TwoFactorChallengeScreen.test.tsx`, `loginErrors` tests, rtk `TerrenoLoginScreen` tests, and Playwright specs `login`, `login-form`, `two-factor` in `example-frontend`. About 33 test references use the old strings ("Log In", "Forget", "Or sign in another way", etc.). Keep testIDs stable wherever listed above so most selectors still work; only update text assertions.
9. Update the `LoginScreen` and `TwoFactorChallengeScreen` story configs in `ui/demo/story-config/` with one story per state in §8.
10. `bun run compile`, lint, the ui/rtk test suites, and the Playwright login shards must pass. Changelog entry under ui and rtk.

---

## 8. Acceptance: one story / screenshot per state

Match each against its board in `boards/` (and the canvas):

| # | State | Board |
|---|---|---|
| 1 | Returning, accounts, methods collapsed | `Main.html` |
| 2 | First visit, last used provider on top | `FirstVisit.html` |
| 3 | Returning, "Sign in another way" expanded | `AnotherWay.html` |
| 4 | Edit accounts | `ManageAccounts.html` |
| 5 | Continue as email account | `ContinueEmail.html` |
| 6 | Signing in (loading) | `SigningIn.html` |
| 7 | Social sign-in cancelled (info) | `Cancelled.html` |
| 8 | Account not linked (warning + action) | `NotLinked.html` |
| 9 | Wrong password (field error) | `WrongPassword.html` |
| 10 | 2FA authenticator code | `TwoFactor.html` |
| 11 | 2FA wrong code | `TwoFactorError.html` |
| 12 | 2FA backup code | `BackupCode.html` |

Also check every state in dark mode, at 320px width, and with only email+password enabled (no providers: no dividers at all) and with no form (providers only: no "or use your email" divider).

Out of scope: sign-up screen, account security screen, admin panels. "LOGO" in the boards is the app's own `logo` prop.
