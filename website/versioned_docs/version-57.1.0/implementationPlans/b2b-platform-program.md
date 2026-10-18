# Program: B2B platform

**Status:** Draft — roadmap items drafted; decisions D1–D7 resolved 2026-08-09; first ten IPs open
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1095
**Owner:** unassigned
**Created:** 2026-08-09

Umbrella plan coordinating the IPs that take Terreno from a single-tenant, per-user
full-stack kit to a framework you can spin up a B2B SaaS app with in hours. Pairs with the
roadmap items in
[roadmap-seed-issues.md](../explanation/roadmap-seed-issues.md) (B2B platform program
section).

## Goal

A freshly scaffolded, deployed Terreno app supports the B2B critical path out of the box:
**sign up → create an organization → invite a teammate → pick a plan → get an email.**
Today zero of those five steps are possible without custom code.

## Background

A capability audit (2026-08-08) found Terreno strong as a single-tenant CRUD + auth +
realtime + admin + AI kit, with three structural gaps for B2B SaaS: **tenancy** (no
orgs/teams/memberships), **money** (no billing), and **communication** (no email, SMS, or
push delivery — `expo-server-sdk` is an unused dependency and the RTK client's
`resetPassword` endpoint has no backend implementation). Supporting gaps: no invitations,
no durable jobs, no inbound-webhook framework, no rate limiting, no framework-level audit
log, no enterprise SSO/MFA, and missing B2B UI surfaces (server-filtered data grid, charts,
org switcher, dark mode).

## Tracks

| Track | Theme | IPs / roadmap items |
|---|---|---|
| A | Tenancy & access | `orgs-and-teams`, `rbac-permissions` (Complete), `invitations-and-seats`, `org-management-ui` |
| C | Communications (pluggable) | `comms-abstraction`, one item **per adapter**: `comms-adapter-expo-push` (first push adapter, per D4), `comms-adapter-twilio-sms`, `comms-adapter-twilio-verify`, `comms-adapter-sendgrid` (first mail adapter, per D2); operations: `comms-admin-dashboard`; consumers: `password-reset-and-email-verification`, `notification-center` |
| B | Billing | `inbound-webhooks`, `billing-stripe` (web-first, per D1), `mobile-iap-revenuecat` (Future) |
| D | Zero-to-deployed DX | `create-terreno-app`, `mongo-migrations` (deploy items already exist in the OSS launch program) |
| E | B2B UI surfaces | `data-grid-server-filters`, `charts-and-dashboards`, `dark-mode-theme`, `command-palette`, `wizard-stepper`, `wysiwyg-editor` (markdown stays for now, per D3), `global-search` |
| F | Enterprise & scale | `framework-audit-log` (Next), `rate-limiting` (Next), `job-queues` (Next), `enterprise-sso`, `mfa-step-up-auth` |
| — | Native baseline | `native-module-baseline` — all new native modules land in one major release |

## Sequencing

1. **Foundations first:** `comms-abstraction` and `orgs-and-teams` are independent and both
   unblock most of the program. `inbound-webhooks` lands before billing and before comms
   delivery callbacks.
2. **Close the auth hole early:** `password-reset-and-email-verification` ships as soon as
   the abstraction plus one mail adapter exist — the client already calls `POST
   /resetPassword`.
3. **Billing after orgs + webhooks.**
4. **Native baseline rides the next major release** so every later feature ships as
   JS/OTA against the same binary.
5. Track E/F items are independent and can be scheduled opportunistically.

## Native module baseline (next major release)

Adding a native module to `@terreno/ui` or the example apps forces consumers to cut a new
dev-client/store build, so all additions land together in the next major:

