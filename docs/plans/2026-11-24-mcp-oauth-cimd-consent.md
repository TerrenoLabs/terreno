# MCP OAuth: Claude's published identity, built-in consent page, owner-only approval

**Status:** Approved 2026-11-24 (Josh)
**Depends on IPs:** none
**Needed by:** Pier `docs/plans/2026-11-24-factory-machine-api.md` (none), Shade
`docs/implementationPlans/Factory-On-Pier.md` (IP-121, its template tasks)

Terreno's MCP OAuth (`api/src/mcp/oauth.ts`) supports pre-registered clients and dynamic client
registration (DCR). Claude.ai's recommended connector option, "Use Claude's published identity",
needs neither: the `client_id` is an https URL Anthropic hosts (a Client ID Metadata Document,
CIMD) that lists the client's redirect URIs. Terreno can't accept it today, so a Terreno app
can't be added to Claude.ai by URL alone. Consent also has two gaps for single-owner apps:
the consent screen is an SPA page (admin-spa, which has no 2FA UI), and any signed-in user may
approve, with no second factor.

This plan adds three opt-in `mcpOAuth` options, proven by hand first in
`~/src/hothoney/src/auth/` (live at `https://avotoast-mcp.nang.io`):

1. `clientIdMetadataDocuments`: accept allowlisted CIMD client ids.
2. `consent: {mode: "builtin"}`: a server-rendered consent page that asks for email,
   password and a TOTP code on every approval, so no SPA is needed.
3. `consent.requireAdmin` / `consent.requireTwoFactor`: who may approve, enforced on the
   built-in page and on the existing JSON approve endpoint.

## The idea

**CIMD resolves into an ordinary client row.** At `GET /oauth/authorize`, a `client_id` on the
allowlist is fetched (exact URL only, `redirect: "manual"`, 5 s timeout, 16 KiB cap, cached
10 minutes on success), checked (`client_id` in the document equals the URL; `redirect_uris`
is a non-empty string array), and upserted into `McpOAuthClient` as a public client
(`tokenEndpointAuthMethod: "none"`, grants `authorization_code` + `refresh_token`). From then on
token exchange, refresh, `discardIssuedIfClientRevoked`, revocation and admin listing work
unchanged. A revoked CIMD client stays revoked: the upsert refuses it, the authorize step shows
an error page, and it never redirects. The allowlist is the SSRF control: no other URL is ever
fetched.

**The built-in consent page reuses Better Auth, in-process.** Password and TOTP are checked
against the user's Better Auth credential account and `twoFactor` record through Better Auth's
server API, not reimplemented. A used TOTP step can't be replayed, and five failures in
15 minutes lock consent. The approve logic moves into one function shared by the JSON endpoint
and the page.

Rejected: 2FA in admin-spa (frontend work, and consent would still trust a long-lived session);
a page in each app (every app re-solves the same security problem).

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | CIMD client resolution + metadata flag | none | `api/src/mcp/oauth.ts`, `oauthMetadata.ts`, `types/mcpOAuth.ts` | `bun test api/src/mcp/oauth.test.ts` |
| T2 | Approval policy: `requireAdmin`, `requireTwoFactor` on the JSON endpoints | none | `oauth.ts` | same |
| T3 | Built-in consent page (email + password + TOTP, lockout, replay) | T2 | `api/src/mcp/oauthConsentPage.ts` (new), `oauth.ts` | `bun test api/src/mcp/oauthConsentPage.test.ts` |
| T4 | Example app, docs, changelog, release | T1, T3 | `example-backend`, `docs/`, `changelog/unreleased/` | `bun run check:changelog`, docs build |

## Requirements

