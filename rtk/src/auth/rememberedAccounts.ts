/**
 * Accounts remembered on this device, for the login screen's "last used" badge and
 * "Continue as" cards.
 *
 * The device may be shared (a family tablet, a clinic kiosk), so the store is conservative:
 * by default it keeps only `{userId, method, lastUsedAt}`. Name, a masked email and an avatar
 * URL are kept only when the app opts in with `rememberIdentity: true`, and turning that off
 * scrubs identity already on the device the next time the store loads or writes. Nothing here
 * is a credential: a remembered account still signs in with its method.
 */
import type {LoginAccountOption} from "@terreno/ui";
import * as SecureStore from "expo-secure-store";
import {DateTime} from "luxon";
import {useCallback, useMemo, useSyncExternalStore} from "react";

import {IsWeb} from "../platform";

/** One account remembered on this device. */
export interface RememberedAccount {
  /** The Better Auth user id. */
  userId: string;
  /** How the account last signed in: a provider id, `"email"`, or `"passkey"`. */
  method: string;
  /** When the account last signed in on this device, as an ISO 8601 UTC timestamp. */
  lastUsedAt: string;
  /** Display name. Stored only with `rememberIdentity: true`. */
  name?: string;
  /** Masked email such as `j***@n***.io`. Stored only with `rememberIdentity: true`. */
  email?: string;
  /** Avatar URL (https only). Stored only with `rememberIdentity: true`. */
  image?: string;
}

/** What {@link RememberedAccountsStore.record} accepts after a successful sign-in. */
export interface RememberedAccountInput {
  userId: string;
  method: string;
  /** ISO 8601 timestamp. Defaults to now. */
  lastUsedAt?: string;
  /** Kept only with `rememberIdentity: true`. */
  name?: string | null;
  /** Kept only with `rememberIdentity: true`, and always masked before it is stored. */
  email?: string | null;
  /** Kept only with `rememberIdentity: true`. */
  image?: string | null;
}

/**
 * Key/value storage the store persists to. Sync (localStorage) and async (SecureStore)
 * implementations both work; with an async `getItem` the store starts unhydrated.
 */
export interface RememberedAccountsStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

export interface RememberedAccountsStoreOptions {
  /**
   * Required. Pass `false` to remember only the method (the conservative choice for shared
   * devices), or `true` to also remember name, masked email and avatar.
   */
  rememberIdentity: boolean;
  /**
   * Storage key. Defaults to `terreno_remembered_accounts`. On native it must use only
   * letters, digits, `.`, `-` and `_` (an expo-secure-store requirement).
   */
  storageKey?: string;
  /** How many accounts to keep, newest first. Defaults to 5. */
  max?: number;
  /** Storage override. Defaults to SecureStore on native and localStorage on web. */
  storage?: RememberedAccountsStorage;
}

/** An immutable view of the store, replaced on every change. */
export interface RememberedAccountsSnapshot {
  /** Remembered accounts, most recently used first. */
  accounts: RememberedAccount[];
  /** The newest account's method, or undefined when nothing is remembered. */
  lastUsedMethod?: string;
  /** False until async storage (native) has loaded. Always true for sync storage. */
  isHydrated: boolean;
}

export interface RememberedAccountsStore {
  /** Records a sign-in, replacing any earlier entry for the same user. */
  record: (entry: RememberedAccountInput) => Promise<void>;
  /** Removes one account from this device. */
  forget: (userId: string) => Promise<void>;
  /** Removes every remembered account and the storage key. */
  clear: () => Promise<void>;
  /** Remembered accounts, most recently used first. */
  list: () => RememberedAccount[];
  /** The newest account's method, or undefined. */
  lastUsedMethod: () => string | undefined;
  isHydrated: () => boolean;
  /** Resolves once storage has loaded. */
  ready: Promise<void>;
  getSnapshot: () => RememberedAccountsSnapshot;
  /** Calls `listener` after every change. Returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
  /** Stops listening for changes made in other browser tabs. */
  dispose: () => void;
}

export interface UseRememberedAccountsResult {
  accounts: RememberedAccount[];
  lastUsedMethod?: string;
  isHydrated: boolean;
  forget: (userId: string) => Promise<void>;
  clear: () => Promise<void>;
}

const DEFAULT_STORAGE_KEY = "terreno_remembered_accounts";
const DEFAULT_MAX = 5;
const STORAGE_VERSION = 1;
// expo-secure-store rejects or warns on values over 2048 bytes on some platforms.
const MAX_STORED_BYTES = 2048;
const MAX_USER_ID_LENGTH = 128;
const MAX_METHOD_LENGTH = 64;
const MAX_NAME_LENGTH = 64;
const MAX_IMAGE_LENGTH = 256;