| Package | Enables | Notes |
|---|---|---|
| `@stripe/stripe-react-native` | Billing (payment sheet, Apple/Google Pay) | Config plugin; Kotlin 2.x + compileSdk 36 via `expo-build-properties` |
| `react-native-purchases` (+ `-ui`) | Mobile IAP (RevenueCat) | Feature ships later (D1: Stripe web-first) — SDK included now so IAP lands without another major |
| `expo-device` | Push registration guards | trivial |
| `expo-crypto` | PKCE for SSO, invite tokens | trivial |
| `expo-local-authentication` | Biometric step-up (MFA) | `NSFaceIDUsageDescription` |
| `expo-system-ui` | Dark mode root/system chrome | trivial |
| `react-native-otp-verify` | Android SMS OTP autofill | Included (D7) for the Twilio Verify flows |

Excluded by decision: `@10play/tentap-editor` (D3 — markdown stays; revisit in a later
major if WYSIWYG is adopted).

Already linked, no action: skia, reanimated, gesture-handler, svg, webview,
expo-notifications, expo-secure-store, expo-document-picker/image-picker, blur,
permissions, expo-network. Charts (`victory-native`) is JS-only on existing peers.

## Decision log

All decisions resolved by the maintainer on 2026-08-09:

| # | Decision | Resolution |
|---|---|---|
| D1 | Billing vendor strategy | **Stripe web-first.** RevenueCat mobile IAP stays `Future`; `react-native-purchases` still ships in the native baseline |
| D2 | First mail adapter | **SendGrid (Twilio SendGrid)** — pairs with the Twilio SMS/Verify credentials story; other providers get items when demand appears |
| D3 | WYSIWYG editor | **Markdown-only for now.** TenTap excluded from the native baseline; revisit in a later major |
| D4 | First push adapter | **Expo push.** |
| D5 | Targets | **Twilio push adapter dropped entirely** (item removed). Promoted to `Next`: `notification-center`, `framework-audit-log`, `rate-limiting`, `job-queues`. Everything else stays as drafted |
| D6 | Orgs data model | **Native Terreno Mongoose models** (works for JWT + Better Auth), optional Better Auth sync later |
| D7 | Final native manifest | **Confirmed:** six core packages + `react-native-purchases` + `react-native-otp-verify`; no TenTap |

## IPs in this program

| IP | Status | Tasks |
|---|---|---|
| [comms-abstraction](comms-abstraction.md) | Approved — Phase 1 gap-fill implemented | [tasks](../tasks/comms-abstraction.md) |
| [comms-adapter-expo-push](comms-adapter-expo-push.md) | Draft | [tasks](../tasks/comms-adapter-expo-push.md) |
| [comms-adapter-twilio-sms](comms-adapter-twilio-sms.md) | Draft | [tasks](../tasks/comms-adapter-twilio-sms.md) |
| [comms-adapter-twilio-verify](comms-adapter-twilio-verify.md) | Draft | [tasks](../tasks/comms-adapter-twilio-verify.md) |
| [comms-adapter-sendgrid](comms-adapter-sendgrid.md) | In progress (Phase 1) | [tasks](../tasks/comms-adapter-sendgrid.md) |
| [comms-admin-dashboard](comms-admin-dashboard.md) | Draft | [tasks](../tasks/comms-admin-dashboard.md) |
| [password-reset-and-email-verification](password-reset-and-email-verification.md) | Draft | [tasks](../tasks/password-reset-and-email-verification.md) |
| [orgs-and-teams](orgs-and-teams.md) | Draft | [tasks](../tasks/orgs-and-teams.md) |
| [billing-stripe](billing-stripe.md) | Draft | [tasks](../tasks/billing-stripe.md) |
| [native-module-baseline](native-module-baseline.md) | Draft | [tasks](../tasks/native-module-baseline.md) |
| [rbac-permissions](rbac-permissions.md) | Complete (PR #932) | — |

Remaining items (`inbound-webhooks`, `invitations-and-seats`, `org-management-ui`,
`notification-center`, `framework-audit-log`, `rate-limiting`, `job-queues`, …) get IPs as
they approach the top of the queue.

## Not Included

- Deploy guides and deployment foundation (OSS launch program).
- `@terreno/syncdb` migration work (PR #869 track).
- Marketing/positioning for the B2B pitch.
