# Invitations and seat management for organizations

Terreno ships organizations, memberships and per-organization roles, and the admin members screen lets an org-admin attach a person who already has an account. It has no way to bring in someone who does not: the **Invite** button on that screen is rendered disabled, and every B2B app built on Terreno has to write its own invite tokens, emails and accept flow. This plan adds invitations by email with expiring single-use links, accept and decline for people with or without an account, resend and revoke for org-admins, and a seat count that an app (and later the billing plan) can cap. It comes from finding 6.4 of the 2026-11-12 codebase audit and from roadmap issue [#1173](https://github.com/TerrenoLabs/terreno/issues/1173), which has had no plan until now. Org-admins, invited teammates, and anyone starting a team product on Terreno feel the difference.

This file holds the plan and the task list. It follows the dated `docs/plans/` convention of the two most recent plans. `ROADMAP.md` is generated from the roadmap project board, so T9 puts this plan's link in issue #1173 rather than editing that file.

## The idea

A new `Invitation` model (collection `invitations`) records `organizationId`, `email`, `roleName`, a SHA-256 hash of a random 32-byte token, `status` (`pending`, `accepted`, `declined`, `revoked`), `expiresAt`, and who invited and accepted. The raw token exists only in the emailed link. `OrgsApp` gains these routes under its existing base path:

| Method | Path | Who | Does |
| --- | --- | --- | --- |
| POST | `/orgs/:id/invitations` | `organization:manageMembers` | Create a pending invitation and deliver the link |
| GET | `/orgs/:id/invitations` | `organization:manageMembers` | List invitations, pending first |
| POST | `/orgs/:id/invitations/:invitationId/resend` | `organization:manageMembers` | Rotate the token, extend expiry, deliver again |
| DELETE | `/orgs/:id/invitations/:invitationId` | `organization:manageMembers` | Revoke |
| GET | `/orgs/:id/seats` | `organization:manageMembers` | `{used, pending, limit}` |
| POST | `/orgs/invitations/lookup` | anyone holding the token | Show what the link is for |
| POST | `/orgs/invitations/accept` | signed-in user whose email matches (and is verified, where the app tracks that) | Create the membership |
| POST | `/orgs/invitations/decline` | anyone holding the token | Decline |

The three token routes take the token in a JSON body, never in the path or query, so it stays out of API request logs. They are registered before the `/:id` routes so `invitations` is never read as an organization id. The emailed link itself carries the token in its query string, as the reset-password link does today; the invite screen stores it and strips it from the address bar at once.

The link is a bearer credential, like a reset link: single-use, hashed at rest, 7 days. Two checks stop a leaked or forwarded link from being used by someone else. The accepting account's email must equal the invited address, and where the app's user model tracks `emailVerified` (the opt-in `emailVerificationPlugin`), that address must be verified. An app that does not track verification gets the first check only, and for an address with no account yet that check alone does not stop a link holder from registering the address or changing their own email to it. This is fundamental question Q1.

Delivery goes through the same `sendMail` the app already gives Better Auth (the pattern `api/src/accountSecurity/securityNotifications.ts:236` uses), with `sensitive: true` so `@terreno/comms` never stores the link. Without `sendMail` and `publicAppUrl`, creating an invitation answers 501, the way `api/src/accountSecurity/accessActions.ts:68` does.

Seats are a hook, not a billing feature: `organizations.seats.limit(organization)` returns a number or `undefined` (unlimited). Active memberships count as used and unexpired pending invitations count as reserved. The limit is checked when inviting, accepting, attaching an existing user, and reactivating a suspended member.

On the frontend, the admin members screen gets a working **Invite** dialog, a pending invitations table with **Resend** and **Revoke**, and a seat line. `@terreno/syncdb/auth`, which already ships `TerrenoLoginScreen`, gets a `TerrenoInviteScreen` and a `useInvitation` hook, so an app adds one route file instead of writing the flow. The example app mounts it at `/invite` and returns people to it after they sign in or create an account.

Rejected: extending `POST /orgs/:id/members` to create an account for an unknown email. It would add a person to an organization without their consent and create accounts nobody asked for. Rejected: Better Auth's organization plugin. Terreno already has its own `Organization` and `Membership` models, RBAC source and admin screens (`api/src/orgs/`), and two organization systems would have to be kept in step.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: invitation model, create and list | none | api/src/orgs | Supertest: an org-admin creates an invitation, the delivery hook gets a working accept URL, the list shows it |
| T2 | Look up, accept and decline by token | T1 | api/src/orgs | Supertest: the invitee becomes a member with the invited role; wrong email, unverified email, expired and reused tokens are refused |
| T3 | Resend and revoke | T2 | api/src/orgs | Supertest: resend kills the old link and issues a new one; a revoked link is refused |
| T4 | Default email delivery | T3 | api/src/orgs, terrenoApp | Unit + supertest: one sensitive mail with the link; 501 when mail is not configured |
| T5 | Seat limit and seat count | T4 | api/src/orgs | Supertest: invite, accept, attach and reactivate are refused at the limit; `/seats` reports the count |
| T6 | Admin members screen: invite, pending list, seats | T5 | admin-frontend | Component tests for the dialog, the table and the seat line |
| T7 | `TerrenoInviteScreen` and `useInvitation` | T2 | syncdb/src/auth | Component test of each state against a stubbed API client |
| T8 | Example app: `/invite` route and the return after sign-in or sign-up | T7 | example-frontend | Unit tests for the stored token and the post-auth route |
| T9 | Example wiring, end-to-end spec, guides | T4, T6, T8 | example-backend, example-frontend/e2e, docs | Playwright: invite from admin, accept as a new user and as an existing user |

T1 → T2 → T3 → T4 → T5 is a chain of five. Each link exists because the tasks write the same files, not because of logic: all five edit `docs/reference/api.md`; T1, T3, T4 and T5 edit `invitationRoutes.ts`; T2 and T5 edit `invitationTokenRoutes.ts`. T7 needs only the token routes, so the frontend package work starts after T2, alongside T3–T5.

Tracer: `POST /orgs/:id/invitations` through the `OrgsApp` permission and org-context guards to a stored, hashed token and a delivery hook.
E2E: 1 spec (browser) with 4 tests, and 1 smoke addition (http).
Regression: 1 provisional case, `ADMIN-new-1` → `docs/regression/admin.md`: the real email reaches an inbox and its link works.
User guide: 2 new pages, `admin/invite-a-teammate.md` and `account/accept-an-invitation.md`.
Design: None — no canvas. The frames are described in `docs/implementationPlans/org-management-ui.md` (frame F, "Invite wizard"); this plan builds them with existing components.
Out of scope: bulk and CSV invites, invite links not tied to an email, domain auto-join, custom roles on invitations, letting an invitation bypass closed sign-up, in-app invitation notifications, billing enforcement (see Expansions).
Open risks: the backend tasks share route and doc files, so they build in a chain of five; the seat limit is checked by count-then-insert, so requests that arrive at the same instant can overshoot it by the number of concurrent requests (accept re-checks, and Q8 covers making it strict); an app's own sign-up screen must send people back to `/invite`, which is two lines the how-to shows but each adopter still adds; the accept link reaches static-host access logs once, before the screen strips it, as the reset link does today.
Elephant: membership is more than joining a list. An organization's admins get the member account-recovery actions in `api/src/accountSecurity/orgSecurityRoutes.ts` (reset the password, remove second factors, per the app's `orgRecovery` settings, `minMembershipDays` default 0) over a member's whole account, even one who belongs to other organizations. That is already true today, and today an org-admin can attach any existing user by email with no consent at all (`POST /orgs/:id/members`). Invitations add the consent step and a sentence on the accept screen naming those powers, but they also make it easy to reach many more people. Nobody has decided whether attach-without-consent should remain once invitations exist (Q5).