// window.localStorage's synchronous surface.
interface SyncKeyValueStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const NO_STORAGE: SyncKeyValueStorage = {
  getItem: () => null,
  removeItem: () => {},
  setItem: () => {},
};

const resolveLocalStorage = (): SyncKeyValueStorage => {
  if (typeof window === "undefined") {
    return NO_STORAGE;
  }
  try {
    // Reading `window.localStorage` throws when the browser blocks site storage.
    return window.localStorage ?? NO_STORAGE;
  } catch {
    return NO_STORAGE;
  }
};

/**
 * The default storage: SecureStore on native (on iOS, never restored to another device from a
 * backup; on Android, excluded from Auto Backup by the expo-secure-store config plugin),
 * localStorage on web, resolved on each call so a store created before `window` exists still
 * finds it. `isWeb` is a parameter so both branches are testable without reloading modules.
 */
export const createRememberedAccountsStorage = (
  isWeb: boolean = IsWeb
): RememberedAccountsStorage => {
  if (!isWeb) {
    const options = {keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY};
    return {
      getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key, options),
      removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key, options),
      setItem: (key: string, value: string): Promise<void> =>
        SecureStore.setItemAsync(key, value, options),
    };
  }
  return {
    getItem: (key: string): string | null => {
      try {
        return resolveLocalStorage().getItem(key);
      } catch {
        return null;
      }
    },
    removeItem: (key: string): void => {
      resolveLocalStorage().removeItem(key);
    },
    setItem: (key: string, value: string): void => {
      resolveLocalStorage().setItem(key, value);
    },
  };
};

/**
 * Masks an email for display on a shared device: the first character of the local part and of
 * the domain stay, the rest is hidden, and only the top-level domain is shown in full. Any
 * subdomains fold into the hidden part, and a one-letter local part looks like a long one.
 * `josh@mail.flourish.health` becomes `j***@m***.health`. Idempotent. Returns undefined for
 * anything that is not an email.
 */
export const maskEmail = (email: string): string | undefined => {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return undefined;
  }
  const local = trimmed.slice(0, at);
  const labels = trimmed.slice(at + 1).split(".");
  if (labels.some((label) => label.length === 0)) {
    return undefined;
  }
  const hide = (value: string): string => `${Array.from(value)[0]}***`;
  if (labels.length === 1) {
    return `${hide(local)}@${hide(labels[0])}`;
  }
  const topLevel = labels[labels.length - 1];
  return `${hide(local)}@${hide(labels.slice(0, -1).join("."))}.${topLevel}`;
};

const isNonEmptyString = (value: unknown, maxLength: number): value is string => {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
};

const normalizeTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = DateTime.fromISO(value, {zone: "utc"});
  if (!parsed.isValid) {
    return undefined;
  }
  return parsed.toUTC().toISO() ?? undefined;
};

const sanitizeName = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return Array.from(value.trim()).slice(0, MAX_NAME_LENGTH).join("");
};

const sanitizeImage = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > MAX_IMAGE_LENGTH) {
    return undefined;
  }
  return /^https:\/\//i.test(value) ? value : undefined;
};

// Builds an account with a fixed key order so serialization is stable across loads.
const sanitizeAccount = (
  value: unknown,
  rememberIdentity: boolean
): RememberedAccount | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const lastUsedAt = normalizeTimestamp(raw.lastUsedAt);
  if (
    !isNonEmptyString(raw.userId, MAX_USER_ID_LENGTH) ||
    !isNonEmptyString(raw.method, MAX_METHOD_LENGTH) ||
    !lastUsedAt
  ) {
    return undefined;
  }
  const account: RememberedAccount = {lastUsedAt, method: raw.method, userId: raw.userId};
  if (!rememberIdentity) {
    return account;
  }
  const name = sanitizeName(raw.name);
  const email = typeof raw.email === "string" ? maskEmail(raw.email) : undefined;
  const image = sanitizeImage(raw.image);
  if (name) {
    account.name = name;
  }
  if (email) {
    account.email = email;
  }
  if (image) {
    account.image = image;
  }
  return account;
};

const byteLength = (value: string): number => {
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x").length;
};

const serialize = (accounts: RememberedAccount[]): string => {
  return JSON.stringify({accounts, v: STORAGE_VERSION});
};

