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

Read the published guide first:
[Set up social login](https://terreno-docs.netlify.app/how-to/set-up-social-login).
Server fields are in
[Configure Better Auth](https://terreno-docs.netlify.app/how-to/configure-better-auth#auth-features).
This skill is the order of work. The guide's example deploy is one illustration; a consumer app
uses its own hosts, secret store, and deploy.

**Never print, commit, or paste a client secret or `.p8` key.** The user enters them into the
provider consoles and `gcloud secrets versions add` themselves. Never create secrets or change a
CI context without naming each one and getting a yes.

## Steps

1. **Find the hosts.** From the app's deploy config, write down:
   - the stable backend and web URLs, and whether they share a registrable domain;
   - the preview backend and web URL patterns;
   - which backend owns the callbacks: stable, or one named preview.
   Recommend `app.<domain>` and `api.<domain>` for stable, and previews on their hosting domains,
   never under the stable domain (the guide's "Choose the hosts" says why). The example's hosts
   are in that guide, not in this skill.
2. **Configure the server.** Set `googleOAuth`, `githubOAuth`, and `appleOAuth` (key form) only
   when their env vars exist; add `https://appleid.apple.com` to `trustedOrigins` with Apple; set
   `oauthProxy.productionURL` on previews (to the callback owner) and on the owner (to itself);
   share one `BETTER_AUTH_SECRET`. Follow the guide's server section. The login and security
   screens need no change: they read `GET {basePath}/terreno/methods`.
3. **Give the user the exact URLs.** For each provider, the callback is
   `https://<callback owner>/api/auth/callback/<provider>`; local dev uses
   `http://localhost:4000` for Google and GitHub (Apple is https only). Print the full URL per
   provider, plus Apple's Domains (backend and web hosts) and GitHub's Homepage URL. Never leave
   `<placeholders>` in what the user copies.
4. **Hand over provider registration** as numbered steps from the guide's "Register each
   provider": the Google consent screen (test users while in Testing), the GitHub OAuth app, and
   the Apple Services ID plus key.
5. **Hand over the secrets.** Check `gcloud config get-value project` first; if it is not the
   project that holds the backend secrets, give `gcloud config set project <gcp-project-id>`.
   Then give the steps from the guide's "Store the secrets", with this app's secret names and
   its own secret store. No value passes through the chat. Secrets mount at deploy, so a
   redeploy follows. The example's Secret Manager commands stay in the guide.
6. **Preview first, when stable does not run this code yet.** Point the callback owner at one
   preview, register that preview's backend URL with each provider, add the secrets, and deploy
   that preview only. Say plainly that the named preview then holds the real secrets and stable
   has no social sign-in until the callback owner moves back. The example does this with
   `OAUTH_CALLBACK_TAG`; other apps use their own switch.
7. **Check.** `curl -s https://<backend>/api/auth/terreno/methods | jq .` lists each provider.
   Then sign in with each one on the web app. On `redirect_uri_mismatch`, compare the URI in the
   error with the registered one character for character.

## In code you change

- Add a preview-callback switch only when the user wants preview-first, and cover it with that
  app's deploy-env tests. The example's switch is `OAUTH_CALLBACK_TAG`, described in the guide.
- Update the app's social-login docs in the same change.
- Prove the flow without real providers with the app's mock OIDC provider when it has one.
  Real-provider sign-in is the user's check.

## Done when

- `/terreno/methods` on the target backend lists every provider the user asked for.
- The user has signed in once with each provider, or you have reported which one is blocked and
  why (for example, Apple refusing a `run.app` host).
- The guide matches what you set up, including any new host or variable.
