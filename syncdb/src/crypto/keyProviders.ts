import {idbGet, idbSet} from "../storage/idb";
import {createAesGcmCodec, getSubtleCrypto} from "./aesGcmCodec";
import type {KeyProvider, PayloadCodec} from "./types";

/** Default IndexedDB database used to cache derived/generated CryptoKeys. */
export const DEFAULT_KEY_CACHE_DB_NAME = "terreno-syncdb-keys";

const SERVER_KEY_MATERIAL_BYTES = 32;

const fromBase64 = (value: string): Uint8Array => {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

// See aesGcmCodec.ts: bridges Uint8Array<ArrayBufferLike> to BufferSource.
const asBufferSource = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

/**
 * Wrap key resolution + caching so concurrent `getKey` calls for the same user
 * share one in-flight promise (two racing calls must never persist two
 * different keys — the loser's key would silently fail to decrypt later).
 */
const createCachedKeyResolver = ({
  cacheDbName,
  deriveKey,
  scope,
}: {
  cacheDbName: string;
  deriveKey: ({userId}: {userId: string}) => Promise<CryptoKey>;
  scope: string;
}): KeyProvider => {
  const inFlight = new Map<string, Promise<CryptoKey>>();

  const resolveKey = async ({userId}: {userId: string}): Promise<CryptoKey> => {
    const cacheKey = `${scope}:${userId}`;
    const cached = await idbGet<CryptoKey>({databaseName: cacheDbName, key: cacheKey});
    if (cached) {
      return cached;
    }
    const key = await deriveKey({userId});
    await idbSet({databaseName: cacheDbName, key: cacheKey, value: key});
    return key;
  };

  const getKey = ({userId}: {userId: string}): Promise<CryptoKey> => {
    const existing = inFlight.get(userId);
    if (existing !== undefined) {
      return existing;
    }
    const promise = resolveKey({userId}).catch((error) => {
      // Failed resolutions must not poison future attempts (e.g. offline fetch).
      inFlight.delete(userId);
      throw error;
    });
    inFlight.set(userId, promise);
    return promise;
  };

  return {getKey};
};

/**
 * Default web key provider: fetches per-user key material from the server
 * (`GET /sync/key`, wired by the caller), HKDF-SHA256-derives a non-extractable
 * AES-256-GCM key with salt `${appName}:${userId}`, and caches the derived
 * CryptoKey in IndexedDB so an offline cold start needs no network. A cache hit
 * skips `fetchKeyMaterial` entirely.
 */
export const createServerKeyProvider = ({
  appName,
  fetchKeyMaterial,
  cacheDbName = DEFAULT_KEY_CACHE_DB_NAME,
}: {
  appName: string;
  /** Returns the server key material: base64 of exactly 32 random bytes. */
  fetchKeyMaterial: () => Promise<string>;
  cacheDbName?: string;
}): KeyProvider => {
  const deriveKey = async ({userId}: {userId: string}): Promise<CryptoKey> => {
    const subtle = getSubtleCrypto();
    const material = fromBase64(await fetchKeyMaterial());
    if (material.length !== SERVER_KEY_MATERIAL_BYTES) {
      throw new Error(
        `Server key material must be ${SERVER_KEY_MATERIAL_BYTES} bytes, got ${material.length}`
      );
    }
    const baseKey = await subtle.importKey("raw", asBufferSource(material), "HKDF", false, [
      "deriveKey",
    ]);
    return subtle.deriveKey(
      {
        hash: "SHA-256",
        info: new Uint8Array(0),
        name: "HKDF",
        salt: asBufferSource(new TextEncoder().encode(`${appName}:${userId}`)),
      },
      baseKey,
      {length: 256, name: "AES-GCM"},
      false,
      ["encrypt", "decrypt"]
    );
  };

  return createCachedKeyResolver({cacheDbName, deriveKey, scope: `server:${appName}`});
};

/**
 * Device-local key provider: generates a random non-extractable AES-256-GCM key
 * on first use and persists it in IndexedDB for reuse across sessions. Data
 * encrypted with it is only readable on this device (no server escrow).
 */
export const createLocalKeyProvider = ({
  cacheDbName = DEFAULT_KEY_CACHE_DB_NAME,
}: {
  cacheDbName?: string;
} = {}): KeyProvider => {
  const deriveKey = async (): Promise<CryptoKey> =>
    getSubtleCrypto().generateKey({length: 256, name: "AES-GCM"}, false, ["encrypt", "decrypt"]);

  return createCachedKeyResolver({cacheDbName, deriveKey, scope: "local"});
};

/**
 * AES-GCM codec whose key is resolved lazily from a {@link KeyProvider} on
 * first use. Lets persister factories stay synchronous while key
 * fetch/derivation happens on the first load/save.
 */
export const createKeyProviderCodec = ({
  keyProvider,
  userId,
}: {
  keyProvider: KeyProvider;
  userId: string;
}): PayloadCodec => {
  let codecPromise: Promise<PayloadCodec> | undefined;
  const resolveCodec = (): Promise<PayloadCodec> => {
    codecPromise ??= keyProvider.getKey({userId}).then((key) => createAesGcmCodec({key}));
    return codecPromise;
  };

  return {
    decode: async (payload: Uint8Array): Promise<string> => (await resolveCodec()).decode(payload),
    encode: async (plaintext: string): Promise<Uint8Array> =>
      (await resolveCodec()).encode(plaintext),
  };
};