// Newest first, one entry per user, at most `max`, and small enough for SecureStore.
const normalizeList = (accounts: RememberedAccount[], max: number): RememberedAccount[] => {
  const seen = new Set<string>();
  const unique = accounts
    .map((account, index) => ({
      account,
      index,
      millis: DateTime.fromISO(account.lastUsedAt).toMillis(),
    }))
    .sort((a, b) => b.millis - a.millis || a.index - b.index)
    .map(({account}) => account)
    .filter((account) => {
      if (seen.has(account.userId)) {
        return false;
      }
      seen.add(account.userId);
      return true;
    });
  const kept = unique.slice(0, max);
  while (kept.length > 0 && byteLength(serialize(kept)) > MAX_STORED_BYTES) {
    kept.pop();
  }
  return kept;
};

// Returns undefined when the stored value is unusable and should be reset.
const parseStored = (raw: string, rememberIdentity: boolean): RememberedAccount[] | undefined => {
  if (byteLength(raw) > MAX_STORED_BYTES) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const {accounts, v} = parsed as {accounts?: unknown; v?: unknown};
  if (v !== STORAGE_VERSION || !Array.isArray(accounts)) {
    return undefined;
  }
  return accounts
    .map((account) => sanitizeAccount(account, rememberIdentity))
    .filter((account): account is RememberedAccount => account !== undefined);
};

interface StoredRead {
  accounts: RememberedAccount[];
  action: "none" | "reset" | "rewrite";
}

const isPromise = <T>(value: T | Promise<T>): value is Promise<T> => {
  return typeof (value as {then?: unknown} | null)?.then === "function";
};

/**
 * Creates the on-device store of remembered accounts. Create one per app (module scope) and
 * share it between the login screen and sign-out. See "Remember accounts on this device" in
 * docs/how-to/configure-better-auth.md.
 */
