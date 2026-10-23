/**
 * Everything a login screen needs from a Better Auth client, in one hook: the server's sign-in
 * methods, a live-session check that skips the screen, "Continue as" cards from this device's
 * signed-in sessions and remembered accounts, the last used method, passkeys (button and browser
 * autofill), social sign-in in cookie or bearer mode, the two-factor step, and guidance for the
 * refusals Terreno's server sends on purpose. `TerrenoLoginScreen` renders `@terreno/ui`'s
 * `LoginScreen` from it; apps with their own screen can spread `screenProps` into theirs.
 */
import type {
  GenericOAuthProviderConfig,
  LoginAccountOption,
  LoginAccountSource,
  LoginNotice,
  LoginScreenProps,
  OAuthProviderConfig,
  TwoFactorChallengeSubmission,
} from "@terreno/ui";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {
  type BetterAuthClient,
  type BetterAuthHandoffClient,
  completeBetterAuthOAuthHandoff,
  getBetterAuthClientWebAuth,
  signInSocialWithHandoff,
} from "../betterAuthClient";
import type {BetterAuthWebAuth} from "../betterAuthTypes";
import {IsWeb} from "../platform";
import {type AuthMethodsClient, type BetterAuthMethods, useAuthMethods} from "../useAuthMethods";
import {getLoginFeedback, type LoginFailure} from "./loginErrors";
import {getOwnEntry} from "./ownEntry";
import {
  type RememberedAccountsStore,
  toLoginAccountOptions,
  useRememberedAccounts,
} from "./rememberedAccounts";

/** The user fields the controller reads from Better Auth responses. */
export interface LoginUser {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  /** Set by the server's `lastLoginMethod` feature (`storeInDatabase`). */
  lastLoginMethod?: string | null;
}

/** A Better Auth error as the client returns it. */
export interface LoginClientError {
  code?: string;
  message?: string;
  status?: number;
}

/** Better Auth client calls resolve `{data, error}` instead of throwing. */
export interface LoginClientResult<Data> {
  data?: Data | null;
  error?: LoginClientError | null;
}

/** One signed-in session on this device, from `multiSession.listDeviceSessions`. */
export interface LoginDeviceSession {
  session: {token: string};
  user: LoginUser;
}

/**
 * The part of a Better Auth client the controller calls. A client from `createBetterAuthClient`
 * satisfies it; `multiSession`, `twoFactor` and `signIn.passkey` exist when those `features` are
 * on, and the controller skips what is missing.
 */
export interface LoginControllerClient extends AuthMethodsClient {
  getSession: () => Promise<LoginClientResult<{session?: unknown; user?: LoginUser} | null>>;
  signIn: {
    email: (body: {email: string; password: string}) => Promise<
      LoginClientResult<{
        twoFactorRedirect?: boolean;
        twoFactorMethods?: string[];
        user?: LoginUser;
      }>
    >;
    social: (body: {
      provider: string;
      callbackURL?: string;
      errorCallbackURL?: string;
    }) => Promise<LoginClientResult<{url?: string; redirect?: boolean}>>;
    passkey?: (options?: {autoFill?: boolean}) => Promise<LoginClientResult<{user?: LoginUser}>>;
  };
  multiSession?: {
    listDeviceSessions: () => Promise<LoginClientResult<LoginDeviceSession[]>>;
    setActive: (body: {sessionToken: string}) => Promise<LoginClientResult<unknown>>;
  };
  twoFactor?: {
    verifyTotp: (body: {
      code: string;
      trustDevice?: boolean;
    }) => Promise<LoginClientResult<{user?: LoginUser}>>;
    verifyBackupCode: (body: {
      code: string;
      trustDevice?: boolean;
    }) => Promise<LoginClientResult<{user?: LoginUser}>>;
  };
}

/** What `onSignedIn` receives. */
export interface LoginSignedInEvent {
  user: LoginUser;
  /** How the user signed in (`"email"`, `"passkey"`, a provider id), when known. */
  method?: string;
}

