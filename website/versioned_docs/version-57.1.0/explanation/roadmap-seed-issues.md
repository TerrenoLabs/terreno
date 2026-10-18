# Roadmap seed issues

Ready-to-paste GitHub issue bodies for IPs on the public roadmap — the
[OSS launch program](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/oss-launch-program.md) IPs plus other
roadmap-tracked work. Open one tracking issue per IP when the IP reaches **Approved**, then
add it to the **Terreno Roadmap** project with the field values below.

---

## oss-governance-baseline

**Title:** `[Roadmap] OSS governance baseline`

**Labels:** `area:dx`, `type:chore`  
**Project fields:** Area=`dx`, Target=`Next`, Impact=`Improvement`, IP=`oss-governance-baseline`, Status=`Shipped`

Establishes the legal and community foundation required before Terreno can launch as a public
open-source project. It adds a root MIT license, contribution and security policies, a
changelog, GitHub community health files, and CI checks so every published npm package ships
with correct licensing. Without this work, the repository cannot credibly invite outside
contributors or consumers.

- **Implementation plan:** [oss-governance-baseline.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/oss-governance-baseline.md)
- **Tasks:** [oss-governance-baseline.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/oss-governance-baseline.md)
- **RTK flag:** None
- **Depends on:** —

---

## public-roadmap-github

**Title:** `[Roadmap] Public roadmap on GitHub`

**Labels:** `area:dx`, `type:feature`  
**Project fields:** Area=`dx`, Target=`Next`, Impact=`Improvement`, IP=`public-roadmap-github`, Status=`In progress`

Runs Terreno's public roadmap on GitHub while keeping Linear as the internal execution
tracker. It sets up GitHub Discussions categories, a Terreno Roadmap project board, label
taxonomy, automated ROADMAP.md generation, and a one-way GitHub-to-Linear bridge for tracked
issues. Outside contributors can see priorities and propose work without maintainers
duplicating sprint planning.

- **Implementation plan:** [public-roadmap-github.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/public-roadmap-github.md)
- **Tasks:** [public-roadmap-github.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/public-roadmap-github.md)
- **RTK flag:** None
- **Depends on:** oss-governance-baseline

---

## deploy-to-gcp

**Title:** `[Roadmap] Deploy to GCP (generalized)`

**Labels:** `area:deploy`, `type:docs`  
**Project fields:** Area=`deploy`, Target=`Next`, Impact=`Improvement`, IP=`deploy-to-gcp`, Status=`Planned`

Turns Terreno's GCP deployment story from Flourish-specific infrastructure into a reusable
guide any Terreno app can follow. It documents Cloud Run backend hosting, GCS plus CDN for
static web export, a reusable Terraform module, parameterized scripts, and a deploy-gcp
agent skill with confirmation gates. The guide covers websocket, replica-set, and
session-affinity constraints that commonly break production Terreno deployments.

- **Implementation plan:** [deploy-to-gcp.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/deploy-to-gcp.md)
- **Tasks:** [deploy-to-gcp.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/deploy-to-gcp.md)
- **RTK flag:** None
- **Depends on:** deployment-foundation

---

## agentic-sdlc-plugin

**Title:** `[Roadmap] Agentic SDLC plugin (/terreno-*)`

**Labels:** `area:dx`, `type:feature`  
**Project fields:** Area=`dx`, Target=`Next`, Impact=`Feature`, IP=`agentic-sdlc-plugin`, Status=`Planned`

Packages and documents Terreno's five-stage `/terreno-*` agentic SDLC pipeline as a portable,
publicly installable Cursor plugin. The pipeline takes work from a raw request through
planning, test-driven implementation, independent verification, submission with evidence,
and a review loop until mergeable. Today the tooling exists inside the monorepo but is
invisible and breaks in consumer apps.

- **Implementation plan:** [agentic-sdlc-plugin.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/agentic-sdlc-plugin.md)
- **Tasks:** [agentic-sdlc-plugin.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/agentic-sdlc-plugin.md)
- **RTK flag:** Partial
- **Depends on:** positioning-django-rails-universal, oss-governance-baseline

---

## rtk-to-syncdb-migration-docs

**Title:** `[Roadmap] RTK deprecation and syncdb migration docs`

**Labels:** `area:syncdb`, `type:docs`, `deprecation`, `status:blocked`  
**Project fields:** Area=`syncdb`, Target=`Next`, Impact=`Improvement`, IP=`rtk-to-syncdb-migration-docs`, Status=`Planned`