## Audit finding re-verified

| Finding | Verdict | Evidence |
| --- | --- | --- |
| 6.4 "Orgs and RBAC ship with no way to add a teammate" | Overstated, gap confirmed | `POST /orgs/:id/members` (`api/src/orgs/orgsApp.ts:412`) attaches an existing user by email or id. There is no invitation code in `api/src` or `admin-backend/src`, and `admin-frontend/src/orgs/OrgMembersScreen.tsx:254` renders `<Button disabled … text="Invite" />` with an empty handler at `:90` |
| "Already roadmap #1173" | Confirmed | Issue open, "Implementation plan: not yet written". Three existing plans defer to it by the name `invitations-and-seats`: `orgs-and-teams.md:30`, `org-management-ui.md:29`, `billing-stripe.md:29` |

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `example-frontend/e2e/org-invitations.spec.ts` — "org-admin invites a new teammate who joins" | browser | An org-admin sends an invitation from the members screen and sees it pending; a person with no account opens the link, creates an account, verifies their email, accepts, and appears in the members table with the invited role | T9 |
| E2 | same spec — "org-admin revokes an invitation" | browser | After **Revoke**, the pending row is gone and the old link shows that the invitation is no longer valid | T9 |
| E3 | same spec — "signed-in user with another email cannot accept" | browser | The invite screen shows the wrong-account message and no **Accept** button | T9 |
| E5 | same spec — "existing user signs in from the link and joins" | browser | A person who has an account opens the link signed out, presses **Sign in**, signs in, lands back on the invitation, accepts, and appears in the members table; the address bar no longer holds the token | T9 |
| E4 | `api/e2e/smoke.ts` (add one check) | http | From the built `@terreno/api`, with organizations on and a `deliver` hook, create → lookup → accept over real HTTP yields an active membership | T2 |

**Decline** and **Resend** have no browser test: each is one request with one visible result, with no navigation or cross-process state beyond what E1, E2 and E5 already cross, and T2, T3, T6 and T7 assert them at the route and component seams.

## Regression cases

Destination: ADMIN → docs/regression/admin.md

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| ADMIN-new-1 | Invitation email reaches an inbox | With example-backend running against a real mail provider and `PUBLIC_APP_URL` set, sign in as an org-admin, open **Members** for an organization, press **Invite**, enter an address you can read that has no account, choose **Member**, press **Send invitation**; then open the email on a phone and press its link | One email arrives from the configured sender naming the organization; the link opens the invitation screen showing that organization's name and the invited address | web, iOS mail client, Android mail client | E1 covers everything except real delivery and opening from a mail client | invitations |

ADMIN-new-1 is the invitation counterpart of AUTH-001 (reset email reaches a real inbox) and adds the mail-client step, which no automated tier can drive.

## User guide

| ID | Page | Change | Audience | Written in |
| --- | --- | --- | --- | --- |
| G1 | `docs/user-guide/admin/invite-a-teammate.md` | new | admin | T9 |
| G2 | `docs/user-guide/account/accept-an-invitation.md` | new | user | T9 |

Both pages are written in T9, when the screens and the delivery they describe all ship in the example app.

## Design

None — no canvas. The audit screenshots attached to PR #1705 (listed in `docs/audits/2026-11-12/ui-ux.md`) do not include the organization members screen. The intended layout is the text brief in `docs/implementationPlans/org-management-ui.md`, frame F: invite by email, role on accept, a pending / accepted / expired list, resend and revoke. T6 builds it from `Modal`, `TextField`, `SelectField`, `DataTable`, `Badge` and `Button`, next to the existing **Add member** dialog.

## Tasks

