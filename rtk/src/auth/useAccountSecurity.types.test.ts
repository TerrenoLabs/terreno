/**
 * Type-level tests: the clients createBetterAuthClient returns satisfy AccountSecurityClient, so
 * apps pass their client to useAccountSecurity and TerrenoAccountSecurityScreen without a cast.
 * `bun run compile` checks this file through tsconfig.typetests.json.
 */
import {describe, expect, it} from "bun:test";

import type {BetterAuthClientWithFeatures} from "../betterAuthClient";
import type {AccountSecurityClient} from "./useAccountSecurity";

// Each helper is only type-checked; none of them runs.
const typeChecks = {
  allFeatures: (
    client: BetterAuthClientWithFeatures<{multiSession: true; passkey: true; twoFactor: true}>
  ): AccountSecurityClient => client,
  // A client that cannot list sessions is not a security client.
  missingSessions: (client: Omit<AccountSecurityClient, "listSessions">): AccountSecurityClient =>
    // @ts-expect-error listSessions is required
    client,
  someFeatures: (client: BetterAuthClientWithFeatures<{twoFactor: true}>): AccountSecurityClient =>
    client,
};

describe("AccountSecurityClient types", () => {
  it("accepts typed clients createBetterAuthClient returns and rejects incomplete ones", () => {
    expect(Object.keys(typeChecks)).toEqual(["allFeatures", "missingSessions", "someFeatures"]);
  });
});
