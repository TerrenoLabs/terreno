# Set up social login

Turn on Google, GitHub, and Sign in with Apple for a Terreno app, on local dev, on per-PR
previews, and on the stable deploy. Register each provider once, on the stable backend, and let
every preview sign in through it. The example app's deploy (`scripts/ci/gcp-deploy.sh`) is the
worked case; a consumer app follows the same steps with its own hosts and secret names.

Config fields used here (`googleOAuth`, `githubOAuth`, `appleOAuth`, `oauthProxy`, `passkey`) are
listed in [Configure Better Auth](configure-better-auth.md#auth-features). Agents can follow the
`set-up-social-login` skill, which walks the same steps.

## Before you start

1. **Point gcloud at the project** that holds the backend's secrets, once per machine:

   ```bash
   gcloud config set project flourish-terreno   # the example's project; use your own
   gcloud config get-value project              # check
   ```

   Every `gcloud` command below then uses it. Pass `--project=<id>` to override it for one
   command.
2. **Share one `BETTER_AUTH_SECRET`** between stable and previews. oauth-proxy encrypts the
   forwarded profile with it, and a preview refuses a profile encrypted under another secret.
3. **Choose the hosts** ([below](#choose-the-hosts)). The provider callbacks go on the stable
   backend's final host, so decide it before registering.

## Choose the hosts

Put the stable web app and backend on subdomains of one domain you own, such as
`app.<domain>` and `api.<domain>`.

- **They are same-site.** A browser treats hosts as one site when they share a registrable
  domain (the part just below a public suffix such as `.com` or `.app`). Safari blocks only
  cross-site cookies, so the host-only session cookie on `api.<domain>` is sent on the web app's
  requests, and the web app can use cookie mode.
- **Keep the cookie host-only.** Leave Better Auth's `crossSubDomainCookies` off; it would send
  the session cookie to every subdomain.
- **Passkeys.** Set `PASSKEY_RP_ID=<domain>` so a passkey works on `app.<domain>` and any other
  web origin you list on `<domain>`.
- **Safari's 7-day cap.** Safari caps a cookie at 7 days when the server that sets it answers
  from an IP address unlike the web app's, as when a CDN serves `app.` and Cloud Run serves
  `api.`. A user who stays away longer than 7 days signs in again. Serving both hosts from one
  load balancer removes the cap.

**Previews:** leave them on their hosting domains (`pr-<n>--<site>.netlify.app` and the Cloud
Run tag URL `pr-<n>---<service>.run.app`). They are cross-site to their backend, so their web
build runs in [bearer mode](configure-better-auth.md#frontend-and-api-on-different-sites), which
needs no third-party cookies and works in Safari. Do not put previews under the stable domain:
a preview runs unreviewed PR code, and on the same site it could send requests that carry a
visitor's stable session cookie and request passkey assertions for the stable rpID. Same-site
previews need a separate domain of their own.

## Turn the providers on in the server

A provider turns on when its config field is set. The login and security screens read
`GET {basePath}/terreno/methods` and show a provider's button only once the server lists it.

```typescript
const config: BetterAuthConfig = {
  enabled: true,
  baseURL: process.env.BETTER_AUTH_URL, // this backend's public origin
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [...webOrigins, "https://appleid.apple.com", "myapp://"],
  googleOAuth: {clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!},
  githubOAuth: {clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET!},
  appleOAuth: {
    clientId: process.env.APPLE_CLIENT_ID!, // the Services ID
    keyId: process.env.APPLE_KEY_ID!,
    privateKey: process.env.APPLE_PRIVATE_KEY!, // the .p8 contents
    teamId: process.env.APPLE_TEAM_ID!,
  },
  accountLinking: {mode: "verified-email"},
  oauthProxy: process.env.OAUTH_PROXY_PRODUCTION_URL
    ? {productionURL: process.env.OAUTH_PROXY_PRODUCTION_URL}
    : undefined,
  nativeApps: true,
};
```

- Add a provider's field only when its env vars are set; example-backend's
  `src/utils/betterAuthConfig.ts` shows the pattern, including the preview placeholder secret.
- `https://appleid.apple.com` must be in `trustedOrigins` for Apple
  ([why](#sign-in-with-apple)).
- `accountLinking.mode` decides whether a Google sign-in with the same verified email joins an
  existing account. See [Account linking](../explanation/account-linking.md).
- `signUp: {mode: "closed"}` stops social sign-in from creating users; stable decides this for
  previews too.

## Callback URLs

Each provider gets one redirect URI per backend that exchanges codes:

```text
https://<backend that owns the callbacks>/api/auth/callback/<provider>
```

| Stage | Backend that owns the callbacks | Example |
| --- | --- | --- |
| Local dev (Google and GitHub only) | `http://localhost:4000` | `http://localhost:4000/api/auth/callback/github` |
| Preview first ([below](#register-on-a-preview-first)) | The preview's Cloud Run tag URL | `https://pr-1613---terreno-backend-example-7knxlrnpqq-uc.a.run.app/api/auth/callback/google` |
| Stable before the domain move | The Cloud Run URL | `https://terreno-backend-example-7knxlrnpqq-uc.a.run.app/api/auth/callback/google` |
| Stable after the move | `api.<domain>` | `https://api.<domain>/api/auth/callback/google` |

- During the move, register both stable URLs, and drop the Cloud Run one afterwards
  ([below](#move-stable-onto-one-domain)).
- Previews never get their own callback. They borrow stable's through oauth-proxy, unless one
  preview owns them for a while.
- Apple accepts only https return URLs on a real host, so it has no local dev callback. Test
  Apple on a preview or on stable.
- Keep local dev on its own OAuth apps (a "dev" GitHub app and Google client), so a dev secret
  never sits next to the stable ones.

## Register on a preview first

Stable exchanges codes only once it runs a release with this setup. To try the providers before
then, let one preview own the callbacks:

1. **Name the preview.** In CircleCI, Organization Settings → Contexts → `terreno-gcp`, add
   `OAUTH_CALLBACK_TAG` = `pr-<n>`.
2. **Register every provider** ([below](#register-each-provider)) with the preview's backend,
   `https://pr-<n>---terreno-backend-example-7knxlrnpqq-uc.a.run.app`, as the callback host.
   For Apple, list both preview hosts under Domains:
   `pr-<n>---terreno-backend-example-7knxlrnpqq-uc.a.run.app` and
   `pr-<n>--terreno-frontend.netlify.app`.
3. **Add the secrets** ([below](#store-the-secrets)).
4. **Redeploy the preview.** Approve the PR's `approve` hold in CircleCI (or rerun its
   `gcp-cd-preview` job), so the new revision mounts the secrets.
5. **Sign in** at `https://pr-<n>--terreno-frontend.netlify.app`.

While the variable is set:

- That preview mounts every OAuth secret, including client secrets and the Apple key, and
  exchanges codes itself. Only name a preview whose code you have reviewed.
- Other previews proxy through it.
- Stable gets only the client IDs, so stable has no social sign-in.

When stable runs the release, register the stable callbacks, delete `OAUTH_CALLBACK_TAG`,
redeploy stable, and remove the preview callbacks from each provider.

## Register each provider

### GitHub

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. For an organization app,
   use the organization's Settings → Developer settings instead.
2. Homepage URL: the web app. Authorization callback URL:
   `https://<callback host>/api/auth/callback/github`.
3. Generate a client secret. GitHub shows it once.

A GitHub OAuth app has one callback URL. To move it (preview to stable, or to `api.<domain>`),
edit it, or create a second app for the overlap.

### Google

1. Google Cloud console → APIs & Services → OAuth consent screen. Set the app name, support
   email, and authorized domains. While the screen is in **Testing**, only the test users you
   list can sign in; add yours.
2. Credentials → Create credentials → OAuth client ID → Web application.
3. Authorized redirect URI: `https://<callback host>/api/auth/callback/google`. A client can list
   several, so the preview, Cloud Run, and `api.<domain>` URIs can sit side by side.
4. Copy the client ID and secret.

### Sign in with Apple

1. Apple Developer → Certificates, Identifiers & Profiles → Identifiers → add a **Services ID**
   (this is the `clientId`, such as `com.example.web`). Turn on Sign in with Apple and configure
   it:
   - Domains: the backend and web hosts (`api.<domain>` and `app.<domain>` after the move).
   - Return URL: `https://<callback host>/api/auth/callback/apple`.
2. Keys → add a key with Sign in with Apple, download the `.p8` file (once only), and note the
   key ID. Your team ID is in the top right of the developer portal.

Apple needs `https://appleid.apple.com` in `trustedOrigins`. It returns with a cross-site
`POST` (`form_post`) from that origin, and a browser that holds a `SameSite=None` cookie for the
API sends it, which makes Better Auth check the POST's `Origin`.

If Apple refuses a preview's `run.app` host, try Google and GitHub on the preview and register
Apple on stable.

## Store the secrets

The example keeps each value in Secret Manager, in containers Terraform creates
(`infra/flourish/main.tf`, `backend_secret_oauth`). The source values live in OpenBao under
`terreno`; `secret terreno <KEY>` (from the ops dotfiles) prints one. With the default project
set, copy each into its Secret Manager container:

```bash
S=terreno-backend-example
while read -r key name; do
  value="$(secret terreno "$key")" || { echo "skip $key: not in OpenBao"; continue; }
  [ -n "$value" ] || { echo "skip $key: empty"; continue; }
  printf '%s' "$value" | gcloud secrets versions add "$S-$name" --data-file=- >/dev/null \
    && echo "added $S-$name"
done <<'EOF'
GITHUB_OAUTH_CLIENT_ID      github-client-id
GITHUB_OAUTH_CLIENT_SECRET  github-client-secret
GOOGLE_OAUTH_CLIENT_ID      google-client-id
GOOGLE_OAUTH_CLIENT_SECRET  google-client-secret
APPLE_OAUTH_CLIENT_ID       apple-client-id
APPLE_OAUTH_TEAM_ID         apple-team-id
APPLE_OAUTH_KEY_ID          apple-key-id
APPLE_OAUTH_SECERT          apple-private-key
EOF
```

- `APPLE_OAUTH_SECERT` (spelled as stored) holds the `.p8` key's contents, `-----BEGIN PRIVATE
  KEY-----` included. `APPLE_OAUTH_CLIENT_ID` is the Services ID, such as `com.example.web`.
- The loop never prints a value, and skips a key that is missing or empty instead of storing an
  empty version, which would mount a blank secret.
- `printf '%s'` keeps a trailing newline out of the value. Check one with
  `gcloud secrets versions access latest --secret=$S-github-client-id`.
- Without OpenBao, replace `secret terreno "$key"` with your own store's read command, or pipe
  each value in by hand (`--data-file=AuthKey_<key id>.p8` for the Apple key).

The deploy mounts only the secrets that have a version, so a provider turns on when both of its
values exist (all four for Apple). **Redeploy after adding a version.** The example reads them as
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`.

Previews get only the `*_CLIENT_ID` secrets: starting a sign-in needs the client ID, and the
callback owner exchanges every code. No client secret or `.p8` reaches a `pr-*` revision other
than the one `OAUTH_CALLBACK_TAG` names. Better Auth refuses to configure Google or GitHub
without some secret, so on a preview (`OAUTH_PROXY_PRODUCTION_URL` on another origin than
`BETTER_AUTH_URL`) the example fills in the placeholder `OAUTH_PROXY_PREVIEW_CLIENT_SECRET`
(`"unused-on-oauth-proxy-preview"`). It is never sent to a provider.

For local dev, put the dev app's values in `example-backend/.env` under the same names.

## Check it

1. **The server lists the providers:**

   ```bash
   curl -s https://<backend>/api/auth/terreno/methods | jq .
   ```

   Each configured provider appears. A missing one means its secrets have no version, or the
   revision predates them: redeploy.
2. **Sign in** on the web app with each provider. The button sits on the login screen; the
   Security screen's Linked accounts card links more providers to the same account.
3. **On a redirect mismatch,** compare the `redirect_uri` in the provider's error with the URI
   you registered, character for character (scheme, host, no trailing slash).

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
