/**
 * The example backend turns on every auth feature, and the login screen learns which from the
 * public `GET /api/auth/terreno/methods`.
 *
 * playwright.config.ts runs this spec in the cross-site bearer project, where the backend
 * registers the mock OIDC provider (`MOCK_OIDC_ISSUER`) as the `mock-oidc` generic OAuth
 * provider. The request carries no cookie and no session: the endpoint is public.
 */
import {expect, test} from "./fixtures/test";
import {CROSS_SITE_API_URL} from "./helpers/crossSiteApi";

const METHODS_PATH = "/api/auth/terreno/methods";

interface AuthMethodsBody {
  accountLinking: {mode: string};
  emailPassword: boolean;
  multiSession: boolean;
  passkey: boolean;
  providers: string[];
  signUp: boolean;
  twoFactor: boolean;
}

test.describe("Auth methods discovery", () => {
  test("anyone can see the mock provider and every auth feature switched on", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    try {
      const response = await api.get(`${CROSS_SITE_API_URL}${METHODS_PATH}`);
      expect(response.ok(), `methods answered ${response.status()}`).toBe(true);
      const methods = (await response.json()) as AuthMethodsBody;
      expect(methods.providers).toContain("mock-oidc");
      expect(methods).toMatchObject({
        accountLinking: {mode: "verified-email"},
        emailPassword: true,
        multiSession: true,
        passkey: true,
        signUp: true,
        twoFactor: true,
      });
    } finally {
      await api.dispose();
    }
  });
});