/** What `onTwoFactorRequired` receives. */
export interface LoginTwoFactorRequiredEvent {
  /** The user's enabled second factors, such as `["totp"]`. */
  twoFactorMethods?: string[];
  /** The first factor that asked for a second one. */
  method: string;
}

/**
 * Any client `createBetterAuthClient` returns. One made without `features` is typed loosely, so
 * it is listed on its own.
 */
export type LoginControllerClientInput = LoginControllerClient | BetterAuthClient;

export interface UseLoginControllerOptions {
  /** A client from `createBetterAuthClient`, ideally with the features the server enables. */
  client: LoginControllerClientInput;
  /** The app's store from `createRememberedAccountsStore`. */
  rememberedAccounts: RememberedAccountsStore;
  /**
   * Pass `false` to record only the method after a sign-in, whatever the store allows. Otherwise
   * the user's name, email and avatar go to the store, which keeps them only when it was created
   * with `rememberIdentity: true`.
   */
  rememberIdentity?: boolean;
  /**
   * Called once a session exists: after a sign-in here, or at once when a live session is found
   * on mount. Sync the session into Redux and navigate here.
   */
  onSignedIn: (event: LoginSignedInEvent) => void | Promise<void>;
  /**
   * Called when a sign-in needs a second factor, to route to the app's own challenge screen.
   * Leave unset to get `step: "twoFactor"` and the inline challenge (`twoFactor`). Do not also set
   * `features.twoFactor.onTwoFactorRedirect` on the client, or both run.
   */
  onTwoFactorRequired?: (event: LoginTwoFactorRequiredEvent) => void;
  /**
   * Where a social sign-in returns. In bearer mode it must be one of the server's
   * `oauthHandoff.callbackPaths`, and should be this login screen's route, so the controller sees
   * the new session and records the method.
   */
  callbackURL?: string;
  /** Where a failed social sign-in returns with `?error=`. Defaults to `callbackURL`. */
  errorCallbackURL?: string;
  /** The `?error=` this page was opened with after an OAuth return. Never displayed as is. */
  error?: string | string[] | null;
  /** Shown as the sign-up link while the server's sign-up is open. */
  onSignUpPress?: () => void;
  /** Shown as the forgot-password link. */
  onForgotPasswordPress?: () => void;
  /** Button labels for providers without a brand, such as `{"mock-oidc": "Mock OIDC"}`. */
  providerLabels?: Record<string, string>;
  /**
   * On web, offer saved passkeys in the email field's autofill (conditional mediation) when the
   * server has passkeys on and the browser supports it.
   * @default true
   */
  passkeyAutofill?: boolean;
  /**
   * Call `onSignedIn` without showing the screen when a session is already live. Pass `false` on
   * an "add another account" route, where the signed-in sessions become "Continue" cards.
   * @default true
   */
  skipWhenSignedIn?: boolean;
  /** Overrides the mode `createBetterAuthClient` recorded for `client` (for custom clients). */
  webAuth?: BetterAuthWebAuth;
  /** Overrides how the bearer token is read in bearer mode (for custom clients). */
  getBearerToken?: () => string | null;
  /** The email the form starts with. */
  initialEmail?: string;
}

/**
 * - `checking`: looking for a live session; show a spinner.
 * - `login`: show the login screen.
 * - `twoFactor`: show the inline two-factor challenge.
 * - `signedIn`: `onSignedIn` ran; the app is navigating away.
 */
export type LoginControllerStep = "checking" | "login" | "twoFactor" | "signedIn";

/** The `LoginScreen` props the controller fills in. Add `fields`, `title`, `logo`, `testID`. */
export type LoginControllerScreenProps = Required<
  Pick<LoginScreenProps, "onSubmit" | "loading" | "onContinue" | "onForget">
> &
  Pick<
    LoginScreenProps,
    | "oauthProviders"
    | "genericProviders"
    | "error"
    | "notice"
    | "lastUsedMethod"
    | "currentSessions"
    | "rememberedAccounts"
    | "onPasskeyPress"
    | "passkeyAutofill"
    | "onSignUpPress"
    | "onForgotPasswordPress"
    | "initialValues"
  >;

