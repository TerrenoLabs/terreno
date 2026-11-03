# Task List: Better Auth sync omits unset `oauthProvider`

**Feature profile:** true  
**IP:** [better-auth-strict-oauth-provider.md](../implementationPlans/better-auth-strict-oauth-provider.md)  
**Issue:** https://github.com/TerrenoLabs/terreno/issues/1218

## Durable contract

- **Destination:** email/password Better Auth sync creates the app `User` on a `strict: "throw"` schema that has no `oauthProvider` field, so the first authenticated `modelRouter` request gets `req.user` instead of 401.
- **Scope:** omit `oauthProvider` on `syncBetterAuthUser` create unless a non-empty provider string is passed; regression tests; docs and agent rules; changelog fragment.
- **Non-goals:** bootstrap User schema; inventing `betterAuthUserPlugin`; session-middleware 401-on-sync-failure behavior; JWT.
- **Decisions:** Q1 = option 1 (omit unset field). OAuth apps must still declare `oauthProvider`. Do not add the field to bootstrap.
- **Tracer:** `syncBetterAuthUser` create path in `api/src/betterAuthSetup.ts`.
- **Verification seam:** focused `bun test api/src/betterAuthSetup.test.ts` (red without the payload change), then `bun run api:test` and `bun run lint`.

## Instructions for the implementing agent

- TDD: add the `strict: "throw"` regression first and confirm it fails, then change the create payload.
- Do not set `oauthProvider: null`. Omit the key.
- When updating `docs/how-to/configure-better-auth.md` § User Model, replace the `betterAuthUserPlugin` example (that export does not exist) with explicit `betterAuthId` plus optional `oauthProvider`.
- Use `backend-test-env` for any `process.env` mutations. Follow existing `betterAuthSetup.test.ts` helpers (separate MongoMemoryServer connection).
- Supporting skills: `update-docs`, `backend-test-env`, `mongoose-schema-safety`, `terreno-backend-api`.

### Phase 1: Fix lazy User create

- [x] **Task 1.1**: Omit unset `oauthProvider` on Better Auth User create
  - Delivers: email/password sign-up then first authenticated API call works on a bootstrap-like User schema (`strict: "throw"`, `betterAuthId`, no `oauthProvider`).
  - Files: `api/src/betterAuthSetup.ts`, `api/src/betterAuthSetup.test.ts`, `docs/how-to/configure-better-auth.md`, `docs/explanation/authentication.md`, `.rulesync/rules/api/00-api.md` (regenerate agent copies with `bun run rules` and `bun run skills:sync`), `changelog/unreleased/better-auth-strict-oauth-provider.md`
  - Blocked by: none
  - Docs: how-to User model fields; explanation lazy sync; agent rule field list. Do not hand-edit generated TypeDoc.
  - Skills: `update-docs`, `backend-test-env`, `mongoose-schema-safety`, `terreno-backend-api`
  - Acceptance:
    - New test: schema `{strict: "throw"}` without `oauthProvider`; `syncBetterAuthUser(model, baUser)` resolves; saved doc has `betterAuthId` and no `oauthProvider` path.
    - New test: schema that declares `oauthProvider`; third argument `"google"` persists `"google"`.
    - That first test fails on current `oauthProvider: oauthProvider || null` (StrictModeError).
    - `bun test api/src/betterAuthSetup.test.ts` and `bun run api:test` pass after the fix.
    - Docs state `betterAuthId` is required for sync; `oauthProvider` is required only when using OAuth.

## Plan vs Actual

- Task 1.1: `syncBetterAuthUser` create spreads `oauthProvider` only when truthy. Strict-throw schema without the field is green; create with `"google"` still persists. Docs dropped the non-existent `betterAuthUserPlugin` example.