> Blocked on PR #869. The Project **Status** field has no `Blocked` option, so gating is
> tracked with the `status:blocked` issue label instead.

Makes Better Auth plus `@terreno/syncdb` the documented, supported frontend platform and gives
RTK Query consumers a tested migration path. It covers deprecation policy, a step-by-step
migration guide, syncdb reference docs, auth repositioning, and updates to agent rules, MCP
bootstrap output, and upgrade notes. Gates most Wave 1 launch documentation.

- **Implementation plan:** [rtk-to-syncdb-migration-docs.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/rtk-to-syncdb-migration-docs.md)
- **Tasks:** [rtk-to-syncdb-migration-docs.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/rtk-to-syncdb-migration-docs.md)
- **RTK flag:** Blocked (PR #869)
- **Depends on:** PR #869

---

## positioning-django-rails-universal

**Title:** `[Roadmap] Positioning — Django/Rails for TypeScript`

**Labels:** `area:docs`, `type:docs`  
**Project fields:** Area=`docs`, Target=`Next`, Impact=`Improvement`, IP=`positioning-django-rails-universal`, Status=`Planned`

Aligns Terreno's messaging across README, docs site, agent context files, and npm package
metadata under one positioning statement: Django/Rails for TypeScript with universal app
support, organized around batteries included, universal by default, and AI-native pillars.

- **Implementation plan:** [positioning-django-rails-universal.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/positioning-django-rails-universal.md)
- **Tasks:** [positioning-django-rails-universal.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/positioning-django-rails-universal.md)
- **RTK flag:** Partial
- **Depends on:** rtk-to-syncdb-migration-docs

---

## docs-reference-coverage

**Title:** `[Roadmap] Reference documentation coverage`

**Labels:** `area:docs`, `type:docs`  
**Project fields:** Area=`docs`, Target=`Next`, Impact=`Improvement`, IP=`docs-reference-coverage`, Status=`Planned`

Gives every published Terreno package a real README and a public docs/reference page instead
of stubs. Adds missing reference pages, de-stubs package READMEs, sanitizes internal
leakage, and extends docs-audit CI to catch drift.

- **Implementation plan:** [docs-reference-coverage.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/docs-reference-coverage.md)
- **Tasks:** [docs-reference-coverage.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/docs-reference-coverage.md)
- **RTK flag:** Blocked
- **Depends on:** rtk-to-syncdb-migration-docs, positioning-django-rails-universal

---

## docs-tutorials-ai-first

**Title:** `[Roadmap] AI-first tutorials`

**Labels:** `area:docs`, `type:docs`  
**Project fields:** Area=`docs`, Target=`Next`, Impact=`Feature`, IP=`docs-tutorials-ai-first`, Status=`Planned`

Replaces Terreno's thin getting-started page with a full tutorial path where the
AI-assisted workflow is the default. Six tutorials cover examples, first app, MCP, AI
features, admin panel, and production deploy — all on syncdb + Better Auth.

- **Implementation plan:** [docs-tutorials-ai-first.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/docs-tutorials-ai-first.md)
- **Tasks:** [docs-tutorials-ai-first.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/docs-tutorials-ai-first.md)
- **RTK flag:** Blocked
- **Depends on:** docs-reference-coverage, ai-dev-loop-boost, deployment-foundation

---

## deployment-foundation

**Title:** `[Roadmap] Deployment foundation`

**Labels:** `area:deploy`, `type:docs`  
**Project fields:** Area=`deploy`, Target=`Next`, Impact=`Improvement`, IP=`deployment-foundation`, Status=`Planned`

Defines the provider-agnostic deployment baseline every Terreno production app needs: core
requirements, environment-variable reference, Expo web output modes, and a canonical
example-backend Dockerfile with CI validation.

- **Implementation plan:** [deployment-foundation.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/deployment-foundation.md)
- **Tasks:** [deployment-foundation.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/deployment-foundation.md)
- **RTK flag:** Partial
- **Depends on:** —

---

## deploy-to-vercel

**Title:** `[Roadmap] Deploy to Vercel`

**Labels:** `area:deploy`, `type:docs`  
**Project fields:** Area=`deploy`, Target=`Next`, Impact=`Improvement`, IP=`deploy-to-vercel`, Status=`Planned`

Documents Expo web export on Vercel, preview-deployment CORS and Better Auth origin handling,
and a deploy-vercel skill with websocket verification. Requires a spike on backend hosting
options.

- **Implementation plan:** [deploy-to-vercel.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/deploy-to-vercel.md)
- **Tasks:** [deploy-to-vercel.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/deploy-to-vercel.md)
- **RTK flag:** Partial
- **Depends on:** deployment-foundation

---

## upgrade-guides-and-skill

**Title:** `[Roadmap] Upgrade guides and upgrading-terreno skill`

**Labels:** `area:mcp`, `type:docs`  
**Project fields:** Area=`mcp`, Target=`Next`, Impact=`Improvement`, IP=`upgrade-guides-and-skill`, Status=`Planned`

Makes upgrading Terreno across lockstep-published packages a documented, repeatable process.
Backfills upgrade notes, adds versioning policy, ships an upgrading-terreno skill, and
enforces upgrade-note requirements in release CI.

- **Implementation plan:** [upgrade-guides-and-skill.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/upgrade-guides-and-skill.md)
- **Tasks:** [upgrade-guides-and-skill.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/upgrade-guides-and-skill.md)
- **RTK flag:** Blocked
- **Depends on:** rtk-to-syncdb-migration-docs, oss-governance-baseline

---

## ai-dev-loop-boost

**Title:** `[Roadmap] AI development loop (MCP Boost)`

**Labels:** `area:mcp`, `type:feature`  
**Project fields:** Area=`mcp`, Target=`Next`, Impact=`Feature`, IP=`ai-dev-loop-boost`, Status=`Planned`

Documents Terreno's AI-native development loop: search docs, generate code, run the app,
observe merged logs and client state, then fix and iterate. Builds on MCP Boost parity (PR
#802).

- **Implementation plan:** [ai-dev-loop-boost.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/ai-dev-loop-boost.md)
- **Tasks:** [ai-dev-loop-boost.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/ai-dev-loop-boost.md)
- **RTK flag:** Partial
- **Depends on:** PR #802

---

## build-terreno-app-validation

**Title:** `[Roadmap] Dogfooding run and launch blog post`

**Labels:** `area:docs`, `type:chore`  
**Project fields:** Area=`docs`, Target=`Next`, Impact=`Improvement`, IP=`build-terreno-app-validation`, Status=`Planned`

Executes the OSS launch acceptance test: an agent builds and deploys a real universal app
using only public docs and skills, then publishes a friction log and blog post.

- **Implementation plan:** [build-terreno-app-validation.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/build-terreno-app-validation.md)
- **Tasks:** [build-terreno-app-validation.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/build-terreno-app-validation.md)
- **RTK flag:** Blocked
- **Depends on:** docs-tutorials-ai-first, ai-dev-loop-boost, deploy-to-vercel, docs-reference-coverage

---

## examples-demo-coverage

**Title:** `[Roadmap] Examples, demo, and test coverage`

**Labels:** `area:examples`, `type:chore`  
**Project fields:** Area=`examples`, Target=`Future`, Impact=`Improvement`, IP=`examples-demo-coverage`, Status=`Planned`

Closes credibility gaps in examples, the UI demo app, and CI coverage gates. Adds missing demo
stories, extends coverage enforcement, and publishes an example-app feature matrix.

- **Implementation plan:** [examples-demo-coverage.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/examples-demo-coverage.md)
- **Tasks:** [examples-demo-coverage.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/examples-demo-coverage.md)
- **RTK flag:** Partial
- **Depends on:** docs-reference-coverage

---

## web-ssr-and-admin-spa

**Title:** `[Roadmap] Web SSR and admin SPA`

**Labels:** `area:ui`, `type:feature`  
**Project fields:** Area=`ui`, Target=`Future`, Impact=`Feature`, IP=`web-ssr-and-admin-spa`, Status=`Planned`

Adds real server-side rendering for Terreno web apps so routes can be indexed and paint
meaningful HTML before JavaScript loads. Starts with static output and admin-spa as proving
ground; SSR is opt-in and depends on Expo SDK 55+.

- **Implementation plan:** [web-ssr-and-admin-spa.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/web-ssr-and-admin-spa.md)
- **Tasks:** [web-ssr-and-admin-spa.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/web-ssr-and-admin-spa.md)
- **RTK flag:** Partial
- **Depends on:** Expo SDK ≥ 55 (PR #779), deployment-foundation

---

## infra-mcp

*Outside the OSS launch program.*

**Title:** `[Roadmap] Infrastructure MCP server (@terreno/infra-mcp)`

**Labels:** `area:mcp`, `type:feature`, `status:blocked`  
**Project fields:** Area=`mcp`, Target=`Future`, Impact=`Feature`, IP=`infra-mcp`, Status=`Planned`

> Blocked on the RBAC permissions module. The Project **Status** field has no `Blocked`
> option, so gating is tracked with the `status:blocked` issue label instead.

Puts privileged infrastructure tooling — GCP, Sentry, MongoDB, and later Expo/EAS and Vercel —
behind one deployable MCP server with per-user OAuth 2.1 authentication, RBAC-driven read and
write tiers, per-call confirmation on write tools, and an audit trail. Read-only access covers
log digging without handing anyone production credentials, and the server runs on its own Cloud
Run runtime service account so injected service-account keys can be retired.

- **Implementation plan:** [infra-mcp.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/infra-mcp.md)
- **Tasks:** [infra-mcp.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/infra-mcp.md)
- **RTK flag:** None
- **Depends on:** rbac-permissions

---

# B2B platform program

Ready-to-paste GitHub issue bodies for the
[B2B platform program](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/b2b-platform-program.md).
Items marked *(IP pending)* are drafted ahead of their IP by maintainer decision; open the
issue with `Status=Planned` and fill the IP field when the IP lands.

---

## comms-abstraction

**Title:** `[Roadmap] Pluggable communications layer (@terreno/comms)`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`comms-abstraction`, Status=`Planned`

Terreno backends have no way to send email, SMS, or push notifications today. This adds a
new `@terreno/comms` package with provider interfaces for mail, SMS, push, and OTP
verification, a `CommsApp` plugin that registers them on a Terreno app, push-token
registration routes, a delivery log model, and console adapters for local development.
Concrete providers (Twilio, SendGrid, Expo push) ship as separate adapters, each with its own
roadmap item, so apps only install the SDKs they use.

- **Implementation plan:** [comms-abstraction.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/comms-abstraction.md)
- **Tasks:** [comms-abstraction.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/comms-abstraction.md)
- **RTK flag:** None
- **Depends on:** —

---

## comms-adapter-expo-push

**Title:** `[Roadmap] Comms adapter — Expo push notifications`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`comms-adapter-expo-push`, Status=`Planned`

Implements the `@terreno/comms` push provider on Expo's push service using
`expo-server-sdk` (already a dependency of `@terreno/api`, currently unused). Covers token
chunking, receipt polling, and automatic deactivation of dead device tokens. The client
half — `getExpoPushTokenAsync` registration — already exists in example-frontend.

- **Implementation plan:** [comms-adapter-expo-push.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/comms-adapter-expo-push.md)
- **Tasks:** [comms-adapter-expo-push.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/comms-adapter-expo-push.md)
- **RTK flag:** None
- **Depends on:** comms-abstraction

---

## comms-adapter-twilio-sms

**Title:** `[Roadmap] Comms adapter — Twilio SMS`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`comms-adapter-twilio-sms`, Status=`Planned`

Implements the `@terreno/comms` SMS provider on Twilio Programmable Messaging: send via
messaging service or from-number, delivery status callbacks through the inbound-webhook
framework, and E.164 validation using the `libphonenumber-js` dependency already in the
catalog.

- **Implementation plan:** [comms-adapter-twilio-sms.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/comms-adapter-twilio-sms.md)
- **Tasks:** [comms-adapter-twilio-sms.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/comms-adapter-twilio-sms.md)
- **RTK flag:** None
- **Depends on:** comms-abstraction; inbound-webhooks (status callbacks phase only)

---

## comms-adapter-twilio-verify

**Title:** `[Roadmap] Comms adapter — Twilio Verify (OTP)`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`comms-adapter-twilio-verify`, Status=`Planned`

Implements the `@terreno/comms` verification provider on Twilio Verify for SMS and email
one-time codes. This is the delivery channel for phone verification and for the future MFA
step-up work, without Terreno storing or rate-limiting codes itself.

- **Implementation plan:** [comms-adapter-twilio-verify.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/comms-adapter-twilio-verify.md)
- **Tasks:** [comms-adapter-twilio-verify.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/comms-adapter-twilio-verify.md)
- **RTK flag:** None
- **Depends on:** comms-abstraction

---

## comms-adapter-sendgrid

**Title:** `[Roadmap] Comms adapter — transactional email (SendGrid)`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`comms-adapter-sendgrid`, Status=`Planned`

Implements the first `@terreno/comms` mail provider on Twilio SendGrid so Terreno apps can
send transactional email (password resets, invitations, verification), sharing the Twilio
account story with the SMS and Verify adapters (decision D2). Other providers (Resend,
SES, SMTP) get their own items when demand appears.

- **Implementation plan:** [comms-adapter-sendgrid.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/comms-adapter-sendgrid.md)
- **Tasks:** [comms-adapter-sendgrid.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/comms-adapter-sendgrid.md)
- **RTK flag:** None
- **Depends on:** comms-abstraction

---

## comms-admin-dashboard

**Title:** `[Roadmap] Comms admin dashboard (errors, retries, log digging)`

**Labels:** `area:admin`, `type:feature`
**Project fields:** Area=`admin`, Target=`Next`, Impact=`Feature`, IP=`comms-admin-dashboard`, Status=`Planned`

Makes the admin panel the operations surface for the `@terreno/comms` layer: filterable
delivery logs (channel, provider, status, error code/class, recipient, date range, free
text), a message detail view with per-attempt history and raw provider metadata for log
digging, one-click and bulk retry of failed sends, and a stats endpoint for failure-rate
cards. Builds on the error taxonomy, lifecycle hooks, and payload retention added to the
comms abstraction.

- **Implementation plan:** [comms-admin-dashboard.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/comms-admin-dashboard.md)
- **Tasks:** [comms-admin-dashboard.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/comms-admin-dashboard.md)
- **RTK flag:** Partial — screens use the generated SDK; migrate with syncdb like other admin screens
- **Depends on:** comms-abstraction

---

## password-reset-and-email-verification

**Title:** `[Roadmap] Password reset and email verification`

**Labels:** `area:auth`, `type:feature`
**Project fields:** Area=`auth`, Target=`Next`, Impact=`Feature`, IP=`password-reset-and-email-verification`, Status=`Planned`

Closes a functional hole: the `@terreno/rtk` client already exposes a `resetPassword`
endpoint but no backend route implements it, and there is no email verification flow.
Adds token-issuing reset and verification routes to the JWT auth path, wires Better Auth's
equivalents, and sends the emails through `@terreno/comms`.

- **Implementation plan:** [password-reset-and-email-verification.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/password-reset-and-email-verification.md)
- **Tasks:** [password-reset-and-email-verification.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/password-reset-and-email-verification.md)
- **RTK flag:** None
- **Depends on:** comms-abstraction, comms-adapter-sendgrid

---

## inbound-webhooks

**Title:** `[Roadmap] Inbound webhook framework`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Terreno has outbound notifiers (Slack, Google Chat, Zoom) but no framework for receiving
webhooks from external services. Adds a plugin for registering webhook endpoints with
signature verification, raw-body handling, idempotency/replay protection, and event
dispatch — required by Stripe billing and by Twilio/Expo delivery status callbacks.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** —

---

## orgs-and-teams

**Title:** `[Roadmap] Organizations, teams, and multi-tenant scoping`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`orgs-and-teams`, Status=`Planned`

Terreno's data model is per-user: `ownerId`, `OwnerQueryFilter`, and owner permissions.
B2B apps need organizations. This adds Organization and Membership models, an org-context
middleware, an `OrgQueryFilter` and org-scoping schema plugin for modelRouter, and
membership-aware permission classes — the tenant analog of the existing owner stack.
Invitations and the management UI are separate items.

- **Implementation plan:** [orgs-and-teams.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/orgs-and-teams.md)
- **Tasks:** [orgs-and-teams.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/orgs-and-teams.md)
- **RTK flag:** None
- **Depends on:** —

---

## rbac-permissions

**Title:** `[Roadmap] Role-based access control`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`rbac-permissions`, Status=`Planned`

Replaces the binary `admin` flag + owner checks with a first-class RBAC module: a typed
permission vocabulary on Better Auth's access-control engine, DB-backed roles editable in
the admin panel, document-level scopes, field-level views, and one `can()` check enforced
across REST, websockets, MCP tools, and admin. An API design draft already exists;
`orgs-and-teams` extends it with org-scoped grants.

- **Implementation plan:** [rbac-permissions.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/rbac-permissions.md)
- **Tasks:** *(TBD — design doc predates task split)*
- **RTK flag:** None
- **Depends on:** —

---

## invitations-and-seats

**Title:** `[Roadmap] Invitations and seat management`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Lets an org admin invite teammates by email: invite tokens with expiry, accept/decline
flows for existing and new users, role assignment on acceptance, and seat counting that
billing can later enforce. Emails go through `@terreno/comms`.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** orgs-and-teams, comms-abstraction, comms-adapter-sendgrid

---

## org-management-ui

**Title:** `[Roadmap] Org switcher and member management screens`

**Labels:** `area:ui`, `type:feature`
**Project fields:** Area=`ui`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

The frontend counterpart of the tenancy track: an organization switcher, members list with
roles, invite flow, and org settings screens in `@terreno/ui` + example-frontend, working
on web and native.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** Partial — screens should target the syncdb data layer where available
- **Depends on:** orgs-and-teams, rbac-permissions, invitations-and-seats

---

## billing-stripe

**Title:** `[Roadmap] Stripe billing and subscriptions`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`billing-stripe`, Status=`Planned`

Adds a billing plugin on Stripe (web-first, decision D1): customers mapped to
organizations, subscription and plan models, checkout/portal session routes,
webhook-driven entitlement sync, and plan gating that plugs into the existing feature-flag
layer. Includes basic plan-picker and billing settings screens. Mobile in-app purchases
are a separate item.

- **Implementation plan:** [billing-stripe.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/billing-stripe.md)
- **Tasks:** [billing-stripe.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/billing-stripe.md)
- **RTK flag:** None
- **Depends on:** orgs-and-teams, inbound-webhooks

---

## native-module-baseline

**Title:** `[Roadmap] Native module baseline for the next major release`

**Labels:** `area:ui`, `type:chore`, `breaking`
**Project fields:** Area=`ui`, Target=`Next`, Impact=`Breaking`, IP=*(not yet written)*, Status=`Planned`

Adding a native module to a Terreno app forces a new dev-client/store binary, so every
native dependency the B2B program needs lands in one major release: Stripe payment sheet,
RevenueCat purchases, `expo-device`, `expo-crypto`, `expo-local-authentication`,
`expo-system-ui`, and `react-native-otp-verify`, plus config plugins and refreshed EAS
builds. After this release, the rest of the program ships as JS/OTA updates against the
same binary. Manifest finalized 2026-08-09 (decisions D1/D3/D7); TenTap excluded
(markdown stays).

- **Implementation plan:** [native-module-baseline.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/native-module-baseline.md)
- **Tasks:** [native-module-baseline.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/native-module-baseline.md)
- **RTK flag:** None
- **Depends on:** —

---

## create-terreno-app

**Title:** `[Roadmap] create-terreno-app scaffolding CLI`

**Labels:** `area:dx`, `type:feature`
**Project fields:** Area=`dx`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Today the MCP bootstrap tool returns markdown instructions and writes no files. This ships
a real `create-terreno-app` CLI (or template repo) that produces a running, deployable app
— backend, Expo app, env files, seeded auth — in one command, with the MCP bootstrap
delegating to it.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** Partial — scaffold output follows the syncdb + Better Auth direction
- **Depends on:** deployment-foundation

---

## charts-and-dashboards

**Title:** `[Roadmap] Charts and dashboard primitives`

**Labels:** `area:ui`, `type:feature`
**Project fields:** Area=`ui`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

`@terreno/ui` has a stubbed `Chart` export and no implementation. Adds themed chart
components (line, bar, area, donut) on `victory-native` — JS-only, since its Skia /
Reanimated / Gesture Handler peers are already linked — plus a simple dashboard grid
layout, with demo stories and docs.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** —

---

## dark-mode-theme

**Title:** `[Roadmap] First-class dark mode`

**Labels:** `area:ui`, `type:feature`
**Project fields:** Area=`ui`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

The theming system has three layers but no built-in dark theme; the example app fakes one
by swapping primitives behind a feature flag. Ships a maintained dark palette, a
`colorScheme` API on `TerrenoProvider` (system/light/dark), and `expo-system-ui` wiring so
root views and system chrome follow the scheme.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** native-module-baseline (`expo-system-ui`)

---

## data-grid-server-filters

**Title:** `[Roadmap] DataTable server-side filtering and search`

**Labels:** `area:ui`, `type:feature`
**Project fields:** Area=`ui`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

DataTable sorts and paginates but has no filter UI. Adds per-column filter controls and a
search box that emit modelRouter-compatible query params (`queryFields`, `$and`/`$or`), so
list screens get server-side filtering without custom plumbing. Admin tables adopt it.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** Partial — query wiring examples depend on the frontend data layer
- **Depends on:** —

---

## mobile-iap-revenuecat

**Title:** `[Roadmap] Mobile in-app purchases (RevenueCat)`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Future`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Store-compliant mobile subscriptions via RevenueCat (`react-native-purchases`): entitlement
sync into the billing models through webhooks, paywall UI, and unified entitlements with
Stripe web billing (decision D1: web-first, mobile IAP later). The native SDK ships in the
native module baseline regardless, so this lands as a JS/OTA feature when scheduled.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** billing-stripe, native-module-baseline, inbound-webhooks

---

## notification-center

**Title:** `[Roadmap] In-app notification center`

**Labels:** `area:ui`, `type:feature`
**Project fields:** Area=`ui`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Adds a Notification model with per-user preferences, realtime delivery over the existing
change-stream socket layer, and a bell/inbox UI in `@terreno/ui` with read/unread state —
the in-app channel beside `@terreno/comms` mail/SMS/push.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** Partial — inbox screens target the syncdb data layer where available
- **Depends on:** comms-abstraction

---

## command-palette

**Title:** `[Roadmap] Command palette (⌘K)`

**Labels:** `area:ui`, `type:feature`
**Project fields:** Area=`ui`, Target=`Future`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

A themable ⌘K palette component for web (with a native fallback surface): registerable
actions, navigation targets, and async search sources. Admin panel adopts it first.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** —

---

## wizard-stepper

**Title:** `[Roadmap] Generic multi-step wizard component`

**Labels:** `area:ui`, `type:feature`
**Project fields:** Area=`ui`, Target=`Future`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Extracts the multi-step patterns hand-rolled in signup and consent flows into a generic
wizard/stepper: step state, validation gates, progress indicator, and per-step persistence
— the building block for onboarding and setup flows.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** —

---

## wysiwyg-editor

**Title:** `[Roadmap] Rich text (WYSIWYG) editor`

**Labels:** `area:ui`, `type:feature`
**Project fields:** Area=`ui`, Target=`Future`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Terreno's rich text today is markdown-only (`MarkdownEditor`), and decision D3 keeps it
that way for now. This item tracks a future adoption of a true WYSIWYG editor (candidate:
TenTap, Tiptap-based). Because TenTap requires a native module that is **not** in the
native module baseline, adopting it means waiting for a later major release.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** a future major release (native module not in the current baseline)

---

## global-search

**Title:** `[Roadmap] Global search across entities`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Future`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

A search framework for modelRouter models: per-model searchable-field registration, a
cross-model search endpoint with permission-aware results, Mongo text/Atlas Search backends,
and a search UI hook — feeding the command palette and app-level search bars.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** —

---

## enterprise-sso

**Title:** `[Roadmap] Enterprise SSO (SAML / OIDC)`

**Labels:** `area:auth`, `type:feature`
**Project fields:** Area=`auth`, Target=`Future`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Org-level single sign-on: SAML and OIDC via Better Auth's SSO tooling, per-organization
IdP configuration, JIT user provisioning into org memberships, and domain-based login
routing. The mobile flow uses `expo-auth-session` + `expo-crypto` (PKCE) from the native
baseline.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** orgs-and-teams, native-module-baseline

---

## mfa-step-up-auth

**Title:** `[Roadmap] MFA and biometric step-up auth`

**Labels:** `area:auth`, `type:feature`
**Project fields:** Area=`auth`, Target=`Future`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Second-factor support: TOTP enrollment, SMS/email OTP via the Twilio Verify adapter, and
biometric step-up on native (`expo-local-authentication`) for sensitive actions, with
enforcement hooks in the permission layer.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** comms-adapter-twilio-verify, native-module-baseline

---

## framework-audit-log

**Title:** `[Roadmap] Framework-level audit log`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Generalizes the admin/consent audit patterns into a first-class audit log: an AuditEvent
model, modelRouter hooks that record who changed what (with before/after diffs), org
scoping, retention policy, and an admin viewer — a hard requirement for compliance-minded
B2B customers.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** orgs-and-teams

---

## rate-limiting

**Title:** `[Roadmap] API rate limiting`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Adds HTTP rate limiting to `@terreno/api`: per-user/per-org/per-IP policies, sensible
defaults for auth and OTP endpoints, memory and Redis stores, and standard rate-limit
headers. Today only realtime subscriptions are capped.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** —

---

## job-queues

**Title:** `[Roadmap] Durable background jobs`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

Terreno has an in-process cron helper and admin script runner but no durable queue. Adds a
job abstraction with retries, scheduling, and dead-lettering — Mongo-backed by default with
a Redis/BullMQ driver — so email sends, webhook retries, and billing sync survive restarts.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** —

---

## mongo-migrations

**Title:** `[Roadmap] MongoDB migrations tooling`

**Labels:** `area:api`, `type:feature`
**Project fields:** Area=`api`, Target=`Future`, Impact=`Feature`, IP=*(not yet written)*, Status=`Planned`

A migrations runner for Terreno apps: versioned migration files, up/down with a lock
collection, CI checks, and integration with the mongoose-schema-safety guidance — replacing
ad-hoc backfill scripts.

- **Implementation plan:** *(not yet written)*
- **Tasks:** *(not yet written)*
- **RTK flag:** None
- **Depends on:** —

---

# Shipped, umbrella, and declined IPs

Tracking issues created for IPs that previously lacked a `**Roadmap issue:**` header.
Add each to the **Terreno Roadmap** project with the `IP` field set to the slug below.

| IP slug | GitHub issue | Status |
|---------|--------------|--------|
| `admin-only` | https://github.com/TerrenoLabs/terreno/issues/1075 | Shipped |
| `admin-ui-v2-django-parity` | https://github.com/TerrenoLabs/terreno/issues/1076 | Shipped |
| `admin-script-runner` | https://github.com/TerrenoLabs/terreno/issues/1077 | Shipped |
| `consent-forms` | https://github.com/TerrenoLabs/terreno/issues/1078 | Shipped |
| `upgrade-banner` | https://github.com/TerrenoLabs/terreno/issues/1079 | Shipped |
| `apierror-standard-error-redesign` | https://github.com/TerrenoLabs/terreno/issues/1080 | Shipped |
| `syncdb-local-first` | https://github.com/TerrenoLabs/terreno/issues/1081 | Shipped |
| `feature-flags-openfeature` | https://github.com/TerrenoLabs/terreno/issues/1082 | Shipped |
| `design-blend-skill` | https://github.com/TerrenoLabs/terreno/issues/1083 | Shipped |
| `ModularAPI` | https://github.com/TerrenoLabs/terreno/issues/1084 | Shipped |
| `mcp-boost-parity` | https://github.com/TerrenoLabs/terreno/issues/1085 | In progress |
| `docs-site-and-versioning` | https://github.com/TerrenoLabs/terreno/issues/1086 | Planned |
| `syncdb-codegen` | https://github.com/TerrenoLabs/terreno/issues/1087 | Planned |
| `migrate-cicd-to-circleci` | https://github.com/TerrenoLabs/terreno/issues/1088 | Planned |
| `rbac-permissions` | https://github.com/TerrenoLabs/terreno/issues/1089 | Planned |
| `infra-mcp` | https://github.com/TerrenoLabs/terreno/issues/1090 | Planned (blocked) |
| `comms-admin-dashboard` | https://github.com/TerrenoLabs/terreno/issues/1091 | Planned |
| `model-router-mcp` | https://github.com/TerrenoLabs/terreno/issues/1092 | Planned |
| `terreno-langfuse-integration` | https://github.com/TerrenoLabs/terreno/issues/1093 | Future |
| `oss-launch-program` | https://github.com/TerrenoLabs/terreno/issues/1094 | In progress |
| `b2b-platform-program` | https://github.com/TerrenoLabs/terreno/issues/1095 | Planned |
| `offline-mode` | https://github.com/TerrenoLabs/terreno/issues/1096 | Declined |
| `model-router-actions` | https://github.com/TerrenoLabs/terreno/issues/1097 | Declined |
| `feature-flags` | https://github.com/TerrenoLabs/terreno/issues/1098 | Declined |
| `admin-improvements` | https://github.com/TerrenoLabs/terreno/issues/1099 | Declined |

Research and design sub-documents share the parent IP's issue: `admin-only-research` →
#1075; `infra-mcp-research` → #1090; `migrate-cicd-to-circleci-research` → #1088;
`syncdb-phase-c-design`, `terreno-syncdb-2`, and `syncdb-api-inventory` → #1081.