export const createRememberedAccountsStore = ({
  rememberIdentity,
  storageKey = DEFAULT_STORAGE_KEY,
  max = DEFAULT_MAX,
  storage = createRememberedAccountsStorage(),
}: RememberedAccountsStoreOptions): RememberedAccountsStore => {
  const limit = Math.max(1, Math.floor(max));
  const listeners = new Set<() => void>();
  let snapshot: RememberedAccountsSnapshot = {accounts: [], isHydrated: false};

  const setState = (accounts: RememberedAccount[], isHydrated: boolean): void => {
    snapshot = {accounts, isHydrated, lastUsedMethod: accounts[0]?.method};
    for (const listener of listeners) {
      listener();
    }
  };

  const reset = async (): Promise<void> => {
    try {
      await storage.removeItem(storageKey);
    } catch (error) {
      console.warn("[rememberedAccounts] Could not clear stored accounts", error);
    }
  };

  const persist = async (accounts: RememberedAccount[]): Promise<void> => {
    if (accounts.length === 0) {
      await reset();
      return;
    }
    try {
      await storage.setItem(storageKey, serialize(accounts));
    } catch (error) {
      console.warn("[rememberedAccounts] Could not save remembered accounts", error);
      await reset();
    }
  };

  // Interprets a stored value. Unusable data reads as empty and must be reset; data the current
  // options would store differently (identity after opting out, unmasked email, over `max`)
  // must be rewritten.
  const interpret = (raw: string | null): StoredRead => {
    if (raw === null) {
      return {accounts: [], action: "none"};
    }
    const parsed = parseStored(raw, rememberIdentity);
    if (!parsed) {
      console.warn("[rememberedAccounts] Ignoring unreadable remembered accounts");
      return {accounts: [], action: "reset"};
    }
    const accounts = normalizeList(parsed, limit);
    if (accounts.length === 0 || serialize(accounts) !== raw) {
      return {accounts, action: "rewrite"};
    }
    return {accounts, action: "none"};
  };

  const settle = async ({accounts, action}: StoredRead): Promise<void> => {
    if (action === "reset") {
      await reset();
    } else if (action === "rewrite") {
      await persist(accounts);
    }
  };

  // Stays synchronous for synchronous storage, so web state is ready as soon as the store exists.
  const hydrate = (): Promise<void> => {
    let raw: string | null | Promise<string | null>;
    try {
      raw = storage.getItem(storageKey);
    } catch (error) {
      console.warn("[rememberedAccounts] Could not read remembered accounts", error);
      setState([], true);
      return Promise.resolve();
    }
    const apply = (value: string | null): Promise<void> => {
      const read = interpret(value);
      setState(read.accounts, true);
      return settle(read);
    };
    if (!isPromise(raw)) {
      return apply(raw);
    }
    return raw.then(apply, (error: unknown) => {
      console.warn("[rememberedAccounts] Could not read remembered accounts", error);
      setState([], true);
    });
  };

  // Storage is the source of truth: another tab, or another store on the same key, may have
  // changed it since this store last looked. Keeps the in-memory list when storage is unreadable.
  const readCurrent = async (): Promise<RememberedAccount[]> => {
    try {
      return interpret(await storage.getItem(storageKey)).accounts;
    } catch (error) {
      console.warn("[rememberedAccounts] Could not read remembered accounts", error);
      return snapshot.accounts;
    }
  };

  const ready = hydrate();
  // Operations run one at a time after hydration, so a sign-in recorded while native storage is
  // still loading merges with what was stored. Each runs after the previous one settles, even
  // when it failed, so one failure is reported to its caller without blocking later calls.
  let queue: Promise<void> = ready;
  const run = (operation: () => Promise<void>): Promise<void> => {
    const next = queue.catch(() => {}).then(operation);
    queue = next;
    return next;
  };

  const enqueue = (
    change: (accounts: RememberedAccount[]) => RememberedAccount[]
  ): Promise<void> => {
    return run(async () => {
      const accounts = normalizeList(change(await readCurrent()), limit);
      setState(accounts, true);
      await persist(accounts);
    });
  };

  // On web, follow changes other tabs make to the same key (`key` is null when a tab clears
  // all of localStorage).
  const eventTarget = typeof window === "undefined" ? undefined : window;
  const onStorage = (event: {key: string | null}): void => {
    if (event.key !== null && event.key !== storageKey) {
      return;
    }
    run(async () => {
      setState(await readCurrent(), true);
    }).catch((error: unknown) => {
      console.warn("[rememberedAccounts] Could not reload remembered accounts", error);
    });
  };
  if (typeof eventTarget?.addEventListener === "function") {
    eventTarget.addEventListener("storage", onStorage);
  }

  const record = (entry: RememberedAccountInput): Promise<void> => {
    if (
      !isNonEmptyString(entry.userId, MAX_USER_ID_LENGTH) ||
      !isNonEmptyString(entry.method, MAX_METHOD_LENGTH)
    ) {
      console.warn(
        "[rememberedAccounts] Not recording an account without a valid userId and method"
      );
      return Promise.resolve();
    }
    return enqueue((accounts) => {
      const existing = accounts.find((account) => account.userId === entry.userId);
      const next = sanitizeAccount(
        {
          email: entry.email ?? existing?.email,
          image: entry.image ?? existing?.image,
          lastUsedAt: normalizeTimestamp(entry.lastUsedAt) ?? DateTime.utc().toISO(),
          method: entry.method,
          name: entry.name ?? existing?.name,
          userId: entry.userId,
        },
        rememberIdentity
      ) as RememberedAccount;
      return [next, ...accounts.filter((account) => account.userId !== entry.userId)];
    });
  };

  return {
    clear: (): Promise<void> => enqueue(() => []),
    dispose: (): void => {
      if (typeof eventTarget?.removeEventListener === "function") {
        eventTarget.removeEventListener("storage", onStorage);
      }
    },
    forget: (userId: string): Promise<void> =>
      enqueue((accounts) => accounts.filter((account) => account.userId !== userId)),
    getSnapshot: (): RememberedAccountsSnapshot => snapshot,
    isHydrated: (): boolean => snapshot.isHydrated,
    lastUsedMethod: (): string | undefined => snapshot.lastUsedMethod,
    list: (): RememberedAccount[] => snapshot.accounts,
    ready,
    record,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
};

/** Maps remembered accounts to `@terreno/ui` LoginScreen `rememberedAccounts`, keyed by userId. */
export const toLoginAccountOptions = (accounts: RememberedAccount[]): LoginAccountOption[] => {
  return accounts.map(({userId, method, name, email, image}) => {
    const option: LoginAccountOption = {id: userId, method};
    if (name) {
      option.name = name;
    }
    if (email) {
      option.email = email;
    }
    if (image) {
      option.image = image;
    }
    return option;
  });
};

/** Subscribes a component to a remembered-accounts store. */
export const useRememberedAccounts = (
  store: RememberedAccountsStore
): UseRememberedAccountsResult => {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const forget = useCallback((userId: string): Promise<void> => store.forget(userId), [store]);
  const clear = useCallback((): Promise<void> => store.clear(), [store]);
  return useMemo(
    (): UseRememberedAccountsResult => ({
      accounts: snapshot.accounts,
      clear,
      forget,
      isHydrated: snapshot.isHydrated,
      lastUsedMethod: snapshot.lastUsedMethod,
    }),
    [snapshot, clear, forget]
  );
};
