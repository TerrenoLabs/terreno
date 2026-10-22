import type {APIRequestContext, Page} from "@playwright/test";
import {MongoClient} from "mongodb";
import {ADMIN_USER} from "../fixtures/testUsers";
import {signUpOrSignInBetterAuth} from "./betterAuthSession";
import {loginAs} from "./login";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1/terreno-e2e";

export const setUserAdmin = async (email: string): Promise<void> => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    // The admin shell and RBAC screens gate on the superadmin role, not the legacy
    // admin flag, so promotion has to grant both.
    await client
      .db()
      .collection("users")
      .updateOne({email}, {$addToSet: {roles: "superadmin"}, $set: {admin: true}});
  } finally {
    await client.close();
  }
};

export const getAdminToken = async (request: APIRequestContext): Promise<string> => {
  return signUpOrSignInBetterAuth(request, {
    email: ADMIN_USER.email,
    name: ADMIN_USER.name,
    password: ADMIN_USER.password,
  });
};

export const loginAsAdmin = async (page: Page): Promise<void> => {
  // Promote before the browser session's first /auth/me so the request client does not
  // cache a forbidden admin layout from a pre-superadmin grant set.
  await setUserAdmin(ADMIN_USER.email);
  await loginAs(page, ADMIN_USER);
};
