# Set up social login

Register Google, GitHub, and Sign in with Apple once, on the stable deploy, and let every preview
sign in through it. This page uses the example app's deploy (`scripts/ci/gcp-deploy.sh`) as the
worked case; a consumer app follows the same steps with its own hosts.

Config fields used here (`googleOAuth`, `githubOAuth`, `appleOAuth`, `oauthProxy`, `passkey`) are
listed in [Configure Better Auth](configure-better-auth.md#auth-features).

## One callback per provider

Each provider gets exactly one redirect URI, on the stable backend:

```text
https://<stable backend>/api/auth/callback/<provider>
```

- Before the move to one domain, `<stable backend>` is the Cloud Run URL
  (`terreno-backend-example-7knxlrnpqq-uc.a.run.app` for the example).
- After the move ([below](#move-stable-onto-one-domain)), it is `api.<domain>`. Register both
  during the move and drop the Cloud Run one afterwards.
- Previews never get their own callback. They borrow stable's through oauth-proxy, unless one
  preview owns them for a while ([below](#register-on-a-preview-first)).

## Register on a preview first

Stable only exchanges codes once it runs a release with this setup. To try the providers before
then, let one preview own the callbacks:

1. Set `OAUTH_CALLBACK_TAG=pr-<n>` in the `terreno-gcp` CircleCI context.
2. Register every provider below with `<stable backend>` replaced by that preview's backend,
   `pr-<n>---terreno-backend-example-7knxlrnpqq-uc.a.run.app`.
3. Add the secrets, then rerun that PR's `gcp-cd-preview` job.

That preview mounts every OAuth secret, including client secrets and the Apple key, and
exchanges codes itself. Other previews proxy through it, and stable gets only the client IDs, so
stable has no social sign-in while the variable is set. Only name a preview whose code you have
reviewed: it holds the real secrets. When stable runs the release, register the stable callbacks,
remove the variable, and redeploy stable.

## Register each provider

### GitHub

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Homepage URL: the stable web app. Authorization callback URL:
   `https://<stable backend>/api/auth/callback/github`.
3. Generate a client secret, then add both values:

```bash
printf '%s' "<client id>" | gcloud secrets versions add terreno-backend-example-github-client-id --data-file=-
printf '%s' "<client secret>" | gcloud secrets versions add terreno-backend-example-github-client-secret --data-file=-
```

### Google

1. Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.
2. Authorized redirect URI: `https://<stable backend>/api/auth/callback/google`.
3. Add the values to `terreno-backend-example-google-client-id` and
   `terreno-backend-example-google-client-secret` the same way.

### Sign in with Apple

1. Apple Developer → Certificates, Identifiers & Profiles → Identifiers → add a **Services ID**
   (this is the `clientId`, such as `com.example.web`). Turn on Sign in with Apple and configure
   it:
   - Domains: the stable backend and web hosts (`api.<domain>` and `app.<domain>` after the move).
   - Return URL: `https://<stable backend>/api/auth/callback/apple`.
2. Keys → add a key with Sign in with Apple, download the `.p8` file (once only), and note the
   key ID. Your team ID is in the top right of the developer portal.
3. Add the four values:

```bash
printf '%s' "com.example.web" | gcloud secrets versions add terreno-backend-example-apple-client-id --data-file=-
printf '%s' "<team id>" | gcloud secrets versions add terreno-backend-example-apple-team-id --data-file=-
printf '%s' "<key id>" | gcloud secrets versions add terreno-backend-example-apple-key-id --data-file=-
gcloud secrets versions add terreno-backend-example-apple-private-key --data-file=AuthKey_<key id>.p8
```

The example reads them as `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and
`APPLE_PRIVATE_KEY`, and adds `https://appleid.apple.com` to `trustedOrigins`. Apple posts its
return from that origin, and a browser that holds a `SameSite=None` cookie for the API sends
it, which makes Better Auth check the POST's `Origin`.

Terraform (`infra/flourish/main.tf`, `backend_secret_oauth`) creates the eight empty secret
containers. The deploy mounts only the ones that have a version, so a provider turns on when both
of its values exist (all four for Apple). Redeploy after adding a version.

Previews get only the `*_CLIENT_ID` secrets: starting a sign-in needs the client ID, and stable
exchanges every code. No client secret or `.p8` reaches a `pr-*` revision. Better Auth refuses
to configure Google or GitHub without some secret, so on a preview (`OAUTH_PROXY_PRODUCTION_URL`
on another origin than `BETTER_AUTH_URL`) the example fills in the placeholder
`OAUTH_PROXY_PREVIEW_CLIENT_SECRET` (`"unused-on-oauth-proxy-preview"`). It is never sent to a
provider.

## Rotate Apple's key and client secret

Apple's client secret is a JWT signed with your key, valid for at most six months.

- **Key form (the example's).** Terreno signs a fresh 180-day secret every time the server
  starts, so the JWT rotates on every deploy and instance start. Nothing expires as long as some
  deploy or restart happens within 180 days.
- **Rotating the key itself.** Create a second key in the developer portal, add its `.p8` and
  key ID as new versions of `apple-private-key` and `apple-key-id`, and redeploy. Revoke the old
  key once the new revision serves traffic. Users stay signed in: sessions do not depend on the
  key.
- **Client-secret form** (`APPLE_CLIENT_SECRET`, a JWT you signed yourself). Re-sign it before
  it expires, add it as a new version, and redeploy. The example uses this form only when the
  key form is incomplete.

## How previews sign in

Every preview reaches the providers through the stable deploy's registered callback, using
Better Auth's oauth-proxy plugin:

1. The preview starts the sign-in. oauth-proxy points the provider's `redirect_uri` at stable,
   and packs the preview's OAuth state into the `state` parameter, encrypted with
   `BETTER_AUTH_SECRET`.
2. The provider returns to stable's `/api/auth/callback/<provider>`. Stable decrypts the state,
   exchanges the code, and redirects to the preview's `/api/auth/callback/<provider>/oauth-proxy`
   with the user's profile, encrypted, in the URL. Stable writes nothing to its database.
3. The preview checks the state against the row it stored in its own database, creates the user
   and session there, and redirects to the web app. A bearer-mode web app gets `#ott=<token>`
   on that redirect, as on any other social sign-in
   ([OAuth handoff](configure-better-auth.md#social-sign-in-in-bearer-mode)).

What this needs:

- **One shared secret.** Previews and stable use the same `BETTER_AUTH_SECRET`; previews keep
  their own databases. A profile encrypted under a different secret is refused.
- **The plugin on both.** Previews set `oauthProxy.productionURL` to stable. Stable sets it to
  its own URL, because its callback hook is what forwards a preview's return. Terreno then sets
  oauth-proxy's `currentURL` on stable, so stable's own sign-ins skip the proxy and keep Better
  Auth's state-cookie check, whichever host name (such as a Cloud Run tag URL) the client used.
  In the example, `scripts/ci/backend-auth-env.sh` sets `OAUTH_PROXY_PRODUCTION_URL` on both.
- **Production's sign-up mode governs.** Stable decides whether the provider's user may be
  created, so give previews the same `signUp.mode`.
- **No browser binding on the preview hop.** The preview's completion endpoint skips the state
  cookie check (the cookie lives on the preview's host, and the browser arrives from stable). The
  encrypted profile in the forwarded URL is the only proof: whoever holds that URL can finish the
  sign-in, as the user, within 60 seconds, once (the preview consumes its state row). Treat it
  like a password-reset link: previews are for testing, so sign in there with test accounts.

**Apple's `form_post`.** Apple returns with a cross-site `POST` to the callback rather than a
redirect. Stable's oauth-proxy reads `code` and `state` from the form body and forwards the
browser to the preview with a normal redirect, so no `SameSite=Lax` cookie is needed on stable.
The api test `betterAuthOAuthProxy.test.ts` proves this with the mock provider; the live check
against Apple is T28 in the auth-experience plan.

## Native

The Expo app signs in with the same providers through the system browser, using Better Auth's
Expo plugin. The provider still returns to the backend's own
`/api/auth/callback/<provider>`, so a native app needs no extra redirect URI at the provider.

1. **Turn on `nativeApps: true`** in the server config. Terreno adds `expo()` from
   `@better-auth/expo`, which serves `GET {basePath}/expo-authorization-proxy`. The app opens
   that URL in the browser; it sets the OAuth state cookie there and redirects to the provider.
2. **Give the app a scheme.** Set `expo.scheme` in `app.json` (`frontend` in the example) and
   pass the same value to `createBetterAuthClient({scheme})` from `@terreno/rtk`.
3. **List the scheme in `trustedOrigins`**, as `frontend://`. After the callback, the backend
   redirects the browser to the app's `callbackURL` (`frontend://.../login`), with the session in
   a `cookie` query parameter. Better Auth refuses a callback URL that matches no trusted origin.
   An entry with only the scheme matches every URL on that scheme, so `frontend://` also covers a
   development build's `frontend://localhost:8081/login`. The example lists `frontend://`,
   `terreno://` and `exp://`.
4. **Pass a path as `callbackURL`** (`/login`). The Expo client turns it into the deep link, opens
   the browser, waits for that link, and stores the session from it in `expo-secure-store`.

`expo-web-browser` must be in the native build. The example gets it through `@terreno/ui`;
check with `bunx expo-modules-autolinking resolve -p android`.

Two limits:

- **No oauth-proxy.** The Expo client sends `x-skip-oauth-proxy`, so a native sign-in uses the
  backend it talks to as the provider's callback. Point native builds at the stable deploy, whose
  callback is the registered one, not at a preview.
- **https providers only.** The authorization proxy refuses an `http:` authorization URL. Real
  providers are all https. The example's mock OIDC provider is plain http, so example-backend
  serves the proxy for that one origin itself (`mock-oidc-native-proxy` in
  `src/utils/betterAuthConfig.ts`). It exists only while `MOCK_OIDC_ISSUER` is set, which
  production refuses.

### Prove it on an Android emulator

`example-frontend/maestro/native-social-login.yaml` signs in with the mock provider and lands on
the todos screen. `localhost` has to mean the same machine to the backend and to the device's
browser, so every server is reached through `adb reverse`:

```bash
# Mongo as a replica set, then the mock provider and the backend
MOCK_OIDC_SERVE=true MOCK_OIDC_PORT=4655 MOCK_OIDC_ISSUER=http://localhost:4655 \
  MOCK_OIDC_REDIRECT_URI=http://localhost:4000/api/auth/callback/mock-oidc \
  bun example-frontend/e2e/helpers/mockOidcProvider.ts
AUTH_PROVIDER=better-auth BETTER_AUTH_URL=http://localhost:4000 \
  MOCK_OIDC_ISSUER=http://localhost:4655 MONGO_URI=... PORT=4000 bun run backend:dev

# The development build and Metro
cd example-frontend && bunx expo run:android   # or install an EAS development build
EXPO_PUBLIC_API_URL=http://localhost:4000 bunx expo start --dev-client --port 8081

adb -s 127.0.0.1:5555 reverse tcp:8081 tcp:8081
adb -s 127.0.0.1:5555 reverse tcp:4000 tcp:4000
adb -s 127.0.0.1:5555 reverse tcp:4655 tcp:4655
maestro --device 127.0.0.1:5555 test example-frontend/maestro/native-social-login.yaml
```

To run beside a Playwright run that holds ports 4000 and 4555, start the backend on another host
port and reverse to it (`adb reverse tcp:4000 tcp:4100`); the app and `BETTER_AUTH_URL` keep
`localhost:4000`. `MOCK_OIDC_PORT`, `MOCK_OIDC_ISSUER` and `MOCK_OIDC_REDIRECT_URI` move the mock
provider; unset, it keeps the Playwright defaults (`127.0.0.1:4555`, callback on
`127.0.0.1:4000`).

## Passkeys on previews and stable

A passkey is bound to an rpID, a domain the browser checks against the page's host.

- **Previews** use their own host (`pr-<n>--terreno-frontend.netlify.app`). `netlify.app` is a
  public suffix, so it can't be the rpID, and a passkey made on one preview works only on that
  preview.
- **Stable before the move** uses `terreno-frontend.netlify.app`, for the same reason.
- **Stable after the move** uses the parent domain: `backend-auth-env.sh` sets
  `PASSKEY_RP_ID=<domain>` when `STABLE_FRONTEND_URL` is `app.<domain>` and `STABLE_BACKEND_URL`
  is on `<domain>` too. It never derives a public suffix (`netlify.app`, `run.app`) or a country
  second level (`co.uk`, `com.au`); set `STABLE_PASSKEY_RP_ID` to choose the rpID yourself. A
  passkey made on `app.<domain>` then works on the pages that list it as an origin: the
  `FRONTEND_URL` origin and each `CORS_ORIGINS` origin on `<domain>`, not on every subdomain.

Session cookies stay host-only on `api.<domain>`. Same-site subdomains send them on fetches
without Better Auth's `crossSubDomainCookies`, which would expose the session to every other
subdomain.

## Move stable onto one domain

Moving the stable web app to `app.<domain>` and the backend to `api.<domain>` makes them
same-site, so Safari's third-party cookie blocking no longer applies on stable. Previews stay on
`netlify.app` and `run.app`, and keep using bearer mode.

1. **Netlify custom domain.** In the `terreno-frontend` site, add `app.<domain>` under Domain
   management and point a `CNAME` at the Netlify site. Wait for the certificate.
2. **Cloud Run domain mapping.** Map `api.<domain>` to `terreno-backend-example`:

   ```bash
   gcloud beta run domain-mappings create --service=terreno-backend-example \
     --domain=api.<domain> --region=us-central1
   ```

   Add the DNS records it prints, and wait until `gcloud beta run domain-mappings describe`
   reports the certificate ready.
3. **Re-register the callbacks.** Add `https://api.<domain>/api/auth/callback/<provider>` to
   GitHub, Google, and Apple (and both new hosts under Apple's Domains). Keep the Cloud Run
   callback until the next step has deployed.
4. **Set two CI variables** in the CircleCI project: `STABLE_BACKEND_URL=https://api.<domain>`
   and `STABLE_FRONTEND_URL=https://app.<domain>`, then redeploy stable and the web app. The
   deploy sets `BETTER_AUTH_URL`, `FRONTEND_URL`, `OAUTH_PROXY_PRODUCTION_URL`, and
   `PASSKEY_RP_ID` from them, previews proxy to `api.<domain>`, and the web build calls
   `api.<domain>` (by default it calls the untagged Cloud Run URL, the same one the deploy names). The old Netlify host stays in `CORS_ORIGINS` (and so in `trustedOrigins`)
   during the move.
5. **Drop the old callbacks** from each provider once sign-in works on the new hosts.

**Passkeys made before the move stop working.** They are bound to
`terreno-frontend.netlify.app`, and the new rpID is `<domain>`, which the browser refuses to
match. Users sign in another way (password or a provider) and add a new passkey from the security
screen. The example has no real users; a consumer app should tell its users before moving.
