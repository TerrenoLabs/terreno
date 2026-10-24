---
name: set-up-social-login
description: >-
  Set up Google, GitHub, and Sign in with Apple in a Terreno app on Better Auth: server config,
  callback URLs for local dev, previews, and the stable deploy, provider registration, secrets,
  trying the providers on one preview first, choosing same-site hosts, and checking the result.
  Use when asked to "add Google/Apple/GitHub login", "set up social login" or OAuth, "register
  the OAuth callbacks", "point OAuth at the preview", or when a social sign-in fails with a
  redirect mismatch. Not for email/password, passkey, or 2FA setup alone (see
  configure-better-auth.md).
targets: ['*']
---

# Set up social login

The human guide is [docs/how-to/set-up-social-login.md](../../../../docs/how-to/set-up-social-login.md).
Read it first; this skill is the order of work and the checks. Server fields are in
[configure-better-auth.md](../../../../docs/how-to/configure-better-auth.md#auth-features).

**Never print, commit, or paste a client secret or `.p8` key.** The user enters them into the
provider consoles and `gcloud secrets versions add` themselves. Never create secrets or change a
CI context without naming each one and getting a yes.

## Steps

1. **Find the hosts.** Read the deploy scripts (for the example, `scripts/ci/backend-auth-env.sh`
   and `scripts/ci/gcp-deploy.sh`) and write down:
   - the stable backend and web URLs, and whether they share a registrable domain;
   - the preview backend and web URL patterns;
   - which backend owns the callbacks: stable, or a preview named by `OAUTH_CALLBACK_TAG`.
   Recommend `app.<domain>` and `api.<domain>` for stable, and previews on their hosting domains,
   never under the stable domain (the guide's "Choose the hosts" says why).
2. **Configure the server.** Set `googleOAuth`, `githubOAuth`, and `appleOAuth` (key form) only
   when their env vars exist; add `https://appleid.apple.com` to `trustedOrigins` with Apple; set
   `oauthProxy.productionURL` on previews (to the callback owner) and on the owner (to itself);
   share one `BETTER_AUTH_SECRET`. Copy the pattern in
   `example-backend/src/utils/betterAuthConfig.ts`. The login and security screens need no
   change: they read `GET {basePath}/terreno/methods`.
3. **Give the user the exact URLs.** For each provider, the callback is
   `https://<callback owner>/api/auth/callback/<provider>`; local dev uses
   `http://localhost:4000` for Google and GitHub (Apple is https only). Print the full URL per
   provider, plus Apple's Domains (backend and web hosts) and GitHub's Homepage URL. Never leave
   `<placeholders>` in what the user copies.
4. **Hand over provider registration** as numbered steps from the guide's "Register each
   provider": the Google consent screen (test users while in Testing), the GitHub OAuth app, and
   the Apple Services ID plus key.
5. **Hand over the secrets.** Check `gcloud config get-value project` first; if it is not the
   project that holds the backend secrets, give `gcloud config set project <id>`. Then give the
   copy loop from "Store the secrets", with the app's secret names. It reads each value with
   `secret terreno <KEY>` from OpenBao, so no value passes through the chat; for an app without
   OpenBao, swap in its store's read command. Secrets mount at deploy, so a redeploy follows.
6. **Preview first, when stable does not run this code yet.** For the example, the user sets
   `OAUTH_CALLBACK_TAG=pr-<n>` in the `terreno-gcp` CircleCI context, registers the preview's
   backend as the callback host, adds the secrets, and approves the PR's `approve` hold. Say
   plainly that the named preview then holds the real secrets and stable has no social sign-in
   until the variable is removed.
7. **Check.** `curl -s https://<backend>/api/auth/terreno/methods | jq .` lists each provider.
   Then sign in with each one on the web app. On `redirect_uri_mismatch`, compare the URI in the
   error with the registered one character for character.

## In code you change

- A consumer app's deploy may not have `OAUTH_CALLBACK_TAG`. Add the equivalent switch only when
  the user wants preview-first, with tests like `scripts/ci/cloud-run-preview.test.ts`.
- Update the app's social-login docs and changelog in the same change (`update-docs`).
- Prove the flow without real providers with the mock OIDC provider
  (`example-frontend/e2e/helpers/mockOidcProvider.ts`); real-provider sign-in is the user's check.

## Done when

- `/terreno/methods` on the target backend lists every provider the user asked for.
- The user has signed in once with each provider, or you have reported which one is blocked and
  why (for example, Apple refusing a `run.app` host).
- The guide matches what you set up, including any new host or variable.