- [ ] **T1** — Add the invitation model with create and list routes
  - Depends on: none
  - Files: api/src/orgs/invitationModel.ts, api/src/types/invitation.ts, api/src/orgs/invitationTokens.ts, api/src/orgs/invitationTokens.test.ts, api/src/orgs/invitationDelivery.ts, api/src/orgs/invitationRoutes.ts, api/src/orgs/invitationRoutes.test.ts, api/src/orgs/orgsApp.ts, api/src/index.ts, docs/reference/api.md
  - Criteria: an actor with `organization:manageMembers` can invite an email address and list invitations; the token is stored only as a hash; the `deliver` hook receives a working accept URL. Verified by `bun test api/src/orgs/invitationRoutes.test.ts api/src/orgs/invitationTokens.test.ts`.
  - Seam: HTTP routes mounted by `OrgsApp` (supertest), plus `createInvitationToken` / `hashInvitationToken` as exported functions
  - Interface:
    - `OrgsAppOptions.invitations?: {acceptPath?: string; deliver?: (context: InvitationDeliveryContext) => Promise<void>; expiresInDays?: number; maxPerDay?: number; publicAppUrl?: string; requireEmailMatch?: boolean; requireVerifiedEmail?: boolean; sendMail?: BetterAuthConfig["sendMail"]; template?: InvitationMailTemplate}`. Defaults: `acceptPath` `/invite`, `expiresInDays` 7, `maxPerDay` 50 (invitations created per organization in any rolling 24 hours), `requireEmailMatch` true, `requireVerifiedEmail` true when the user model has an `emailVerified` path. In this task `publicAppUrl` comes only from this option; T4 adds the fallback to the registered `BetterAuthApp` config. `InvitationDeliveryContext` is `{acceptUrl: string; invitation: InvitationDocument; inviter: {email?: string; name?: string}; organization: OrganizationDocument}`. In this task only `deliver` delivers; T4 adds the mail default. `acceptUrl` is `${publicAppUrl}${acceptPath}?token=<token>`.
    - `Invitation` fields: `organizationId`, `email` (trimmed, lower-cased), `roleName` (`org-admin` | `member`), `tokenHash` (unique), `status` (`pending` | `accepted` | `declined` | `revoked`), `expiresAt`, `invitedBy`, `acceptedBy`, `acceptedAt`, `lastSentAt`, `sendCount`, plus `created`, `updated`, `deleted`. A partial unique index allows one `pending` invitation per `organizationId` + `email`. Every field has a `description`. Schema is `strict: "throw"`.
    - `POST /orgs/:id/invitations` body `{email: string, roleName?: "org-admin" | "member"}` → 201 `{data: {_id, organizationId, email, roleName, status: "pending", expiresAt, invitedBy, lastSentAt, sendCount: 1, created}}`. Exactly those fields: no `tokenHash`, no token.
    - `GET /orgs/:id/invitations` → 200 `{data: Array<the same shape plus expired: boolean>}`, pending first, then newest first. `?status=pending|accepted|declined|revoked` filters.
    - `createInvitationToken(): {token: string; tokenHash: string}` (43-character base64url token from 32 random bytes); `hashInvitationToken(token: string): string` (64 hex characters).
  - Cases:
    - org-admin of org A posts `{email: " New@Example.com ", roleName: "member"}` → 201, `email` is `new@example.com`, `expiresAt` is 7 days ahead (clock frozen), `deliver` was called once, and `hashInvitationToken` of the `token` query value in `acceptUrl` equals the stored `tokenHash`
    - the response body and the list response contain neither `tokenHash` nor the token
    - `roleName` omitted → `member`; `roleName: "owner"` → 400 `{title: "roleName must be org-admin or member"}`
    - `email: "not-an-email"` or missing → 400 `{title: "A valid email is required"}`
    - the email belongs to a user who is already an active or suspended member → 409 `{title: "User is already a member"}`
    - a second invite to the same address while the first is pending and unexpired → 409 `{title: "Invitation already pending"}`; while the first is pending but expired → 201, the same row gets a new `tokenHash` and `expiresAt`, and `sendCount` is 2
    - no `deliver` configured (and, until T4, no mail) → 501 `{title: "Invitations are not configured"}` and no row is created; `deliver` configured but no `publicAppUrl` → the same 501
    - with `maxPerDay: 2`, a third invitation to a third address within 24 hours → 429 `{title: "Too many invitations"}`; with the clock moved 25 hours ahead → 201
    - `deliver` rejects → 502 `{title: "Could not deliver the invitation"}` and the row is removed
    - a plain member of org A → 403; an org-admin of org B → 403; no token → 401; unknown org id → 404; a disabled organization → 403 with the title the attach route returns today
    - `onOrgAudit` receives `{verb: "invitationCreated", organizationId, actorId}` and the event holds no email address
    - list as org-admin with one pending, one expired-pending and one accepted invitation → 3 rows in that order with `expired` false, true, false; `?status=accepted` → 1 row
    - `createInvitationToken()` twice → different tokens
  - Blast radius: `OrgAuditEvent.verb` (`api/src/orgs/orgsApp.ts:50-62`) gains all six invitation verbs in this task (`invitationCreated`, `invitationResent`, `invitationRevoked`, `invitationAccepted`, `invitationDeclined`, `invitationExpiredReissued` is not one: a reissue reports `invitationCreated`), so T3 does not edit the union → `example-backend` and any `onOrgAudit` consumer that switches on `verb` must compile (`bun run typecheck`); `api/src/orgs/orgsApp.test.ts` must pass unchanged
  - Docs: `docs/reference/api.md` organizations section gains the `invitations` options and the two routes
  - Test skills: terreno-backend-tests, mongoose-schema-safety

- [ ] **T2** — Look up, accept and decline an invitation by token
  - Depends on: T1
  - Files: api/src/orgs/invitationTokenRoutes.ts, api/src/orgs/invitationTokenRoutes.test.ts, api/src/orgs/orgsApp.ts, api/e2e/smoke.ts, docs/reference/api.md
  - Criteria: a token holder can see what an invitation is for and decline it; a signed-in user whose email matches, and is verified where the app tracks verification, can accept exactly once and becomes an active member with the invited role. Verified by `bun test api/src/orgs/invitationTokenRoutes.test.ts` and `bun run --cwd api smoke`.
  - Seam: HTTP routes mounted by `OrgsApp` (supertest)
  - Interface (all bodies strict; these routes are registered before `/orgs/:id`):
    - `POST /orgs/invitations/lookup` `{token}` (no auth) → 200 `{data: {organizationName, email, roleName, expiresAt, inviterName}}`, exactly those fields
    - `POST /orgs/invitations/accept` `{token}` (signed in) → 200 `{data: {organizationId, organizationName, roleName, membershipId}}`
    - `POST /orgs/invitations/decline` `{token}` (no auth) → 200 `{data: {status: "declined"}}`
    - Errors shared by all three: unknown token → 404 `{title: "Invitation not found"}`; expired → 410 `{title: "Invitation expired"}`; `accepted`, `declined` or `revoked` → 410 `{title: "Invitation is no longer valid"}`; missing or non-string token → 400
  - Cases:
    - lookup with a valid token → the organization's name, the invited email, `roleName`, `expiresAt`, and the inviter's name (or `null`)
    - a user whose email is `New@Example.com` accepts an invitation sent to `new@example.com` → 200; a `Membership` exists with `roleName` from the invitation and `status: "active"`; the invitation is `accepted` with `acceptedBy` and `acceptedAt`; the user's cached permissions are invalidated (an `org-admin` invitee can call `GET /orgs/:id/members` on the next request)
    - accept the same token again → 410 `{title: "Invitation is no longer valid"}` and still one membership
    - two accept requests in parallel → exactly one 200 and one membership
    - a signed-in user with a different email → 403 `{title: "This invitation was sent to a different email address"}`; the invitation stays `pending`. With `requireEmailMatch: false` → 200
    - accept with no session → 401
    - the user model has `emailVerificationPlugin` and the accepting user has `emailVerified: false` → 403 `{title: "Verify your email before accepting this invitation"}`, invitation stays `pending`; with `emailVerified: true` → 200; with `requireVerifiedEmail: false` → 200 unverified
    - a signed-in user changes their own email to the invited address through `PATCH /auth/me`, then accepts → 403 unverified when the model has `emailVerificationPlugin` (the change resets `emailVerified`, `api/src/auth.ts:1009-1037`), and 200 when it does not
    - the user model has no `emailVerified` path → 200 (the default for `requireVerifiedEmail` is then false)
    - the user already has a suspended membership in that organization → 409 `{title: "Membership is suspended"}`; the invitation stays `pending`
    - the user is already an active member (attached after the invite was sent) → 200, no second membership, invitation `accepted`
    - the organization was disabled after the invite → 403 on accept
    - clock moved 8 days ahead → lookup, accept and decline all 410 `{title: "Invitation expired"}`
    - decline → invitation `declined`; a later accept → 410
    - `GET /orgs/invitations` and `PATCH /orgs/invitations` do not reach the token routes or leak data (404 or 405)
    - `onOrgAudit` receives `invitationAccepted` and `invitationDeclined`
    - E4 (smoke): create → lookup → accept over real HTTP → `GET /orgs/:id/members` lists the invitee
  - Blast radius: a new membership feeds RBAC (`api/src/rbac/membershipOrgAdminSource.ts`) and the member recovery routes → the permission-cache case above covers RBAC; `api/src/orgs/orgRbac.test.ts` and `api/src/accountSecurity/orgSecurityRoutes.test.ts` must pass unchanged
  - Docs: `docs/reference/api.md` gains the three token routes and their error table
  - Test skills: terreno-backend-tests

