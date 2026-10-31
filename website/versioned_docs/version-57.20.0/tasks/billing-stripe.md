# Tasks: Stripe billing and subscriptions

IP: [billing-stripe](../implementationPlans/billing-stripe.md)

## Phase 1 — Package + models

- [ ] **Task 1.1**: Scaffold `@terreno/billing` package
  - Description: workspace package mirroring `feature-flags/`; root scripts
  - Files: `billing/package.json`, `billing/tsconfig.json`, root `package.json`
  - Depends on: none
  - Acceptance: compile + lint pass
- [ ] **Task 1.2**: Models (BillingCustomer, BillingSubscription, BillingEvent)
  - Description: per IP with unique indexes and descriptions
  - Files: `billing/src/models/*`
  - Depends on: 1.1
  - Acceptance: unit tests incl. unique-index violations
- [ ] **Task 1.3**: Plan config validation
  - Description: `plans` option schema (Zod), duplicate/missing price detection at startup
  - Files: `billing/src/billingApp.ts`
  - Depends on: 1.1
  - Acceptance: bad config fails fast with clear error

## Phase 2 — Checkout + portal + entitlements

- [ ] **Task 2.1**: Customer creation + checkout/portal session routes
  - Description: `POST /billing/checkoutSession` (IsOrgAdmin), `POST /billing/portalSession`, `GET /billing/plans`
  - Files: `billing/src/billingApp.ts`
  - Depends on: 1.2, org-management-ui Phase 3
  - Acceptance: mocked-Stripe supertest incl. permission denials
- [ ] **Task 2.2**: `getEntitlements` + `planSegment` + `RequiresPlan`
  - Description: cache-backed entitlement service; feature-flag segment factory; permission
  - Files: `billing/src/billingService.ts`
  - Depends on: 1.2
  - Acceptance: zero inline Stripe calls asserted; flag targeting test with FeatureFlagsApp
- [ ] **Task 2.3**: `GET /billing/subscription`
  - Description: org subscription + entitlements for members
  - Files: `billing/src/billingApp.ts`
  - Depends on: 2.2
  - Acceptance: supertest member/non-member

## Phase 3 — Webhook sync (gated on inbound-webhooks)

- [ ] **Task 3.1**: Stripe webhook route with signature verification
  - Description: raw-body route via inbound-webhooks; reject unsigned
  - Files: `billing/src/stripeSync.ts`
  - Depends on: inbound-webhooks IP
  - Acceptance: signed/unsigned fixture tests
- [ ] **Task 3.2**: Idempotent event handlers
  - Description: checkout.session.completed, subscription created/updated/deleted, invoice paid/payment_failed → model sync via `BillingEvent`
  - Files: `billing/src/stripeSync.ts`
  - Depends on: 3.1
  - Acceptance: replay of same event id is a no-op; cancellation downgrades after webhook
- [ ] **Task 3.3**: Dunning email
  - Description: `paymentFailed` template through comms when configured
  - Files: `billing/src/stripeSync.ts`, `comms/src/templates.ts`
  - Depends on: 3.2, comms-abstraction
  - Acceptance: template send asserted on payment_failed fixture

## Phase 4 — UI + example + docs

- [ ] **Task 4.1**: Plan picker + billing settings screens
  - Description: example-frontend screens per IP; SDK regen
  - Files: `example-frontend/app/**`, `store/openApiSdk.ts`
  - Depends on: Phase 2
  - Acceptance: UI verification evidence per verify-ui-changes (Stripe test mode)
- [ ] **Task 4.2**: example-backend registration + seeds + docs
  - Description: env-gated BillingApp; test-mode setup guide; how-to + reference docs
  - Files: `example-backend/src/server.ts`, `docs/how-to/add-billing.md`, `docs/reference/billing.md`
  - Depends on: Phase 2
  - Acceptance: docs build + `bun run rules:check` pass
- [ ] **Task 4.3**: CI + publish wiring
  - Description: billing-ci workflow; publish-on-tag entry
  - Files: `.github/workflows/*`
  - Depends on: 1.1
  - Acceptance: CI green
