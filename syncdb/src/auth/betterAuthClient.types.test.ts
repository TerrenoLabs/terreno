/**
 * Type-level tests for createBetterAuthClient's `features` option. `bun run compile` checks this
 * file through tsconfig.typetests.json; every `@ts-expect-error` line fails the compile if the
 * error it expects goes away. Only types are imported, so the runtime test loads nothing.
 */
import {describe, expect, it} from "bun:test";
import type {createAuthClient, ReactAuthClient} from "better-auth/react";
import type {
  BetterAuthClient,
  BetterAuthClientWithFeatures,
  BetterAuthHandoffClient,
  completeBetterAuthOAuthHandoff,
  createBetterAuthClient,
  ExpoAuthClientPlugin,
  signInSocialWithHandoff,
} from "./betterAuthClient";
import type {
  BetterAuthClientConfig,
  BetterAuthClientFeatures,
  BetterAuthOAuthProvider,
} from "./betterAuthTypes";
import type {createSessionStore} from "./session";

type Create = typeof createBetterAuthClient;

// Exact type equality: mutual assignability is too loose for client types that contain `any`.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// createBetterAuthClient's return type before `features` existed.
type ClientBeforeFeatures = ReactAuthClient<{
  baseURL: string;
  fetchOptions?: NonNullable<Parameters<typeof createAuthClient>[0]>["fetchOptions"];
  plugins: [ExpoAuthClientPlugin];
}>;

// Each helper is only type-checked; none of them runs.
const typeChecks = {
  // Every feature on: each namespace is typed, with its request bodies checked.
  allFeatures: (create: Create): void => {
    const client = create({
      baseURL: "http://localhost:4000",
      features: {
        lastLoginMethod: true,
        multiSession: true,
        oneTimeToken: true,
        passkey: true,
        twoFactor: {
          onTwoFactorRedirect: ({twoFactorMethods}): void => {
            void twoFactorMethods?.includes("totp");
          },
        },
      },
      scheme: "terreno",
    });
    void client.twoFactor.enable({password: "secret"});
    void client.twoFactor.verifyTotp({code: "123456"});
    void client.twoFactor.verifyBackupCode({code: "abcde-12345"});
    // @ts-expect-error verifyTotp requires a code
    void client.twoFactor.verifyTotp({});
    void client.passkey.addPasskey({name: "Laptop"});
    void client.passkey.listUserPasskeys();
    void client.signIn.passkey();
    void client.multiSession.listDeviceSessions();
    void client.multiSession.setActive({sessionToken: "token"});
    void client.oneTimeToken.verify({token: "token"});
    const lastMethod: string | null = client.getLastUsedLoginMethod();
    void lastMethod;
    // Social sign-in and the session stay typed alongside the features.
    void client.signIn.social({provider: "github"});
    void client.signIn.social({provider: "mock-oidc"});
    void client.getSession();
  },
  // Existing apps: no `features` keeps today's return type exactly.
  defaultClient: (create: Create): void => {
    const client = create({baseURL: "http://localhost:4000", scheme: "terreno"});
    const unchanged: Equals<typeof client, ClientBeforeFeatures> = true;
    const sameAsAlias: Equals<typeof client, BetterAuthClient> = true;
    void unchanged;
    void sameAsAlias;
    void client.signIn.social({provider: "google"});
    void client.getSession();
  },

  // Features that are off (or omitted) add nothing.
  disabledFeatures: (create: Create): void => {
    const client = create({
      baseURL: "http://localhost:4000",
      features: {multiSession: false, twoFactor: false},
      scheme: "terreno",
    });
    // @ts-expect-error twoFactor: false adds no namespace
    void client.twoFactor;
    // @ts-expect-error multiSession: false adds no namespace
    void client.multiSession;
  },

  // The exported feature client type names the same client createBetterAuthClient returns.
  featureClientAlias: (create: Create): void => {
    const client = create({
      baseURL: "http://localhost:4000",
      features: {twoFactor: true},
      scheme: "terreno",
    });
    const named: Equals<
      typeof client,
      BetterAuthClientWithFeatures<{readonly twoFactor: true}>
    > = true;
    void named;
  },

  // Generic OAuth providers are accepted wherever a provider is named.
  genericProviders: (): void => {
    const provider: BetterAuthOAuthProvider = "mock-oidc";
    const branded: BetterAuthOAuthProvider = "google";
    void provider;
    void branded;
  },

  // Clients with and without features work with the OAuth handoff helpers.
  helpersAcceptFeatureClients: (
    create: Create,
    signIn: typeof signInSocialWithHandoff,
    complete: typeof completeBetterAuthOAuthHandoff
  ): void => {
    const client = create({
      baseURL: "http://localhost:4000",
      features: {multiSession: true, passkey: true, twoFactor: true},
      scheme: "terreno",
      webAuth: "bearer",
    });
    const handoffClient: BetterAuthHandoffClient = client;
    void complete({client: handoffClient});
    signIn({client, provider: "mock-oidc"});
    const plain = create({baseURL: "http://localhost:4000", scheme: "terreno", webAuth: "bearer"});
    signIn({client: plain, provider: "google"});
    void complete({client: plain});
  },

  // Turning one feature on types only that namespace.
  oneFeature: (create: Create): void => {
    const client = create({
      baseURL: "http://localhost:4000",
      features: {passkey: true},
      scheme: "terreno",
    });
    void client.passkey.addPasskey();
    // @ts-expect-error twoFactor is off
    void client.twoFactor;
  },

  // A config typed as BetterAuthClientConfig does not know its features, so the client is the
  // untyped BetterAuthClient rather than one claiming every namespace.
  preTypedConfig: (create: Create, config: BetterAuthClientConfig): void => {
    const client = create(config);
    const untyped: Equals<typeof client, BetterAuthClient> = true;
    void untyped;
  },
  // ReturnType of the factory is still the client it returned before features existed.
  returnTypeUnchanged: (): void => {
    const unchanged: Equals<ReturnType<Create>, ClientBeforeFeatures> = true;
    const sameAsAlias: Equals<ReturnType<Create>, BetterAuthClient> = true;
    void unchanged;
    void sameAsAlias;
  },

  // A client with features plugs into the session store like any other.
  sessionStoreAcceptsFeatureClients: (create: Create, store: typeof createSessionStore): void => {
    const authClient = create({
      baseURL: "http://localhost:4000",
      features: {lastLoginMethod: true, multiSession: true, passkey: true, twoFactor: true},
      scheme: "terreno",
    });
    store({authClient});
  },

  // A wrapper that forwards features it does not know gets the untyped client too.
  wrapper: (create: Create): void => {
    const createAppClient = (features?: BetterAuthClientFeatures): BetterAuthClient =>
      create({baseURL: "http://localhost:4000", features, scheme: "terreno"});
    const client = createAppClient({twoFactor: true});
    const forwarded = create({
      baseURL: "http://localhost:4000",
      features: {} as BetterAuthClientFeatures,
      scheme: "terreno",
    });
    const untyped: Equals<typeof forwarded, BetterAuthClient> = true;
    void client;
    void untyped;
  },
};

describe("createBetterAuthClient types", () => {
  it("are checked by the compile step", () => {
    expect(Object.keys(typeChecks).length).toBeGreaterThan(0);
  });
});