- [ ] **T3** — Resend and revoke an invitation
  - Depends on: T2 (shared `docs/reference/api.md`; T1 for the routes file)
  - Files: api/src/orgs/invitationRoutes.ts, api/src/orgs/invitationRoutes.test.ts, docs/reference/api.md
  - Criteria: an actor with `organization:manageMembers` can send a fresh link, which invalidates the old one, and can revoke a pending invitation. Verified by `bun test api/src/orgs/invitationRoutes.test.ts`.
  - Seam: HTTP routes mounted by `OrgsApp` (supertest)
  - Interface: `POST /orgs/:id/invitations/:invitationId/resend` → 200 `{data: <invitation shape from T1>}`; `DELETE /orgs/:id/invitations/:invitationId` → 204
  - Cases:
    - resend a pending invitation → `deliver` is called with a new `acceptUrl`; `sendCount` is 2; `expiresAt` is 7 days from now (clock frozen); the stored `tokenHash` changed
    - resend an expired pending invitation → 200 and it is usable again
    - resend an `accepted`, `declined` or `revoked` invitation → 409 `{title: "Invitation is no longer pending"}`
    - a resend less than 10 minutes after `lastSentAt` → 429 `{title: "Invitation was sent recently"}` and nothing is delivered; 11 minutes after (clock moved) → 200. The window is rolling, measured from the last send, for the life of the invitation
    - `deliver` rejects on resend → 502 and the previous `tokenHash` and `expiresAt` are kept
    - revoke a pending invitation → 204, status `revoked`; revoke again → 204; revoke an `accepted` one → 409 `{title: "Invitation is no longer pending"}`
    - `invitationId` belonging to another organization → 404; plain member → 403; no token → 401
    - `onOrgAudit` receives `invitationResent` and `invitationRevoked`
  - Blast radius: the token routes read `tokenHash` and `status` → T2's suite proves old and revoked links answer 404 or 410; this task asserts the stored fields
  - Docs: `docs/reference/api.md` routes table
  - Test skills: terreno-backend-tests

