import {describe, it} from "bun:test";
import {TerrenoOAuthConsentScreen} from "@terreno/syncdb/auth";
import {assert} from "chai";
import type React from "react";

import {
  betterAuthClient,
  MOCK_OIDC_PROVIDER_ID,
  OAUTH_PROVIDER_LABELS,
  rememberedAccounts,
} from "@/lib/betterAuth";

import OAuthConsent from "./consent";

type ConsentElement = React.ReactElement<React.ComponentProps<typeof TerrenoOAuthConsentScreen>>;

describe("OAuthConsent route", () => {
  it("renders the prebuilt consent screen with the app's login client and branding", () => {
    const element = OAuthConsent() as ConsentElement;
    assert.strictEqual(element.type, TerrenoOAuthConsentScreen);
    assert.strictEqual(element.props.testID, "oauth-consent");
    const loginProps = element.props.loginProps;
    assert.strictEqual(loginProps.client, betterAuthClient);
    assert.strictEqual(loginProps.providerLabels, OAUTH_PROVIDER_LABELS);
    assert.strictEqual(loginProps.rememberedAccounts, rememberedAccounts);
    assert.strictEqual(loginProps.testID, "login-screen");
    assert.isTrue(loginProps.rememberIdentity);
    assert.strictEqual(loginProps.trustDeviceDays, 30);
  });

  it("offers email, passkey, and every social provider the app knows, including the e2e mock", () => {
    const element = OAuthConsent() as ConsentElement;
    assert.deepEqual(element.props.loginProps.methods, {
      emailPassword: true,
      passkey: true,
      providers: ["google", "apple", "github", MOCK_OIDC_PROVIDER_ID],
    });
  });

  it("leaves callbackURL to the screen's default so social sign-in returns with ?request=", () => {
    const element = OAuthConsent() as ConsentElement;
    assert.isUndefined(element.props.loginProps.callbackURL);
  });
});