| ID | Requirement (the request's words) | Tasks | Agent tests | Manual |
| --- | --- | --- | --- | --- |
| R1 | "make it so this works with 'use claudes published identity'" | T1 | T1 cases | M1 |
| R2 | TOTP required on consent, like hothoney | T3 | T3 cases | M1 |
| R3 | Only the owner (an admin with 2FA) may approve a connector | T2, T3 | T2 cases | none |

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | CIMD authorize → built-in consent (password + TOTP) → token → `/mcp` tools/list → refresh → revoke | supertest | R1–R3 together | T3 |

## Regression cases

Destination: `docs/how-to/enable-mcp-oauth.md` "Verify" section.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Existing DCR flow unchanged | the current `oauth.test.ts` DCR suite | passes unchanged | api | existing tests | T1 |
| G2 | SPA consent (`consentUrl`) unchanged when `consent` unset | existing consent tests | passes unchanged | api | existing tests | T2 |

## Manual

| ID | Check | When |
| --- | --- | --- |
| M1 | Add the example backend as a Claude.ai connector with "Use Claude's published identity"; approve with password + TOTP; call a tool | after T4, before release |

## Design

### Options (`McpOAuthOptions`)

```ts
interface McpOAuthOptions {
  // ...existing fields...
  /** Accept these CIMD client ids (exact https URLs). Off when absent or empty. */
  clientIdMetadataDocuments?: {
    allowedClientIds: string[];
    /** Injected for tests; defaults to global fetch. */
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  };
  consent?: {
    /** "builtin" serves the consent page itself; "url" (default) redirects to consentUrl. */
    mode?: "builtin" | "url";
    /** Only users with admin: true may approve. Default false. */
    requireAdmin?: boolean;
    /** Only users with Better Auth 2FA enabled may approve; builtin mode checks a code each time. */
    requireTwoFactor?: boolean;
  };
}
```

- `consentUrl` becomes optional when `consent.mode === "builtin"`, and is required otherwise.
- `requireTwoFactor` throws at boot when Better Auth `twoFactor` isn't configured.
- An allowlisted id must be `https:` with no query or fragment; otherwise boot throws.
- Metadata adds `client_id_metadata_document_supported: true` when the allowlist is
  non-empty. `token_endpoint_auth_methods_supported` already lists `none`, which Claude also
  requires before it picks CIMD.

### Built-in page

| Route | Does |
| --- | --- |
| `GET /oauth/consent/:request` | Renders client name, redirect origin and scope, plus a form for email, password and TOTP code. CSP `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' <redirect origin>; frame-ancestors 'none'`; `no-store`. |
| `POST /oauth/consent/:request` | `decision=deny` → denies through the existing deny path. `approve` → lockout check → password → TOTP (replay-checked) → policy (`requireAdmin`) → the shared approve function → 302 to the client's redirect with `code`, `state` and `iss`. |

In builtin mode `/oauth/authorize` redirects to `/oauth/consent/:request` instead of
`consentUrl`. Lockout state and used TOTP steps live in Mongo (new `McpOAuthConsentAttempt`
model with TTL indexes), so lockout holds across serverless or multi-instance deploys.

## Assumptions

- Better Auth's server API can verify a password and a TOTP code in-process without leaving
  a session behind. If it can't, T3 verifies the TOTP itself against the `twoFactor` record's
  secret using Better Auth's own symmetric decrypt helper, and records which in the docs.
- The CIMD fetch happens only at `GET /oauth/authorize`. Consent and token use the stored row.

## Tasks

### Phase 1 — protocol

- [ ] **T1** — CIMD client resolution and metadata flag
  - Size: M
  - Depends on: none
  - Files: `api/src/mcp/oauthMetadata.ts` (option, resolve, metadata), `api/src/mcp/oauth.ts`
    (authorize lookup, upsert, the `GET /oauth/authorize/:request` revoked check),
    `api/src/mcp/oauthClientMetadataDocument.ts` (new: fetch, validate, cache),
    `api/src/types/mcpOAuth.ts`, `api/src/models/mcpOAuthClient.ts` (static `upsertFromMetadataDocument`)
  - Criteria:
    - The authorization-server metadata has `client_id_metadata_document_supported: true` only
      when the allowlist is non-empty.
    - An allowlisted id renders consent (302 to the consent URL) after one fetch. A second
      authorize within 10 minutes doesn't fetch.
    - A non-allowlisted URL id gets 400 "Unknown client_id", and the fetcher is never called.
    - A mismatched `client_id`, a non-200, a redirect response, an oversized body or invalid
      JSON all get 400 with no redirect.
    - Loopback redirects from the Claude Code document (`http://localhost/callback`) match any
      port, using the existing `redirectUriMatchesRegistered`.
    - A CIMD client completes code → token → `/mcp` → refresh.
    - `McpOAuthClient.revoke(url)` kills its tokens, and a later authorize for that id gets 400.
    - Existing gap fixed: `GET /oauth/authorize/:request` refuses a revoked client.
  - Seam: HTTP through `TerrenoApp` (supertest), with the fetcher injected
  - Interface: `clientIdMetadataDocuments` option above
  - Cases: allowlisted ok; not allowlisted (no fetch); client_id mismatch; 404; 302 from
    document host; 20 KiB body; non-array `redirect_uris`; cache hit; revoked; loopback any
    port; https different port rejected
  - Blast radius: every app using `mcpOAuth`; the option is off by default
  - Test skills: none found
  - Verify: `cd api && bun test src/mcp/oauth.test.ts src/mcp/oauthMetadata.test.ts`
  - Docs: `docs/how-to/enable-mcp-oauth.md` ("Choose how clients get a client_id"),
    `docs/reference/api.md` (MCP OAuth)
  - Skills: none found

- [ ] **T2** — Approval policy on the JSON consent endpoints
  - Size: S
  - Depends on: none
  - Files: `api/src/mcp/oauth.ts` (extract `approveAuthorization`; apply policy in
    `POST /oauth/authorize/:request/approve`), `oauthMetadata.ts` (`consent` option, boot checks)
  - Criteria:
    - With `requireAdmin`, a non-admin's approve gets 403 and the authorization stays pending.
    - With `requireTwoFactor`, a user without `twoFactorEnabled` gets 403.
    - With neither set, behaviour is unchanged (G2).
    - `requireTwoFactor` without Better Auth `twoFactor` throws at boot.
  - Seam: supertest on the approve endpoint
  - Cases: admin ok; non-admin 403; 2FA off 403; both unset unchanged; boot error
  - Blast radius: consent for apps that opt in
  - Verify: `cd api && bun test src/mcp/oauth.test.ts`
  - Docs: `docs/how-to/enable-mcp-oauth.md` (consent section), `docs/reference/api.md`

### Phase 2 — built-in consent

- [ ] **T3** — Built-in consent page with password + TOTP
  - Size: L
  - Depends on: T2
  - Files: `api/src/mcp/oauthConsentPage.ts` (new), `api/src/models/mcpOAuthConsentAttempt.ts`
    (new: failures and used TOTP steps, TTL), `api/src/mcp/oauth.ts` (authorize redirect in
    builtin mode), `api/src/mcp/oauthConsentPage.test.ts` (new)
  - Criteria:
    - In builtin mode, authorize redirects to `/oauth/consent/:request`, and the page has the
      CSP above with the redirect origin in `form-action`.
    - Right email, password and TOTP → 302 to the redirect with `code`, `state` and `iss`; the
      code exchanges.
    - Wrong password or wrong TOTP → 400 page, with no code issued.
    - The same TOTP step reused → 400.
    - Five failures in 15 minutes → "Too many failed attempts", even with correct credentials.
    - `requireAdmin` is enforced (a non-admin with valid credentials → 400).
    - Deny → 302 with `error=access_denied`.
    - An expired or unknown request → 400 page, no redirect.
    - E1 passes.
  - Seam: supertest over `TerrenoApp` with Better Auth + `twoFactor`, enrolled with the
    existing `enrollTwoFactor` / `totpCode` test helpers
  - Cases: success; bad password; bad TOTP; replay; lockout; non-admin; deny; tampered or
    expired request; CSP header; no-store
  - Blast radius: new routes, only when `consent.mode === "builtin"`
  - Verify: `cd api && bun test src/mcp/oauthConsentPage.test.ts src/mcp/oauth.test.ts`
  - Docs: `docs/how-to/enable-mcp-oauth.md` (new "Built-in consent page" section),
    `docs/explanation/authentication.md` (consent and 2FA)

### Phase 3 — ship

- [ ] **T4** — Example app, docs, changelog, release
  - Size: S
  - Depends on: T1, T3
  - Files: `example-backend/src/server.ts` (opt in behind `MCP_OAUTH_CIMD=true`),
    `changelog/unreleased/mcp-oauth-cimd-consent.md` (`category: Added`), docs above,
    generated reference (`docs/reference/generated/api/`)
  - Criteria:
    - `bun run check:changelog` passes.
    - Docs describe all three options, each with one minimal example.
    - M1 done, or recorded as pending with the reason.
    - Released as the next 58.x minor, with the version noted in the Shade IP-121 T1 brief.
  - Seam: docs and changelog checks
  - Verify: `bun run check:changelog && bun run test:agent`
  - Docs: as listed
  - Skills: none found

## Expansions

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Generic CIMD (any https client id, with SSRF guards) | other MCP clients publish documents too | M | T1 |
| X2 | 2FA enrollment UI in admin-spa | apps that want SPA consent with 2FA | L | none |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| Q1 | Where consent and TOTP live | B: built-in server-rendered page in Terreno `mcpOAuth`, password + TOTP each approval | T3 exists; admin-spa untouched |
| Q3 | Who may approve | A: Terreno option, admins with 2FA only; off by default | T2 |
| Q6a | (context) CIMD allowlist only | the two claude.ai URLs, chosen for hothoney and kept | T1 allowlist, X1 parked |

## Rejected

| ID | Idea | Rejected by | Why |
| --- | --- | --- | --- |
| J1 | 2FA in admin-spa for consent | Josh (Q1) | frontend work; trusts a long session |
| J2 | DCR for Claude | earlier mcp-test spike | Claude's DCR is refused by these apps; CIMD replaces it |

## Sign-off

Status: approved 2026-11-24 (Josh). Grilled in rounds Q1–Q11 together with the Pier and Shade plans.
