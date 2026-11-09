# Implementation plan: Better Auth sync omits unset `oauthProvider`

**Status:** Complete — fix on master (`syncBetterAuthUser` omits unset `oauthProvider`)  
**Roadmap:** Area=`auth`, Target=`Released`, Impact=`Fix`  
**Issue:** https://github.com/TerrenoLabs/terreno/issues/1218  
**Branch:** `cursor/better-auth-strict-oauth-provider-3b37`  
**Created:** 2026-08-30  

## Goal

Email/password Better Auth users sync into a consumer `User` model that uses `strict: "throw"` and does **not** declare `oauthProvider`. The first authenticated `modelRouter` request after sign-up populates `req.user` (not 401).

## Non-Goals

- Adding `oauthProvider` to the `terreno bootstrap app` User schema
- Inventing or shipping `betterAuthUserPlugin` (it is documented today but does not exist in `@terreno/api`)
- Changing session-middleware behavior when sync still throws (debug log + `next()` without `req.user`)
- JWT/Passport paths
- Data migration or backfill of existing User documents

## Decisions

| Question | Decision |
|----------|----------|
| Q1 Which #1218 fix | Option 1: omit `oauthProvider` on create unless a non-empty provider string is passed |
| Bootstrap User field | Out of scope |
| OAuth without the field | Still fails `strict: "throw"`; apps that use OAuth must declare `oauthProvider` |

## Architecture

`syncBetterAuthUser` lazily creates the app `User` on the first authenticated request (`createBetterAuthSessionMiddleware`), not at Better Auth sign-up.

**Create payload today** always includes `oauthProvider: oauthProvider || null`. Mongoose `strict: "throw"` rejects the undeclared key. Sync throws, middleware swallows the error, `req.user` is unset, permissions see an unauthenticated request → 401.

**Create payload after:** spread `oauthProvider` only when `oauthProvider` is a non-empty string. Match the existing email-link branch (`if (oauthProvider) { userByEmail.oauthProvider = oauthProvider }`).

Email/password and session middleware call `syncBetterAuthUser(userModel, betterAuthUser)` with no third argument.

## Models

No schema change in `@terreno/api` or bootstrap. Consumer OAuth apps keep declaring `oauthProvider` as they do in `example-backend`.

## APIs

Public function signature unchanged: `syncBetterAuthUser(userModel, betterAuthUser, oauthProvider?)`.

## UI

None.

## Feature Flags & Migrations

None. Existing documents that already stored `oauthProvider: null` are unchanged.

## Not Included / Future Work

- Optional bootstrap field or a real `betterAuthUserPlugin` for OAuth-ready templates
- Louder logging when lazy sync fails inside session middleware

## Files to Create / Modify

| Path | Change |
|------|--------|
| `api/src/betterAuthSetup.ts` | Omit unset `oauthProvider` on create |
| `api/src/betterAuthSetup.test.ts` | `strict: "throw"` schema **without** the field; OAuth still sets the field when declared |
| `docs/how-to/configure-better-auth.md` | User model: `betterAuthId` required; `oauthProvider` only for OAuth; replace non-existent plugin example in that section |
| `docs/explanation/authentication.md` | Lazy User sync; do not write `oauthProvider` for email/password |
| `.rulesync/rules/api/00-api.md` | Same field rules; then `bun run rules` / `bun run skills:sync` |
| `changelog/unreleased/better-auth-strict-oauth-provider.md` | `Fixed` |

## Task List

[docs/tasks/better-auth-strict-oauth-provider.md](../tasks/better-auth-strict-oauth-provider.md)

## Acceptance Criteria

- [x] `syncBetterAuthUser` without a provider creates a user on `strict: "throw"` with no `oauthProvider` path
- [x] `syncBetterAuthUser(..., "google")` still sets `oauthProvider` when the schema declares the field
- [x] Existing `syncBetterAuthUser` tests stay green
- [x] How-to and explanation docs state when the field is required
- [x] Agent rule copy matches after `bun run rules`
