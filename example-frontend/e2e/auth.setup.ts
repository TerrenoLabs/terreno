import {type APIRequestContext, test as setup} from "@playwright/test";
import {ADMIN_USER, ALL_E2E_USERS, SYNCDB_LOADLAB_USER} from "./fixtures/testUsers";
import {setBetterAuthEmailVerified, setUserAdmin} from "./helpers/adminAuth";
import {signUpOrSignInBetterAuth} from "./helpers/betterAuthSession";
import {acceptPendingConsentForms} from "./helpers/consentForms";
import {loginAs} from "./helpers/login";

setup("create test users", async ({request}) => {
  for (const user of ALL_E2E_USERS) {
    await createUser(request, user);
    await setBetterAuthEmailVerified(user.email);
    if (user.email === ADMIN_USER.email) {
      await setUserAdmin(ADMIN_USER.email);
    }
    if (user.email === SYNCDB_LOADLAB_USER.email) {
      await setUserAdmin(SYNCDB_LOADLAB_USER.email);
    }
    await acceptPendingConsentForms(request, await signUpOrSignInBetterAuth(request, user));
  }
});

// Metro compiles the web bundle and the /ai route on first request. Paying that once here keeps
// a cold start out of the first spec's 60s budget.
setup("warm the web bundle", async ({page}) => {
  setup.setTimeout(300_000);
  await loginAs(page);
  await page.goto("/ai", {timeout: 240_000});
  await page.getByTestId("gpt-input").waitFor({state: "visible", timeout: 240_000});
});

const createUser = async (
  request: APIRequestContext,
  user: {email: string; name: string; password: string}
): Promise<void> => {
  try {
    await signUpOrSignInBetterAuth(request, user);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already")) {
      return;
    }
    throw error;
  }
};
