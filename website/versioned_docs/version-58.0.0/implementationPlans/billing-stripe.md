# Implementation Plan: Stripe billing and subscriptions

**Status:** Approved
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1025
**Priority:** High
**Effort:** Epic
**Owner:** unassigned
**Created:** 2026-08-09
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** [org-management-ui](org-management-ui.md), [inbound-webhooks](inbound-webhooks.md) (hard dependency for Phase 3)
**RTK deprecation flag:** None for the backend; the two screens in Phase 4 follow whatever
data layer example-frontend uses at that time

## Goal

Terreno has no way to charge customers. This IP adds `@terreno/billing`, a Stripe-backed
(decision D1: web-first) billing plugin: Stripe customers mapped to organizations,
code-defined plans mapped to Stripe prices, Checkout and Billing Portal session routes,
webhook-driven subscription/entitlement sync, and plan gating that plugs into the existing
feature-flag layer — so `plan: "pro"` can gate features the same way segments do today.

## Non-Goals

- Mobile in-app purchases (`mobile-iap-revenuecat`, Future — the RevenueCat SDK ships in
  the native baseline so it can land without another major).
- Usage-based/metered billing, invoicing customization, tax configuration (Stripe Tax is
  configured in Stripe, not by Terreno).
- Payment methods beyond what Stripe Checkout/Portal handle.
- Seat-count enforcement (lands with `invitations-and-seats` integration, Phase 5/future).

## Decisions

| Question | Decision |
|----------|----------|
| Package | New workspace package `@terreno/billing` with `stripe` as a real dependency (vendor-specific by design per D1; a provider abstraction is not warranted for one vendor) |
| Billing subject | The **organization** (B2B); optional `subject: "user"` mode for consumer apps |
| Plan definition | Code-defined `plans: [{id, name, stripePriceId, features: string[]}]` passed to `BillingApp` — plans are reviewed code, prices live in Stripe |
| Checkout UX | Stripe-hosted Checkout + Billing Portal (web-first per D1); no custom card forms; `@stripe/stripe-react-native` payment sheet arrives with the IAP item if ever needed |
| Source of truth | Stripe is authoritative; local `BillingSubscription` is a webhook-synced cache — no entitlement decision ever calls Stripe inline |
| Entitlements | `getEntitlements(orgId)` service + a feature-flag segment factory (`planSegment("pro")`) plugging into `FeatureFlagsApp` segments; optional `RequiresPlan("pro")` permission |
| Webhooks | Consumed through the inbound-webhooks framework with Stripe signature verification and event idempotency (`stripeEventId` unique index) |

## Architecture

```
billing/
  src/
    billingApp.ts        # BillingApp TerrenoPlugin (routes, webhook registration)
    billingService.ts    # getEntitlements, planSegment, RequiresPlan
    stripeSync.ts        # webhook event handlers → model sync
    models/
      billingCustomer.ts   # orgId ↔ stripeCustomerId
      billingSubscription.ts
      billingEvent.ts      # processed webhook events (idempotency)
```

```typescript
new BillingApp({
  stripeSecretKey: env,
  webhookSecret: env,
  plans: [{id: "pro", name: "Pro", stripePriceId: "price_...", features: ["ai", "sso"]}],
  subject: "organization",              // default
  onSubscriptionChange?: (sub) => Promise<void>;
})
```

Webhook events handled: `checkout.session.completed`,
`customer.subscription.created|updated|deleted`, `invoice.payment_failed`,
`invoice.paid`. Each handler is idempotent via `BillingEvent`.

## Models

Five-type pattern, descriptions, `createdUpdatedPlugin` + `isDeletedPlugin`.

**BillingCustomer** — `organizationId` (ref, required, unique indexed),
`stripeCustomerId` (string, unique indexed), `email` (string).