- [ ] **T4** — Deliver invitations by email by default
  - Depends on: T3 (shared `invitationRoutes.ts`, its test file and `docs/reference/api.md`)
  - Files: api/src/orgs/invitationDelivery.ts, api/src/orgs/invitationDelivery.test.ts, api/src/orgs/invitationRoutes.ts, api/src/orgs/invitationRoutes.test.ts, api/src/orgs/orgsApp.ts, api/src/terrenoApp.ts, api/src/index.ts, docs/reference/api.md, docs/how-to/add-organizations.md
  - Criteria: with no `deliver` hook, an invitation is emailed through the app's `sendMail` with a link built from `publicAppUrl`; with neither, creating an invitation answers 501. Verified by `bun test api/src/orgs/invitationDelivery.test.ts api/src/orgs/invitationRoutes.test.ts`.
  - Seam: exported `sendInvitationMail(context, config)` and `renderInvitationMail(context, template?)`, plus the create route for the wiring
  - Interface: `renderInvitationMail(context: InvitationDeliveryContext, template?: InvitationMailTemplate): {html: string; subject: string; text: string}`. `InvitationMailTemplate` is `{html?: string; subject: string; text?: string}` with placeholders `{{organizationName}}`, `{{inviterName}}`, `{{acceptUrl}}`, `{{expiresOn}}`. `sendInvitationMail(context, {sendMail, template?})` calls `sendMail({to, subject, text, html, sensitive: true})`. `TerrenoApp` passes the registered `BetterAuthApp`'s `sendMail` and `publicAppUrl` to `OrgsApp` when `organizations.invitations` does not set them. `sendInvitationMail` is exported from `@terreno/api` so a custom `deliver` can call it.
  - Cases:
    - default template, organization `Acme`, inviter `Sam`, `acceptUrl` `https://app.example.com/invite?token=abc`, expiry 2026-11-20 → subject `Sam invited you to join Acme`; text contains the URL and `20 November 2026`; html contains `<a href="https://app.example.com/invite?token=abc">`
    - inviter has no name → subject `You have been invited to join Acme`
    - organization named `<script>alert(1)</script>` → html contains `&lt;script&gt;` and no `<script>`
    - organization name containing `\r\nBcc: x@example.com` → the subject holds no CR or LF
    - a custom `template` with `{{organizationName}}` in `subject` is rendered; an unknown placeholder renders as an empty string
    - `sendMail` receives `sensitive: true` and `to` equal to the invitation email
    - route wiring: `sendMail` and `publicAppUrl` set, no `deliver` → create answers 201 and `sendMail` was called once; `sendMail` unset → 501 `{title: "Invitations are not configured", detail: "Configure sendMail and publicAppUrl, or organizations.invitations.deliver"}`; `publicAppUrl` unset → the same 501
    - `sendMail` rejects → the create route answers 502 (T1's delivery-failure rule)
    - `deliver` set and `sendMail` set → only `deliver` runs
  - Blast radius: `api/src/terrenoApp.ts` organizations wiring → `api/src/orgs/orgsApp.test.ts` and `api/src/orgs/orgPlugin.test.ts` must pass unchanged
  - Docs: `docs/reference/api.md` (delivery options, template placeholders); `docs/how-to/add-organizations.md` gains "Invite teammates" (configure mail, the accept route, customizing the template or `deliver`)
  - Test skills: terreno-backend-tests

- [ ] **T5** — Enforce a seat limit and report seat usage
  - Depends on: T4 (shared `invitationRoutes.ts`, `invitationTokenRoutes.ts`, `orgsApp.ts` and `docs/reference/api.md`)
  - Files: api/src/orgs/seats.ts, api/src/orgs/seats.test.ts, api/src/orgs/invitationRoutes.ts, api/src/orgs/invitationTokenRoutes.ts, api/src/orgs/orgsApp.ts, api/src/orgs/orgsApp.test.ts, docs/reference/api.md, docs/how-to/add-organizations.md
  - Criteria: with a seat limit configured, an organization cannot exceed it by inviting, accepting, attaching or reactivating; with none configured, nothing changes; the seat route reports usage. Verified by `bun test api/src/orgs/seats.test.ts api/src/orgs/orgsApp.test.ts api/src/orgs/invitationRoutes.test.ts api/src/orgs/invitationTokenRoutes.test.ts`.
  - Seam: exported `countSeats` and `assertSeatAvailable`, and the HTTP routes
  - Interface: `OrgsAppOptions.seats?: {limit: (organization: OrganizationDocument) => number | undefined | Promise<number | undefined>}`. `countSeats(organizationId): Promise<{pending: number; used: number}>`: `used` is active memberships, `pending` is `pending` invitations whose `expiresAt` is in the future. `GET /orgs/:id/seats` (`organization:manageMembers`) → 200 `{data: {used, pending, limit}}` with `limit: null` when unlimited. A refused action answers 409 `{title: "Seat limit reached"}`.
  - Cases (limit 3 unless stated):
    - 2 active members and 1 pending invitation → `GET /seats` → `{used: 2, pending: 1, limit: 3}`; a new invitation → 409; an attach through `POST /orgs/:id/members` → 409
    - 2 active and 1 pending: the invitee accepts → 200 (their reserved seat becomes used) and `/seats` → `{used: 3, pending: 0, limit: 3}`
    - limit lowered to 2 after the invitation was sent, 2 active members → accept → 409 `{title: "Seat limit reached"}` and the invitation stays `pending`
    - 3 active, 1 suspended → `PATCH /orgs/:id/members/:memberId` with `{status: "active"}` → 409; a role change on an active member → 200
    - an expired pending invitation does not count: 2 active + 1 expired → a new invitation → 201
    - a revoked or declined invitation frees its seat
    - resend of a pending invitation at the limit → 200 (it already holds its seat)
    - `seats` not configured, or `limit` returns `undefined` → no 409 anywhere and `/seats` → `limit: null`
    - `limit` returns a promise → awaited; `limit` throws → 500 and nothing is created
    - `/seats` as a plain member → 403; no token → 401
    - two invitations sent one after the other with one seat free → the first 201, the second 409. (Simultaneous requests may both pass; that is the documented soft limit, Q8)
  - Blast radius: attach and member update in `api/src/orgs/orgsApp.ts` change → the existing `orgsApp.test.ts` cases must pass unchanged with no `seats` option; `admin-frontend` shows the 409 title through its existing `mutationErrorTitle` path (covered in T6)
  - Docs: `docs/reference/api.md` (`seats` option, `/seats` route); `add-organizations.md` gains "Limit seats", noting that the billing plan will supply `limit` from the subscription
  - Test skills: terreno-backend-tests

- [ ] **T6** — Invite, pending invitations and seats on the admin members screen
  - Depends on: T5
  - Files: admin-frontend/src/orgs/OrgMembersScreen.tsx, admin-frontend/src/orgs/OrgInvitationsPanel.tsx, admin-frontend/src/orgs/OrgInvitationsPanel.test.tsx, admin-frontend/src/orgs/OrgManagementScreens.test.tsx, admin-frontend/src/orgs/useOrganizationsApi.ts, admin-frontend/src/orgs/useOrganizationsApi.test.tsx, docs/reference/admin-frontend.md
  - Criteria: an org-admin can send an invitation, see pending invitations, resend and revoke them, and see seat usage; loading, empty and error states exist. Verified by `bun test admin-frontend/src/orgs`.
  - Seam: the rendered `OrgMembersScreen` under `AdminProvider` with a stubbed fetch client
  - Interface: `useOrganizationsApi` gains `useInvitationsQuery(orgId)`, `useSeatsQuery(orgId)`, `useCreateInvitationMutation()`, `useResendInvitationMutation()`, `useRevokeInvitationMutation()` over the T1, T3 and T5 routes. Test IDs: `org-members-invite` (button), `org-members-invite-modal`, `org-members-invite-email`, `org-members-invite-role`, `org-members-invite-error`, `org-members-seats`, `org-invitations-panel`, `org-invitations-table`, `org-invitations-empty`, `org-invitations-error`, `org-invitations-row-<id>`, `org-invitations-resend-<id>`, `org-invitations-revoke-<id>`.
  - Cases:
    - the **Invite** button is enabled; pressing it opens the dialog titled `Invite a teammate` with an **Email** field, a **Role** select (`Member`, `Org admin`; default `Member`) and primary button `Send invitation`
    - submit `new@example.com` / `Member` → `POST /orgs/<id>/invitations` with `{email: "new@example.com", roleName: "member"}`; on 201 the dialog closes and the pending table refetches
    - the primary button is disabled while the email is empty and while the request is in flight
    - server answers 409 `{title: "Seat limit reached"}` → `org-members-invite-error` shows `Seat limit reached` and the dialog stays open; 501 → shows `Invitations are not configured`; 429 → shows `Too many invitations`
    - pending list with two rows → each row shows the email, the role, `Expires <date>` formatted with Luxon, and **Resend** and **Revoke**; a row with `expired: true` shows an `Expired` badge
    - no pending invitations → `org-invitations-empty` shows `No pending invitations`; list request fails → `org-invitations-error` shows the error title
    - **Resend** → `POST …/resend`, then a toast `Invitation sent again`; 429 → the row shows `Invitation was sent recently`
    - **Revoke** asks for confirmation (`Revoke this invitation?`), then `DELETE`, and the row disappears
    - seats `{used: 2, pending: 1, limit: 5}` → `org-members-seats` shows `3 of 5 seats used (1 pending)`; `limit: null` → the seat line is not rendered
    - the existing **Add member** flow and the member table behave as before (existing tests pass unchanged)
  - Blast radius: `admin-spa/app/orgs/[orgId]/members.tsx` and `example-frontend/app/admin/orgs/[orgId]/members.tsx` render this screen → `admin-frontend/src/isolated/orgsRouteSeeds.ssr.isolated.tsx` and the admin-spa orgs SSR spec (`admin-spa/e2e/integration/adminSpa.ssr.orgs.integration.spec.ts`, if present on the branch) must still pass; the two new queries must not break first-paint seeding
  - Docs: `docs/reference/admin-frontend.md` organization screens section
  - Test skills: terreno-frontend-tests, accessibility-testing, building-admin-interfaces

- [ ] **T7** — Add `TerrenoInviteScreen` and `useInvitation` to `@terreno/syncdb/auth`
  - Depends on: T2
  - Files: syncdb/src/auth/useInvitation.ts, syncdb/src/auth/useInvitation.test.tsx, syncdb/src/auth/TerrenoInviteScreen.tsx, syncdb/src/auth/TerrenoInviteScreen.test.tsx, syncdb/src/auth/auth.ts, docs/reference/syncdb.md
  - Criteria: given a token, the screen shows what the invitation is for, lets a signed-in person accept or decline, and tells a signed-out person to sign in or create an account; every server answer has a readable state. Verified by `bun test syncdb/src/auth/useInvitation.test.tsx syncdb/src/auth/TerrenoInviteScreen.test.tsx`.
  - Seam: the rendered component under `ApiClientProvider` and `SessionProvider` with a stubbed transport
  - Interface: `useInvitation({token, basePath?}: {basePath?: string; token: string | undefined}): {accept: () => Promise<void>; decline: () => Promise<void>; error: InvitationError | undefined; invitation: InvitationSummary | undefined; isLoading: boolean; isSubmitting: boolean; status: "idle" | "accepted" | "declined"}`; `basePath` defaults to `/orgs`; requests go through the app's API client to the T2 routes (no generated SDK hook is needed). `InvitationSummary` is `{email; expiresAt; inviterName: string | null; organizationName; roleName}`. `InvitationError` is `{kind: "missing" | "expired" | "invalid" | "wrongAccount" | "unverified" | "suspended" | "seats" | "unknown"; title: string}`. `TerrenoInviteScreen` props: `token: string | undefined`, `onSignInPress: () => void`, `onSignUpPress: () => void`, `onContinue: () => void`, `onVerifyEmailPress?: () => void`, `basePath?: string`, `testID?: string` (default `invite`). It is exported from `@terreno/syncdb/auth` beside `TerrenoLoginScreen`. Test IDs: `invite-screen`, `invite-loading`, `invite-summary`, `invite-recovery-note`, `invite-accept`, `invite-decline`, `invite-sign-in`, `invite-create-account`, `invite-verify-email`, `invite-wrong-account`, `invite-error`, `invite-success`, `invite-declined`, `invite-continue`.
  - Cases:
    - `token` undefined → `invite-error` shows `This invitation link is incomplete.`; no request is sent
    - lookup pending → `invite-loading` is visible
    - lookup 200 `{organizationName: "Acme", email: "new@example.com", roleName: "member", inviterName: "Sam"}` → `invite-summary` shows `Sam invited new@example.com to join Acme as a member.`; with `inviterName: null` → `new@example.com has been invited to join Acme as a member.`; `invite-recovery-note` shows `Admins of Acme will be able to reset your password and remove your sign-in methods for this account.`
    - signed out → `invite-sign-in` (`Sign in`) and `invite-create-account` (`Create account`) are shown with the line `Use new@example.com to accept.`, and `invite-accept` is not shown; pressing them calls `onSignInPress` / `onSignUpPress`
    - signed in → pressing `invite-accept` posts `{token}` to `/orgs/invitations/accept`; while it is in flight both buttons are disabled; on 200 `invite-success` shows `You have joined Acme.` and `invite-continue` calls `onContinue`
    - accept answers 403 `This invitation was sent to a different email address` → `invite-wrong-account` shows `This invitation was sent to new@example.com. Sign out and sign in with that address to accept it.` and `invite-accept` is hidden
    - accept answers 403 `Verify your email before accepting this invitation` → `invite-error` shows `Verify your email address, then come back to this page to accept.`; `invite-verify-email` is shown when `onVerifyEmailPress` is set and calls it; `invite-accept` stays available
    - accept answers 409 `Seat limit reached` → `invite-error` shows `This organization has no free seats. Ask the person who invited you.`; 409 `Membership is suspended` → `Your membership in this organization is suspended.`
    - lookup answers 410 `Invitation expired` → `invite-error` shows `This invitation has expired. Ask the person who invited you to send a new one.`; 410 `Invitation is no longer valid` or 404 → `This invitation is no longer valid.`
    - pressing `invite-decline` posts decline and shows `invite-declined` with `Invitation declined.`
    - a network failure on lookup → `invite-error` shows `Could not load this invitation. Try again.` with a retry control that repeats the lookup
    - the token is never passed to `console.*`
  - Blast radius: none; a new export from `@terreno/syncdb/auth`
  - Docs: `docs/reference/syncdb.md` auth section gains `TerrenoInviteScreen` and `useInvitation`
  - Test skills: terreno-frontend-tests, accessibility-testing

- [ ] **T8** — Mount the invitation screen in the example app and return to it after sign-in or sign-up
  - Depends on: T7
  - Files: example-frontend/app/invite.tsx, example-frontend/lib/pendingInvite.ts, example-frontend/lib/pendingInvite.test.ts, example-frontend/lib/postAuthRoute.ts, example-frontend/lib/postAuthRoute.test.ts, example-frontend/app/_layout.tsx, example-frontend/app/login.tsx, example-frontend/app/signup.tsx
  - Criteria: `/invite?token=…` works signed out; the token leaves the address bar at once; after signing in or creating an account (by password or through a social provider that reloads the page) the person lands back on the invitation. Verified by `bun test example-frontend/lib/pendingInvite.test.ts example-frontend/lib/postAuthRoute.test.ts`, and in the browser by E1 and E5 in T9.
  - Seam: exported functions `pendingInvite` and `postAuthRoute`; the navigation itself is proven by E1 and E5
  - Interface: route `/invite`, reachable while signed out (added beside `resetPassword` and `verifyEmail` at `example-frontend/app/_layout.tsx:252` and as a `Stack.Screen`). `lib/pendingInvite.ts` exports `setPendingInviteToken(token: string): void`, `peekPendingInviteToken(): string | undefined` and `clearPendingInviteToken(): void`. On web it uses `sessionStorage` (key `terreno.pendingInvite`), so the token survives a reload or a social-provider round trip and dies with the tab; on native it is held in memory. It never uses AsyncStorage or `localStorage`. `lib/postAuthRoute.ts` exports `postAuthRoute(): "/invite" | "/(tabs)"`, which returns `/invite` when a token is pending. The four places that leave auth use it: `leaveLogin` in `app/login.tsx:41` (`router.dismissTo`), both `router.replace("/(tabs)")` calls in `app/signup.tsx` (`:37` and `:58`), and the root layout's own redirect of a signed-in user off `/signup` (`app/_layout.tsx:258-259`), which fires as soon as the session refreshes and is the only thing that moves a social sign-up returning to `/signup`. `app/invite.tsx` reads `token` from the query, stores it, calls `router.replace("/invite")` to strip the query, and renders `TerrenoInviteScreen` with the stored token; `onSignInPress` goes to `/login`, `onSignUpPress` to `/signup`, `onVerifyEmailPress` to `/verifyEmail`, `onContinue` clears the token and goes to `/(tabs)`. The token is also cleared after decline and after an `expired` or `invalid` error.
  - Cases:
    - `setPendingInviteToken("abc")` → `peekPendingInviteToken()` is `"abc"` twice in a row; after `clearPendingInviteToken()` → `undefined`
    - on web (a `sessionStorage` double): the value is stored under `terreno.pendingInvite`, a fresh module instance (simulating a reload) still peeks `"abc"`, and `localStorage` is untouched
    - `sessionStorage` throwing on access (private mode) → falls back to memory and does not throw
    - `postAuthRoute()` with a pending token → `"/invite"`; with none → `"/(tabs)"`
    - (E1, E5 in T9) after the screen loads from `/invite?token=abc`, the address bar is `/invite`
    - (E5 in T9) a signed-out visitor presses **Sign in**, signs in, and lands on `invite-screen`
    - (E1 in T9) a visitor who creates an account with a pending token ends on `invite-screen`, never on the tabs: both the sign-up screen and the root layout redirect resolve to `/invite`
  - Blast radius: the root layout's signed-out allowlist and the post-auth navigation → `example-frontend/e2e/login.spec.ts`, `login-form.spec.ts`, `signup.spec.ts`, `reset-password.spec.ts` and `account-linking.spec.ts` must pass unchanged (run in T9): with no pending token every path still ends at `/(tabs)`
  - Docs: none in this task; T9 writes the how-to and the user guide once the flow runs end to end
  - Test skills: terreno-frontend-tests

- [ ] **T9** — Wire invitations into the example backend, prove the flow end to end, and write the guides
  - Depends on: T4, T6, T8
  - Files: example-backend/src/server.ts, example-backend/src/api/invitationsDev.ts, example-backend/src/api/invitationsDev.test.ts, example-backend/.env.example, example-frontend/store/apiSdk.ts (regenerated with `bun run sdk`, never hand-edited), example-frontend/e2e/org-invitations.spec.ts, example-frontend/e2e/helpers/invitations.ts, example-frontend/playwright.config.ts, .circleci/continue-config.yml, .github/workflows/e2e-ci.yml, docs/how-to/invite-teammates.md, docs/user-guide/admin/invite-a-teammate.md, docs/user-guide/account/accept-an-invitation.md, docs/user-guide/README.md, docs/regression/admin.md, docs/reference/environment-variables.md, changelog/unreleased/org-invitations.md
  - Criteria: the example backend delivers invitations; only when a test flag is set outside production does it keep the last accept URL for a test to read; the browser spec passes; the guides describe the shipped screens. Verified by `bun test example-backend/src/api/invitationsDev.test.ts`, `bun run frontend:e2e -- org-invitations.spec.ts login.spec.ts login-form.spec.ts signup.spec.ts reset-password.spec.ts`, then separately `bun run frontend:e2e -- account-linking.spec.ts` (naming a cross-site spec switches the whole run to cross-site mode, `example-frontend/playwright.config.ts:10-13`, so it must not share a command with the others), `bun run check:circleci-parity`, `bun run check:user-guide` and `bun run check:regression-suites`.
  - Seam: the browser (Playwright), and the dev-only route (supertest)
  - Interface: `createInvitationCapture(env: NodeJS.ProcessEnv): {deliver: OrgsAppOptions["invitations"]["deliver"] | undefined; router: ModelRouterRegistration | undefined}`. Capture is on only when `env.NODE_ENV !== "production"` **and** `env.E2E_CAPTURE_INVITATIONS === "1"`. When on, `deliver` records `{email → acceptUrl}` in a map capped at 100 entries and then calls `sendInvitationMail`; `router` is a `modelRouter` at `/orgs-dev` with all CRUD disabled and one collection action `GET /orgs-dev/lastInvitation?email=<email>` (`Permissions.IsAdmin`) → 200 `{data: {acceptUrl}}` or 404 (the `commsDevRouter` pattern in `example-backend/src/api/commsDev.ts:37`). When off, both are `undefined`, the default mail delivery runs, and nothing is recorded. `E2E_CAPTURE_INVITATIONS=1` is set in every place that starts the e2e backend: the web-server env in `example-frontend/playwright.config.ts`, the hand-written backend exports in `.circleci/continue-config.yml` (around `:408-414`; CircleCI starts the backend itself and `playwright.circleci.config.ts` reuses it), and the matching env in `.github/workflows/e2e-ci.yml`. The spec is added to a shard by name in `.circleci/continue-config.yml` (the per-shard spec lists near `:484`) and to the matrix in `.github/workflows/e2e-ci.yml`, which both list specs by hand. In the capture `deliver`, a failure of the follow-on `sendInvitationMail` is logged and swallowed, so an e2e backend with no working mail provider still answers 201. `PUBLIC_APP_URL` is documented as the base of the accept link.
  - Cases:
    - `createInvitationCapture({NODE_ENV: "production", E2E_CAPTURE_INVITATIONS: "1"})` → both `undefined`; `({NODE_ENV: "development"})` with no flag → both `undefined`; `({NODE_ENV: "test", E2E_CAPTURE_INVITATIONS: "1"})` → both defined
    - admin reads `lastInvitation` for an invited address → the accept URL; for an unknown address → 404; a non-admin → 405; no token → 401
    - the 101st captured address evicts the oldest
    - capture on and `sendInvitationMail` rejecting → `deliver` resolves and the URL is still recorded
    - E1: per-run org-admin and organization (as `example-frontend/e2e/org-admin-security.spec.ts` builds them); on `/admin/orgs/<id>/members` press `org-members-invite`, fill `org-members-invite-email` with a fresh address, press **Send invitation**; `org-invitations-row-<id>` is visible. In a fresh browser context open the accept URL read from `lastInvitation`; wait for `invite-screen`; the page URL no longer contains `token`; press `invite-create-account`; complete sign-up with the invited address (and the first-login consent dialogs with `acceptPendingConsentForms`); the app returns to `invite-screen`; press `invite-accept`: `invite-error` shows the verify-your-email message; mark the user's email verified through the admin API (standing in for the verification email, which AUTH covers); reload; press `invite-accept`; `invite-success` is visible. Back as the org-admin, reload the members screen: `org-members-table` contains the new address and the pending row is gone
    - E5: an existing, verified user is invited; in a fresh signed-out context open the accept URL; press `invite-sign-in`; sign in; the app lands on `invite-screen` (not the tabs); press `invite-accept`; `invite-success` is visible
    - E2: invite, then press `org-invitations-revoke-<id>` and confirm → the row is gone; opening the old accept URL shows `invite-error` with `This invitation is no longer valid.`
    - E3: invite address A; signed in as a user with address B, open the accept URL and press `invite-accept` → `invite-wrong-account` is visible
    - no `waitForTimeout`; every wait is on a test ID
  - Blast radius: `example-backend/src/server.ts` organizations options → `bun run --cwd example-backend test:ci` (including `openapi.test.ts`) must pass; the new `/orgs/…` paths appear in `/openapi.json`, so `store/apiSdk.ts` is regenerated here even though the invite screen does not use its hooks
  - Docs: new `docs/how-to/invite-teammates.md` (backend options, adding the `/invite` route with `TerrenoInviteScreen`, the two-line post-auth return, email verification, seats and the soft-limit note, the recovery powers and `orgRecovery.minMembershipDays`, why the link is a bearer credential); user guide G1 and G2 in on-screen words (**Members**, **Invite**, **Send invitation**, **Resend**, **Revoke**, **Sign in**, **Create account**, **Accept**, **Decline**) and the index; regression case `ADMIN-new-1`; `environment-variables.md`; `Added` changelog fragment. `ROADMAP.md` is generated from the project board, so do not edit it: put this plan's path in issue #1173's "Implementation plan" line with `gh issue edit`, and it flows into the next roadmap sync
  - Test skills: terreno-frontend-tests, terreno-backend-tests, verify-ui-changes, update-docs

## Assumptions

- Invitation routes are added to `OrgsApp`'s Express router with `createOpenApiBuilder` docs, the way its existing member routes are (`api/src/orgs/orgsApp.ts:389-560`) and the way `api/src/accountSecurity/orgSecurityRoutes.ts` adds routes to it. They need the organization context and `assertCan` guards that live there. The "use `modelRouter` actions" rule covers application APIs; the dev-only route in `example-backend` follows it.
- Invitation roles are the two membership roles that exist today, `org-admin` and `member` (`api/src/orgs/organizationModel.ts:27`).
- The feature is additive and off until `organizations` is enabled, so no upgrade note is needed. A new collection and indexes are created; no existing data changes.
- Invitee email addresses are personal data. They are stored in the `invitations` collection, returned only to actors with `organization:manageMembers` and to the token holder, kept out of audit events, and kept out of the comms log by `sensitive: true`.
- The link is a bearer credential. Email match protects an invited address that already has an account; `requireVerifiedEmail` protects an address that does not, in apps whose user model has `emailVerified`. Apps without that field rely on the link staying private, as they already do for reset links (Q1).
- T4's mail fallback reads `sendMail` and `publicAppUrl` from wherever `AccountSecurityApp` resolves them today (`api/src/accountSecurity/accountSecurityApp.ts:677`: its own options, then the Better Auth config). Whether apps that set them only under `TerrenoApp` `authOptions` are covered was not traced; T4's first step is to confirm it and add a case.
- How issue #1173's plan link reaches the generated `ROADMAP.md` was not traced; T9 edits the issue only.
- Supporting skills for the build: `terreno-backend-tests`, `terreno-frontend-tests`, `mongoose-schema-safety`, `building-admin-interfaces`, `terreno-data-fetching`, `generate-sdk`, `update-docs`, `verify-ui-changes`, `accessibility-testing`.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q2 | Should a valid invitation let someone create an account when sign-up is closed (`signUp: {mode: "closed"}`)? | Not in this plan | It opens a path through an auth boundary and needs its own threat review; closed-sign-up apps can keep creating users in admin and attaching them | Add a task that lets Better Auth sign-up through when a valid, unexpired token for that email is presented, plus tests for every bypass attempt (X1) | T2, T7, new task |
| Q3 | Do pending invitations hold a seat? | Yes, until they expire, are revoked or are declined | Otherwise an org at its limit can over-invite and people hit a wall at accept | `countSeats` ignores pending; the over-limit check moves entirely to accept | T5, T6 |
| Q4 | How long does a link live, and how are sends limited? | 7 days; one resend per 10 minutes per invitation; 50 new invitations per organization per rolling 24 hours (`maxPerDay`) | Matches common practice; the caps stop an org-admin using the app's sender to mail arbitrary addresses | Change the constants and their cases | T1, T3 |
| Q5 | Org-admins can run account-recovery actions on any member from day zero (`minMembershipDays` default 0), and can attach an existing user without consent. Should this plan change either? | No. Name the powers on the accept screen and in the how-to, and leave both defaults | Both behaviours exist today and changing them breaks current adopters; the note gives invitees informed consent | Raise the `minMembershipDays` default (breaking, needs an upgrade note), or make attach require an accepted invitation (removes `POST /orgs/:id/members` for non-operators; a separate plan) | T7, T9 |
| Q6 | Where does the reusable accept screen live? | `@terreno/syncdb/auth`, beside `TerrenoLoginScreen` | That entry already ships a packaged auth screen with the API client and session in reach | Keep it as example code to copy: drop T7's package files and fold the screen into T8 | T7, T8 |
| Q7 | Should invitations use `OrgsApp`'s plain routes or `modelRouter` actions? | Plain routes on the existing router | Every other organization route is built that way and shares its guards | Rebuild T1–T3 and T5 as a `modelRouter` over `Invitation` with actions and re-create the org-context guards as permissions | T1, T2, T3, T5 |
| Q8 | Should the seat limit be strict under simultaneous requests? | No, soft: sequential requests are exact, simultaneous ones can overshoot, accept re-checks | A strict limit needs a per-organization counter document or a transaction around every membership and invitation write | Add a seat-counter document updated atomically, and a parallel-requests case to T5 | T5 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Invitation-gated sign-up for apps with closed sign-up | Q2; invite-only is the usual B2B setup | M | T2 |
| X2 | Seat enforcement from the Stripe subscription quantity | `docs/implementationPlans/billing-stripe.md:29` and `:132` defer it to this feature; `seats.limit` is the hook | S | T5, `billing-stripe` |
| X3 | Bulk and CSV invites | Onboarding a whole team at once | S | T1 |
| X4 | Shareable join links and email-domain auto-join | Self-serve team growth without an admin typing addresses | M | T2 |
| X5 | Custom RBAC roles on an invitation | Memberships only know `org-admin` and `member` today | M | a membership role model change |
| X6 | In-app notification and inbox entry for an invitation to an existing user | `NotificationsApp` exists; existing users may miss the email | S | T1 |
| X7 | The `/invite` route and post-auth return in the scaffold's `saas` starter template | A scaffolded app still adds the route file and two lines by hand | S | `starter-templates`, `one-command-dev` |
| X8 | A scheduled job that deletes long-expired invitations | Expired rows keep invitee addresses indefinitely | S | `@terreno/jobs` |
| X9 | Invitation management in a non-admin, app-facing members screen | Only `admin-frontend` has organization screens today | M | `schema-form-resource-list` |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | Q1: what must a person prove to accept an invitation? | Owner, 2026-11-13: the recommendation. A signed-in account whose email equals the invited address, plus a verified address where the user model tracks `emailVerified`; both can be turned off per app. | Nothing; T2, T7 and T9 were built on this. |

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagent each), 17 findings: 16 fixed, 1 moved to questions (seat-limit concurrency → Q8), 0 rebutted. Blocking: round 1 had 3 (post-auth return mechanism, email verification on accept → Q1 fundamental, T4 files and ordering); round 2 had 3 (CI env and shard wiring, cross-site e2e command, a fourth post-auth redirect). All six were fixed by editing the plan. Round 2's fixes were not re-cut (two-round cap).