/** The inline two-factor challenge, for `TwoFactorChallengeScreen`. */
export interface LoginTwoFactorState {
  twoFactorMethods?: string[];
  error?: string;
  loading: boolean;
  onSubmit: (values: TwoFactorChallengeSubmission) => Promise<void>;
  /** Returns to the login screen. */
  onCancel: () => void;
}

export interface LoginController {
  step: LoginControllerStep;
  /**
   * False when the server has email and password sign-in off: render `LoginScreen` with
   * `fields={[]}` so the form is left out. True while the methods load.
   */
  isEmailPasswordEnabled: boolean;
  /** The server's sign-in methods; undefined while they load or after an error. */
  methods: BetterAuthMethods | undefined;
  screenProps: LoginControllerScreenProps;
  twoFactor: LoginTwoFactorState;
  signInEmail: (values: Record<string, string>) => Promise<void>;
  signInSocial: (provider: string) => Promise<void>;
  signInPasskey: (options?: {autoFill?: boolean}) => Promise<void>;
  continueAs: (account: LoginAccountOption, source: LoginAccountSource) => Promise<void>;
  forget: (account: LoginAccountOption) => Promise<void>;
}

const BRANDED_PROVIDERS: ReadonlyArray<OAuthProviderConfig["provider"]> = [
  "google",
  "github",
  "apple",
];

const METHOD_NAMES: Record<string, string> = {
  apple: "Apple",
  email: "email",
  github: "GitHub",
  google: "Google",
  passkey: "a passkey",
};

const PASSKEY_FAILED_MESSAGE = "Passkey sign-in failed. Please try again.";
const TWO_FACTOR_FAILED_MESSAGE = "That code didn't work. Please try again.";
const METHOD_UNAVAILABLE_MESSAGE =
  "That sign-in method is no longer available. Choose another way to sign in.";

// The provider a redirecting social sign-in started with, kept across the page leaving so the
// method can be recorded when the page comes back signed in.
const PENDING_METHOD_KEY = "terreno_login_pending_method";

const sessionStorageOrNull = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : (window.sessionStorage ?? null);
  } catch {
    return null;
  }
};

const storePendingMethod = (method: string): void => {
  try {
    sessionStorageOrNull()?.setItem(PENDING_METHOD_KEY, method);
  } catch {
    // Storage is blocked: the method is simply not recorded after the return.
  }
};

const takePendingMethod = (): string | undefined => {
  const storage = sessionStorageOrNull();
  try {
    const method = storage?.getItem(PENDING_METHOD_KEY) ?? undefined;
    storage?.removeItem(PENDING_METHOD_KEY);
    return method;
  } catch {
    return undefined;
  }
};