**BillingSubscription** — `organizationId` (ref, required, indexed), `planId` (string —
Terreno plan id), `stripeSubscriptionId` (string, unique), `status` (Stripe status enum:
active/trialing/past_due/canceled/…), `currentPeriodEnd` (date), `cancelAtPeriodEnd`
(boolean), `seats` (number, optional).

**BillingEvent** — `stripeEventId` (string, unique), `type` (string), `processedAt`
(date), `error` (string, optional).

## APIs

| Method | Path | Permissions | Notes |
|---|---|---|---|
| GET | `/billing/plans` | IsAuthenticated | Code-defined plans (no Stripe call) |
| GET | `/billing/subscription` | IsOrgMember | Current org's subscription + entitlements |
| POST | `/billing/checkoutSession` | IsOrgAdmin | `{planId}` → Stripe Checkout URL; creates customer on first use |
| POST | `/billing/portalSession` | IsOrgAdmin | Stripe Billing Portal URL |
| POST | `/billing/webhooks/stripe` | signature-verified | Via inbound-webhooks framework; raw body |

## Notifications

`invoice.payment_failed` fires `onSubscriptionChange` and sends a dunning email through
`@terreno/comms` when a mail provider is configured (template `paymentFailed`).

## UI

Phase 4, kept deliberately thin: a plan-picker screen (`GET /billing/plans` + checkout
redirect) and a billing settings card (current plan, status, portal link). Admin org
settings show a billing placeholder until this IP ships (see `org-management-ui`).

## Phases

1. **Package + models:** `@terreno/billing` scaffold, three models, plan config
   validation, unit tests.
2. **Checkout + portal:** customer creation, session routes, `getEntitlements`,
   `planSegment`, `RequiresPlan`, tests with mocked Stripe SDK.
3. **Webhook sync** *(gated on inbound-webhooks)*: register `POST /billing/webhooks/stripe`
   on the shared `WebhooksApp` with `stripeSignature`. Do not fork parsers. Idempotent
   handlers, dunning email, `stripe-mock`/fixture tests.
4. **UI + example + docs:** plan picker + billing settings in example-frontend, seeds
   with Stripe test-mode instructions, `docs/how-to/add-billing.md`, SDK regen.

## Feature Flags & Migrations

New collections only. Entitlement gating composes with existing feature flags — a flag can
target `planSegment("pro")` exactly like today's `pro-users` segment example.

## Activity Log & User Updates

Subscription lifecycle changes logged via `logger` + `BillingEvent`; org-facing billing
history is the Stripe Portal's job, not Terreno's.

## Not Included / Future Work

- RevenueCat entitlement merge (`mobile-iap-revenuecat`).
- Seat enforcement against Membership counts (`invitations-and-seats` follow-up).
- Metered usage, coupons/promotions management, multi-currency handling beyond Stripe
  defaults.

## Files to Create / Modify

- `billing/` (new workspace package), root `package.json` workspace + scripts
- `example-backend/src/server.ts` — env-gated `BillingApp` registration
- `example-frontend` — two screens + SDK regen
- `docs/how-to/add-billing.md`, `docs/reference/billing.md`, env reference
- `.github/workflows/billing-ci.yml`, `publish-on-tag.yml`

## Task List

See [docs/tasks/billing-stripe.md](../tasks/billing-stripe.md).

## Acceptance Criteria

- [ ] An org admin can create a Checkout session for a plan and, after the (test-mode)
      webhook lands, `GET /billing/subscription` reports the active plan and entitlements.
- [ ] Webhook events are signature-verified and idempotent: replaying the same
      `stripeEventId` is a no-op.
- [ ] A feature flag targeting `planSegment("pro")` evaluates true only for members of a
      subscribed org; `RequiresPlan("pro")` returns 403 otherwise.
- [ ] Subscription cancellation (portal) downgrades entitlements after the webhook, not
      before.
- [ ] Non-admin org members cannot create checkout/portal sessions.
- [ ] Entitlement checks perform zero inline Stripe API calls.
