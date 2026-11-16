import {type LoginMethodsFilter, TerrenoOAuthConsentScreen} from "@terreno/syncdb/auth";
import type React from "react";
import {
  betterAuthClient,
  MOCK_OIDC_PROVIDER_ID,
  OAUTH_PROVIDER_LABELS,
  rememberedAccounts,
} from "@/lib/betterAuth";

/** Matches Better Auth's default `trustDeviceMaxAge`, which example-backend leaves as is. */
const TRUST_DEVICE_DAYS = 30;

/**
 * Which sign-in methods the consent screen offers. This only narrows what the server enables
 * (`googleOAuth`, `appleOAuth`, `githubOAuth`, and the e2e mock OIDC provider); a provider the
 * server has off never shows.
 */
const CONSENT_SIGN_IN_METHODS: LoginMethodsFilter = {
  emailPassword: true,
  passkey: true,
  providers: ["google", "apple", "github", MOCK_OIDC_PROVIDER_ID],
};

/**
 * The MCP OAuth consent route the example backend's `MCP_OAUTH_CONSENT_URL` points at. Signed out,
 * it shows the same login screen as app/login.tsx, limited to `CONSENT_SIGN_IN_METHODS`; signing in swaps in the consent card for `?request=` without navigating.
 * `callbackURL` is left to the screen's default (the current URL) so a social sign-in returns
 * here with the request intact. app/_layout.tsx lets signed-out visitors reach this route, and
 * the legal ConsentNavigator still gates it once signed in.
 */
const OAuthConsent: React.FC = () => {
  return (
    <TerrenoOAuthConsentScreen
      loginProps={{
        client: betterAuthClient,
        methods: CONSENT_SIGN_IN_METHODS,
        providerLabels: OAUTH_PROVIDER_LABELS,
        rememberedAccounts,
        rememberIdentity: true,
        testID: "login-screen",
        trustDeviceDays: TRUST_DEVICE_DAYS,
      }}
      testID="oauth-consent"
    />
  );
};

export default OAuthConsent;