/** "mock-oidc" becomes "Mock Oidc", for a generic provider without a label. */
const humanizeProviderId = (id: string): string => {
  return id
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

const toFailure = (error: LoginClientError): LoginFailure => ({
  code: error.code,
  message: error.message,
  source: "response",
});

const urlFailure = (error: string | string[] | null | undefined): LoginFailure | undefined => {
  const code = Array.isArray(error) ? error[0] : error;
  return code ? {code, source: "url"} : undefined;
};

// T19's store masks every email it keeps, so only an unmasked address can prefill the form.
const isUsableEmail = (email: string | undefined): email is string => {
  return Boolean(email?.includes("@") && !email.includes("*"));
};

/**
 * Records a sign-in in the remembered-accounts store. The controller calls it after every
 * sign-in it finishes; call it yourself after a sign-in finished elsewhere, such as an app's own
 * two-factor screen (`method: "email"`).
 */
export const recordRememberedSignIn = async ({
  method,
  rememberIdentity = true,
  store,
  user,
}: {
  method: string;
  rememberIdentity?: boolean;
  store: RememberedAccountsStore;
  user: LoginUser;
}): Promise<void> => {
  try {
    await store.record({
      method,
      userId: user.id,
      ...(rememberIdentity ? {email: user.email, image: user.image, name: user.name} : {}),
    });
  } catch (error) {
    console.warn("[terreno/rtk] Could not remember the signed-in account", error);
  }
};

/**
 * Drives a login screen from a Better Auth client. See "Drop-in login screen" in
 * docs/how-to/configure-better-auth.md.
 *
 * @example
 * ```tsx
 * const login = useLoginController({
 *   client: authClient,
 *   onSignedIn: async () => {
 *     await betterAuth.syncSession(dispatch);
 *     router.replace("/");
 *   },
 *   rememberedAccounts,
 * });
 * return <LoginScreen fields={fields} {...login.screenProps} />;
 * ```
 */
export const useLoginController = ({
  client: clientInput,
  rememberedAccounts,
  rememberIdentity,
  onSignedIn,
  onTwoFactorRequired,
  callbackURL,
  errorCallbackURL,
  error: returnError,
  onSignUpPress,
  onForgotPasswordPress,
  providerLabels,
  passkeyAutofill = true,
  skipWhenSignedIn = true,
  webAuth,
  getBearerToken,
  initialEmail,
}: UseLoginControllerOptions): LoginController => {
  const client = clientInput as LoginControllerClient;
  const {methods} = useAuthMethods(client);
  const remembered = useRememberedAccounts(rememberedAccounts);

  const [step, setStep] = useState<LoginControllerStep>("checking");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<LoginFailure | undefined>(() => urlFailure(returnError));
  const [infoNotice, setInfoNotice] = useState<LoginNotice | undefined>(undefined);
  const [deviceSessions, setDeviceSessions] = useState<LoginDeviceSession[]>([]);
  const [twoFactorMethods, setTwoFactorMethods] = useState<string[] | undefined>(undefined);
  const [twoFactorError, setTwoFactorError] = useState<string | undefined>(undefined);
  const [isVerifying, setIsVerifying] = useState(false);
  const [initialValues, setInitialValues] = useState<Record<string, string> | undefined>(() =>
    initialEmail ? {email: initialEmail} : undefined
  );

  const isBearer = (webAuth ?? getBetterAuthClientWebAuth(client).webAuth) === "bearer";

  // The latest callbacks and values, read by async work that outlives a render.
  const latest = useRef({onSignedIn, onTwoFactorRequired, rememberIdentity, step});
  latest.current = {onSignedIn, onTwoFactorRequired, rememberIdentity, step};
  const twoFactorMethodRef = useRef("email");

  const readBearerToken = useCallback((): string | null => {
    return getBearerToken ? getBearerToken() : getBetterAuthClientWebAuth(client).bearerToken;
  }, [client, getBearerToken]);

  const readSessionUser = useCallback(async (): Promise<LoginUser | undefined> => {
    const {data} = await client.getSession();
    return data?.session && data.user ? data.user : undefined;
  }, [client]);

  const rememberedMethodFor = useCallback(
    (userId: string): string | undefined => {
      return remembered.accounts.find((account) => account.userId === userId)?.method;
    },
    [remembered.accounts]
  );

  const finishSignIn = useCallback(
    async ({user, method}: LoginSignedInEvent): Promise<void> => {
      // Whatever finished, a social sign-in still marked pending is over.
      takePendingMethod();
      if (method) {
        await recordRememberedSignIn({
          method,
          rememberIdentity: latest.current.rememberIdentity !== false,
          store: rememberedAccounts,
          user,
        });
      }
      setStep("signedIn");
      try {
        await latest.current.onSignedIn({method, user});
      } catch (error) {
        // The session exists, but the app could not take it; let the user try again.
        console.error("[terreno/rtk] onSignedIn threw", error);
        setStep("login");
        setFailure({source: "response"});
      }
    },
    [rememberedAccounts]
  );

  // Clears earlier feedback and marks a sign-in as running.
  const begin = useCallback((what: string): void => {
    takePendingMethod();
    setBusy(what);
    setFailure(undefined);
    setInfoNotice(undefined);
  }, []);

  // Finishes with the user a response carried, or else the session it created.
  const finishWithResponse = useCallback(
    async (user: LoginUser | undefined, method: string): Promise<void> => {
      const signedInUser = user ?? (await readSessionUser());
      if (!signedInUser) {
        setFailure({source: "response"});
        return;
      }
      await finishSignIn({method, user: signedInUser});
    },
    [finishSignIn, readSessionUser]
  );

  // Look for a live session once per client: a valid one skips the screen. The other inputs are
  // read when it runs.
  useEffect(() => {
    let isCancelled = false;
    const check = async (): Promise<void> => {
      // A bearer-mode social sign-in may have just returned with its one-time token. The app
      // normally exchanges it at startup; finishing it here too (it is idempotent) means the
      // token is read only after the exchange settles.
      if (isBearer) {
        await completeBetterAuthOAuthHandoff({
          client: client as unknown as BetterAuthHandoffClient,
        });
        if (isCancelled) {
          return;
        }
      }
      if (!skipWhenSignedIn || (isBearer && !readBearerToken())) {
        takePendingMethod();
        setStep("login");
        return;
      }
      try {
        const {data} = await client.getSession();
        if (isCancelled) {
          return;
        }
        if (data?.session && data.user) {
          const method = takePendingMethod() ?? data.user.lastLoginMethod ?? undefined;
          await finishSignIn({method, user: data.user});
          return;
        }
      } catch (error) {
        console.warn("[terreno/rtk] Could not check for a live session", error);
      }
      if (!isCancelled) {
        takePendingMethod();
        setStep("login");
      }
    };
    void check();
    return (): void => {
      isCancelled = true;
    };
  }, [client]);

  // A new `?error=` (another OAuth return) replaces whatever the screen showed.
  const returnErrorCode = Array.isArray(returnError) ? returnError[0] : returnError;
  useEffect(() => {
    if (returnErrorCode) {
      setFailure({code: returnErrorCode, source: "url"});
    }
  }, [returnErrorCode]);

  // List this device's signed-in sessions. Bearer clients send no cookies, so the server cannot
  // see their multi-session cookies; remembered accounts cover them instead.
  const isMultiSessionOn = Boolean(methods?.multiSession && client.multiSession && !isBearer);
  useEffect(() => {
    const multiSession = client.multiSession;
    if (step !== "login" || !isMultiSessionOn || !multiSession) {
      return;
    }
    let isCancelled = false;
    const load = async (): Promise<void> => {
      try {
        const {data} = await multiSession.listDeviceSessions();
        if (!isCancelled) {
          setDeviceSessions(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.warn("[terreno/rtk] Could not list this device's sessions", error);
      }
    };
    void load();
    return (): void => {
      isCancelled = true;
    };
  }, [client, isMultiSessionOn, step]);

  const requireTwoFactor = useCallback((event: LoginTwoFactorRequiredEvent): void => {
    twoFactorMethodRef.current = event.method;
    setTwoFactorMethods(event.twoFactorMethods);
    setTwoFactorError(undefined);
    if (latest.current.onTwoFactorRequired) {
      latest.current.onTwoFactorRequired(event);
      return;
    }
    setStep("twoFactor");
  }, []);

  const signInEmail = useCallback(
    async (values: Record<string, string>): Promise<void> => {
      begin("email");
      try {
        const result = await client.signIn.email({
          email: (values.email ?? "").trim(),
          password: values.password ?? "",
        });
        if (result.error) {
          setFailure(toFailure(result.error));
          return;
        }
        if (result.data?.twoFactorRedirect) {
          requireTwoFactor({method: "email", twoFactorMethods: result.data.twoFactorMethods});
          return;
        }
        await finishWithResponse(result.data?.user, "email");
      } catch (error) {
        console.error("[terreno/rtk] Email sign-in threw", error);
        setFailure({source: "response"});
      } finally {
        setBusy(null);
      }
    },
    [begin, client, finishWithResponse, requireTwoFactor]
  );

  const signInSocial = useCallback(
    async (provider: string): Promise<void> => {
      begin(provider);
      storePendingMethod(provider);
      try {
        if (isBearer) {
          // The page navigates to the API and comes back to callbackURL with a one-time token.
          signInSocialWithHandoff({
            client: client as unknown as BetterAuthHandoffClient,
            provider,
            ...(callbackURL ? {callbackURL} : {}),
            ...(errorCallbackURL ? {errorCallbackURL} : {}),
          });
          return;
        }
        const result = await client.signIn.social({
          provider,
          ...(callbackURL ? {callbackURL} : {}),
          ...(errorCallbackURL ? {errorCallbackURL} : {}),
        });
        if (result.error) {
          takePendingMethod();
          setFailure(toFailure(result.error));
          return;
        }
        // In a browser Better Auth is sending the page to the provider; the method is recorded
        // when it comes back signed in.
        if (IsWeb && typeof window !== "undefined" && result.data?.url) {
          return;
        }
        // On native the provider's browser flow has already finished in-process.
        const user = await readSessionUser();
        const method = takePendingMethod() ?? provider;
        if (user) {
          await finishSignIn({method, user});
        }
      } catch (error) {
        console.error("[terreno/rtk] Social sign-in threw", error);
        takePendingMethod();
        setFailure({source: "response"});
      } finally {
        // Also cleared while the page leaves, so Back from the provider shows usable buttons.
        setBusy(null);
      }
    },
    [begin, callbackURL, client, errorCallbackURL, finishSignIn, isBearer, readSessionUser]
  );

  const signInPasskey = useCallback(
    async ({
      autoFill = false,
      isCancelled,
    }: {
      autoFill?: boolean;
      isCancelled?: () => boolean;
    } = {}): Promise<void> => {
      if (!client.signIn.passkey) {
        return;
      }
      if (!autoFill) {
        begin("passkey");
      }
      try {
        const result = await client.signIn.passkey(autoFill ? {autoFill: true} : undefined);
        // Autofill that the screen gave up on (it unmounted or left the login step), or that a
        // sign-in finished another way overtook, ends here.
        if (autoFill && (isCancelled?.() || latest.current.step === "signedIn")) {
          return;
        }
        if (result.error) {
          // Autofill ends quietly whenever another ceremony replaces it.
          if (autoFill) {
            console.info("[terreno/rtk] Passkey autofill ended", {code: result.error.code});
            return;
          }
          setFailure({message: result.error.message ?? PASSKEY_FAILED_MESSAGE, source: "response"});
          return;
        }
        await finishWithResponse(result.data?.user, "passkey");
      } catch (error) {
        console.error("[terreno/rtk] Passkey sign-in threw", error);
        if (!autoFill) {
          setFailure({message: PASSKEY_FAILED_MESSAGE, source: "response"});
        }
      } finally {
        if (!autoFill) {
          setBusy(null);
        }
      }
    },
    [begin, client, finishWithResponse]
  );

  // Offer saved passkeys in the email field's autofill once the screen shows, where the browser
  // supports conditional mediation.
  // Starts again each time the screen returns to the login step. There is no abort on cleanup:
  // the ceremony's abort service lives in @simplewebauthn/browser, which rtk does not depend on;
  // the next ceremony replaces it, and a cancelled run never finishes a sign-in.
  const isPasskeyOn = Boolean(methods?.passkey && client.signIn.passkey && IsWeb);
  useEffect(() => {
    if (step !== "login" || !isPasskeyOn || !passkeyAutofill) {
      return;
    }
    const credential = (
      globalThis as {
        window?: {PublicKeyCredential?: {isConditionalMediationAvailable?: () => Promise<boolean>}};
      }
    ).window?.PublicKeyCredential;
    if (typeof credential?.isConditionalMediationAvailable !== "function") {
      return;
    }
    let isCancelled = false;
    void credential
      .isConditionalMediationAvailable()
      .then((isAvailable) =>
        isAvailable && !isCancelled
          ? signInPasskey({autoFill: true, isCancelled: () => isCancelled})
          : undefined
      )
      .catch((error: unknown) => {
        console.info("[terreno/rtk] Passkey autofill is unavailable", error);
      });
    return (): void => {
      isCancelled = true;
    };
  }, [isPasskeyOn, passkeyAutofill, signInPasskey, step]);

  const verifyTwoFactor = useCallback(
    async ({code, kind, trustDevice}: TwoFactorChallengeSubmission): Promise<void> => {
      if (!client.twoFactor) {
        setTwoFactorError(TWO_FACTOR_FAILED_MESSAGE);
        return;
      }
      setIsVerifying(true);
      setTwoFactorError(undefined);
      try {
        const result =
          kind === "backup"
            ? await client.twoFactor.verifyBackupCode({code, trustDevice})
            : await client.twoFactor.verifyTotp({code, trustDevice});
        if (result.error) {
          setTwoFactorError(result.error.message ?? TWO_FACTOR_FAILED_MESSAGE);
          return;
        }
        const user = result.data?.user ?? (await readSessionUser());
        if (!user) {
          setTwoFactorError(TWO_FACTOR_FAILED_MESSAGE);
          return;
        }
        await finishSignIn({method: twoFactorMethodRef.current, user});
      } catch (error) {
        console.error("[terreno/rtk] Two-factor verification threw", error);
        setTwoFactorError(TWO_FACTOR_FAILED_MESSAGE);
      } finally {
        setIsVerifying(false);
      }
    },
    [client, finishSignIn, readSessionUser]
  );

  const cancelTwoFactor = useCallback((): void => {
    setTwoFactorError(undefined);
    setStep("login");
  }, []);

  const offeredProviders = methods?.providers;
  // True while the methods load, so the form does not flash away for servers that offer it.
  const isEmailPasswordEnabled = methods?.emailPassword !== false;
  const nameMethod = useCallback(
    (method: string | undefined): string | undefined => {
      if (!method) {
        return undefined;
      }
      return (
        getOwnEntry(METHOD_NAMES, method) ??
        getOwnEntry(providerLabels, method) ??
        humanizeProviderId(method)
      );
    },
    [providerLabels]
  );

  const continueAs = useCallback(
    async (account: LoginAccountOption, source: LoginAccountSource): Promise<void> => {
      if (source === "session") {
        if (!client.multiSession) {
          return;
        }
        begin("continue");
        try {
          const result = await client.multiSession.setActive({sessionToken: account.id});
          if (result.error) {
            setFailure(toFailure(result.error));
            return;
          }
          const user = await readSessionUser();
          if (!user) {
            setFailure({source: "response"});
            return;
          }
          await finishSignIn({
            method: rememberedMethodFor(user.id) ?? user.lastLoginMethod ?? undefined,
            user,
          });
        } catch (error) {
          console.error("[terreno/rtk] Switching sessions threw", error);
          setFailure({source: "response"});
        } finally {
          setBusy(null);
        }
        return;
      }
      if (account.method === "passkey" && isPasskeyOn) {
        await signInPasskey();
        return;
      }
      if (offeredProviders?.includes(account.method)) {
        await signInSocial(account.method);
        return;
      }
      if (account.method === "email" && isEmailPasswordEnabled) {
        setFailure(undefined);
        if (isUsableEmail(account.email)) {
          setInfoNotice(undefined);
          setInitialValues({email: account.email});
          return;
        }
        const who = account.name ?? account.email;
        setInfoNotice({
          text: who
            ? `Enter your email and password to continue as ${who}.`
            : "Enter your email and password to continue.",
          tone: "info",
        });
        return;
      }
      setInfoNotice(undefined);
      setFailure({message: METHOD_UNAVAILABLE_MESSAGE, source: "response"});
    },
    [
      begin,
      client,
      finishSignIn,
      isEmailPasswordEnabled,
      isPasskeyOn,
      offeredProviders,
      readSessionUser,
      rememberedMethodFor,
      signInPasskey,
      signInSocial,
    ]
  );

  const forget = useCallback(
    (account: LoginAccountOption): Promise<void> => rememberedAccounts.forget(account.id),
    [rememberedAccounts]
  );

  const feedback = useMemo(
    () =>
      getLoginFeedback({
        failure,
        mode: methods?.accountLinking.mode,
        originalMethod: nameMethod(remembered.lastUsedMethod),
      }),
    [failure, methods?.accountLinking.mode, nameMethod, remembered.lastUsedMethod]
  );

  const isLoading = busy !== null;

  const oauthProviders = useMemo((): OAuthProviderConfig[] => {
    return BRANDED_PROVIDERS.filter((provider) => offeredProviders?.includes(provider)).map(
      (provider) => ({
        disabled: isLoading,
        loading: busy === provider,
        onPress: (): Promise<void> => signInSocial(provider),
        provider,
      })
    );
  }, [busy, isLoading, offeredProviders, signInSocial]);

  const genericProviders = useMemo((): GenericOAuthProviderConfig[] => {
    return (offeredProviders ?? [])
      .filter((id) => !(BRANDED_PROVIDERS as readonly string[]).includes(id))
      .map((id) => ({
        disabled: isLoading,
        id,
        label: getOwnEntry(providerLabels, id) ?? humanizeProviderId(id),
        loading: busy === id,
        onPress: (): Promise<void> => signInSocial(id),
      }));
  }, [busy, isLoading, offeredProviders, providerLabels, signInSocial]);

  const currentSessions = useMemo((): LoginAccountOption[] => {
    return deviceSessions.map(({session, user}) => {
      const option: LoginAccountOption = {
        id: session.token,
        method: rememberedMethodFor(user.id) ?? user.lastLoginMethod ?? "email",
      };
      if (user.name) {
        option.name = user.name;
      }
      if (user.email) {
        option.email = user.email;
      }
      if (user.image) {
        option.image = user.image;
      }
      return option;
    });
  }, [deviceSessions, rememberedMethodFor]);

  // A signed-in session on this device beats a remembered entry for the same user.
  const rememberedOptions = useMemo((): LoginAccountOption[] => {
    const signedInUserIds = new Set(deviceSessions.map(({user}) => user.id));
    return toLoginAccountOptions(
      remembered.accounts.filter((account) => !signedInUserIds.has(account.userId))
    );
  }, [deviceSessions, remembered.accounts]);

  const isSignUpOpen = methods?.signUp !== false && !feedback.isSignUpClosed;
  const handlePasskeyPress = useCallback((): Promise<void> => signInPasskey(), [signInPasskey]);

  const screenProps = useMemo(
    (): LoginControllerScreenProps => ({
      currentSessions,
      error: feedback.error,
      genericProviders,
      initialValues,
      lastUsedMethod: remembered.lastUsedMethod,
      loading: isLoading,
      notice: feedback.notice ?? infoNotice,
      oauthProviders,
      onContinue: continueAs,
      onForget: forget,
      onForgotPasswordPress: isEmailPasswordEnabled ? onForgotPasswordPress : undefined,
      onPasskeyPress: isPasskeyOn ? handlePasskeyPress : undefined,
      onSignUpPress: isSignUpOpen ? onSignUpPress : undefined,
      onSubmit: signInEmail,
      passkeyAutofill: isPasskeyOn && passkeyAutofill,
      rememberedAccounts: rememberedOptions,
    }),
    [
      continueAs,
      currentSessions,
      feedback,
      forget,
      genericProviders,
      handlePasskeyPress,
      infoNotice,
      initialValues,
      isEmailPasswordEnabled,
      isLoading,
      isPasskeyOn,
      isSignUpOpen,
      oauthProviders,
      onForgotPasswordPress,
      onSignUpPress,
      passkeyAutofill,
      remembered.lastUsedMethod,
      rememberedOptions,
      signInEmail,
    ]
  );

  const twoFactor = useMemo(
    (): LoginTwoFactorState => ({
      error: twoFactorError,
      loading: isVerifying,
      onCancel: cancelTwoFactor,
      onSubmit: verifyTwoFactor,
      twoFactorMethods,
    }),
    [cancelTwoFactor, isVerifying, twoFactorError, twoFactorMethods, verifyTwoFactor]
  );

  return {
    continueAs,
    forget,
    isEmailPasswordEnabled,
    methods,
    screenProps,
    signInEmail,
    signInPasskey,
    signInSocial,
    step,
    twoFactor,
  };
};
