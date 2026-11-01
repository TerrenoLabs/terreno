/**
 * Type-level tests: the clients createBetterAuthClient returns satisfy LoginControllerClient, so
 * apps pass their client to useLoginController and TerrenoLoginScreen without a cast.
 * `bun run compile` checks this file through tsconfig.typetests.json.
 */
import {describe, expect, it} from "bun:test";

import type {BetterAuthClient, BetterAuthClientWithFeatures} from "../betterAuthClient";
import type {LoginControllerClient, LoginControllerClientInput} from "./useLoginController";

// Each helper is only type-checked; none of them runs.
const typeChecks = {
  allFeatures: (
    client: BetterAuthClientWithFeatures<{multiSession: true; passkey: true; twoFactor: true}>
  ): LoginControllerClient => client,
  // A client without features is typed loosely, so the option's input type lists it on its own.
  noFeatures: (client: BetterAuthClient): LoginControllerClientInput => client,
  someFeatures: (client: BetterAuthClientWithFeatures<{twoFactor: true}>): LoginControllerClient =>
    client,
};

describe("LoginControllerClient types", () => {
  it("accepts every client createBetterAuthClient returns", () => {
    expect(Object.keys(typeChecks)).toEqual(["allFeatures", "noFeatures", "someFeatures"]);
  });
});
