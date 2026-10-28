/**
 * Real-process smoke for @terreno/rtk. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * Starts the monorepo's example-backend with `spawnExampleBackend()`, then, in this Bun process,
 * builds a Redux store from the compiled `@terreno/rtk`: a Better Auth client in web bearer mode,
 * `generateBetterAuthSlice`, and `emptySplitApi` with one injected `/auth/me` query. The user
 * signs up and signs in through Better Auth, the slice syncs the session, and the query returns
 * the signed-in user. Exits non-zero on the first failed check.
 *
 * rtk targets React Native, so the native modules its package root loads are shimmed with the
 * same `mock.module` shims its unit tests use (`test-preload.ts`), plus two the package root
 * also loads: `@terreno/ui` (`socket.ts` imports a hook this smoke never calls) and
 * `expo-linking` (imported by the Better Auth Expo plugin).
 */
import {mock} from "bun:test";
import type {BetterAuthClientInterface} from "@terreno/rtk";
import type {BetterAuthReactClientLike} from "@terreno/syncdb";
import {
  type ExampleBackend,
  smokeMongoUri,
  spawnExampleBackend,
  stopSmokeMongo,
} from "@terreno/test";
import {DateTime} from "luxon";

const PASSWORD = "terreno-rtk-smoke-password";
// example-backend runs startup work (migrations, consent sync) before /health turns 200.
const BACKEND_READY_TIMEOUT_MS = 120000;

interface MeResponse {
  email?: string;
}

/** Loads the compiled package behind the shims. Shims must be in place before the import. */
const loadRtk = async (): Promise<typeof import("@terreno/rtk")> => {
  await import("../test-preload");
  mock.module("@terreno/ui", () => ({useToast: () => ({})}));
  // The unit tests replace `@better-auth/expo/client` whole; the smoke runs the real plugin,
  // which imports expo-linking for deep-link URLs (social sign-in only).
  mock.module("expo-linking", () => ({
    createURL: (path: string, options?: {scheme?: string}): string =>
      `${options?.scheme ?? "terreno"}://${path}`,
  }));
  return import("@terreno/rtk");
};

const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  const email = `rtk-smoke-${startedAt.toMillis()}@example.com`;
  let backend: ExampleBackend | undefined;

  try {
    const mongoUri = await smokeMongoUri({databaseName: "rtkSmoke"});
    backend = await spawnExampleBackend({mongoUri, timeoutMs: BACKEND_READY_TIMEOUT_MS});

    // rtk resolves its API base URL from this variable when the package is first imported.
    process.env.EXPO_PUBLIC_API_URL = backend.baseUrl;
    const rtk = await loadRtk();
    const {configureStore} = await import("@reduxjs/toolkit");
    const {betterAuthAdapter, bridgeBetterAuthReactClient} = await import("@terreno/syncdb");

    if (rtk.baseUrl !== backend.baseUrl) {
      throw new Error(`rtk resolved baseUrl ${rtk.baseUrl}, expected ${backend.baseUrl}`);
    }

    // No window in Bun, so the bearer token lives in an in-memory store the client owns.
    const tokens = new Map<string, string>();
    const bearerStorage = {
      getItem: (key: string): string | null => tokens.get(key) ?? null,
      removeItem: (key: string): void => {
        tokens.delete(key);
      },
      setItem: (key: string, value: string): void => {
        tokens.set(key, value);
      },
    };
    const authClient = rtk.createBetterAuthClient({
      baseURL: backend.baseUrl,
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    // The compiled declaration of createBetterAuthClient drops the session methods the plugin
    // adds at runtime (apps hit the same mismatch), so each consumer gets the shape it reads.
    rtk.setTokenSource(
      betterAuthAdapter(
        bridgeBetterAuthReactClient(authClient as unknown as BetterAuthReactClientLike),
        {getBearerToken: () => rtk.getBetterAuthBearerToken({bearerStorage})}
      )
    );

    const api = rtk.emptySplitApi.injectEndpoints({
      endpoints: (builder) => ({
        getMe: builder.query<MeResponse, void>({query: () => "/auth/me"}),
      }),
    });
    const betterAuth = rtk.generateBetterAuthSlice({
      apisToReset: [api],
      authClient: authClient as unknown as BetterAuthClientInterface,
    });
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat([...betterAuth.middleware, api.middleware]),
      reducer: {betterAuth: betterAuth.reducer, [api.reducerPath]: api.reducer},
    });

    const signUp = await authClient.signUp.email({email, name: "rtk smoke", password: PASSWORD});
    if (signUp.error) {
      throw new Error(`sign-up: ${signUp.error.status} ${signUp.error.message}`);
    }
    tokens.clear();
    const signIn = await authClient.signIn.email({email, password: PASSWORD});
    if (signIn.error) {
      throw new Error(`sign-in: ${signIn.error.status} ${signIn.error.message}`);
    }
    if (!rtk.getBetterAuthBearerToken({bearerStorage})) {
      throw new Error("sign-in: the client stored no bearer token");
    }
    console.info(`✅ Better Auth signs ${email} in and the client stores a bearer token`);

    await betterAuth.syncSession(store.dispatch);
    const authState = rtk.selectBetterAuthState(store.getState());
    if (!authState?.isAuthenticated || authState.user?.email !== email) {
      throw new Error(
        `syncSession: expected ${email} signed in, got isAuthenticated=${authState?.isAuthenticated} user=${authState?.user?.email ?? "none"}`
      );
    }
    console.info("✅ generateBetterAuthSlice syncs the session into the store");

    const me = await store.dispatch(api.endpoints.getMe.initiate());
    if (me.error || me.data?.email !== email) {
      throw new Error(
        `getMe: expected ${email}, got ${JSON.stringify(me.error ?? me.data ?? null)}`
      );
    }
    console.info(`✅ an authenticated rtk query to /auth/me returns ${email}`);
  } catch (error: unknown) {
    if (backend) {
      console.error(`--- example-backend output ---\n${backend.output()}`);
    }
    throw error;
  } finally {
    await backend?.stop();
    await stopSmokeMongo();
  }

  console.info(`rtk smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
};

run().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
