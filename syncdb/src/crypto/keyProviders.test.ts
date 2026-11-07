import "fake-indexeddb/auto";

import {describe, expect, it, mock} from "bun:test";

import {idbGet} from "../storage/idb";
import {createAesGcmCodec, PayloadIntegrityError} from "./aesGcmCodec";
import {
  createKeyProviderCodec,
  createLocalKeyProvider,
  createServerKeyProvider,
} from "./keyProviders";
import type {KeyProvider} from "./types";

let dbCounter = 0;
const uniqueDbName = (): string => `key-cache-test-${Date.now()}-${dbCounter++}`;

const randomMaterialBase64 = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

const roundTripAcrossKeys = async ({
  decryptKey,
  encryptKey,
}: {
  decryptKey: CryptoKey;
  encryptKey: CryptoKey;
}): Promise<string> => {
  const payload = await createAesGcmCodec({key: encryptKey}).encode("cross-key payload");
  return createAesGcmCodec({key: decryptKey}).decode(payload);
};

describe("createServerKeyProvider", () => {
  it("derives a non-extractable AES-GCM key", async () => {
    const provider = createServerKeyProvider({
      appName: "demo",
      cacheDbName: uniqueDbName(),
      fetchKeyMaterial: async () => randomMaterialBase64(),
    });
    const key = await provider.getKey({userId: "u1"});
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe("AES-GCM");
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
  });

  it("derives deterministically: same material + salt yields interoperable keys", async () => {
    const material = randomMaterialBase64();
    const providerA = createServerKeyProvider({
      appName: "demo",
      cacheDbName: uniqueDbName(),
      fetchKeyMaterial: async () => material,
    });
    const providerB = createServerKeyProvider({
      appName: "demo",
      cacheDbName: uniqueDbName(),
      fetchKeyMaterial: async () => material,
    });
    const decrypted = await roundTripAcrossKeys({
      decryptKey: await providerB.getKey({userId: "u1"}),
      encryptKey: await providerA.getKey({userId: "u1"}),
    });
    expect(decrypted).toBe("cross-key payload");
  });

  it("derives distinct keys per userId (salt isolation)", async () => {
    const material = randomMaterialBase64();
    const provider = createServerKeyProvider({
      appName: "demo",
      cacheDbName: uniqueDbName(),
      fetchKeyMaterial: async () => material,
    });
    expect(
      roundTripAcrossKeys({
        decryptKey: await provider.getKey({userId: "u2"}),
        encryptKey: await provider.getKey({userId: "u1"}),
      })
    ).rejects.toBeInstanceOf(PayloadIntegrityError);
  });

  it("derives distinct keys per appName (salt isolation)", async () => {
    const material = randomMaterialBase64();
    const providerA = createServerKeyProvider({
      appName: "app-a",
      cacheDbName: uniqueDbName(),
      fetchKeyMaterial: async () => material,
    });
    const providerB = createServerKeyProvider({
      appName: "app-b",
      cacheDbName: uniqueDbName(),
      fetchKeyMaterial: async () => material,
    });
    expect(
      roundTripAcrossKeys({
        decryptKey: await providerB.getKey({userId: "u1"}),
        encryptKey: await providerA.getKey({userId: "u1"}),
      })
    ).rejects.toBeInstanceOf(PayloadIntegrityError);
  });

  it("skips the fetch on a cache hit (repeat and concurrent calls)", async () => {
    const fetchKeyMaterial = mock(async () => randomMaterialBase64());
    const provider = createServerKeyProvider({
      appName: "demo",
      cacheDbName: uniqueDbName(),
      fetchKeyMaterial,
    });
    const [k1, k2] = await Promise.all([
      provider.getKey({userId: "u1"}),
      provider.getKey({userId: "u1"}),
    ]);
    expect(k1).toBe(k2);
    await provider.getKey({userId: "u1"});
    expect(fetchKeyMaterial).toHaveBeenCalledTimes(1);
  });

  it("cold-starts offline from the IndexedDB cache without any network", async () => {
    const cacheDbName = uniqueDbName();
    const material = randomMaterialBase64();
    const onlineProvider = createServerKeyProvider({
      appName: "demo",
      cacheDbName,
      fetchKeyMaterial: async () => material,
    });
    const onlineKey = await onlineProvider.getKey({userId: "u1"});

    const offlineProvider = createServerKeyProvider({
      appName: "demo",
      cacheDbName,
      fetchKeyMaterial: async () => {
        throw new Error("network unavailable");
      },
    });
    const offlineKey = await offlineProvider.getKey({userId: "u1"});
    const decrypted = await roundTripAcrossKeys({decryptKey: offlineKey, encryptKey: onlineKey});
    expect(decrypted).toBe("cross-key payload");
  });

  it("rejects key material that is not exactly 32 bytes", async () => {
    const provider = createServerKeyProvider({
      appName: "demo",
      cacheDbName: uniqueDbName(),
      fetchKeyMaterial: async () =>
        Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64"),
    });
    await expect(provider.getKey({userId: "u1"})).rejects.toThrow("32 bytes");
  });

  it("does not poison future attempts after a failed fetch", async () => {
    const material = randomMaterialBase64();
    let shouldFail = true;
    const provider = createServerKeyProvider({
      appName: "demo",
      cacheDbName: uniqueDbName(),
      fetchKeyMaterial: async () => {
        if (shouldFail) {
          throw new Error("network unavailable");
        }
        return material;
      },
    });
    await expect(provider.getKey({userId: "u1"})).rejects.toThrow("network unavailable");
    shouldFail = false;
    const key = await provider.getKey({userId: "u1"});
    expect(key.type).toBe("secret");
  });
});

describe("createLocalKeyProvider", () => {
  it("generates a non-extractable AES-GCM key on first use", async () => {
    const provider = createLocalKeyProvider({cacheDbName: uniqueDbName()});
    const key = await provider.getKey({userId: "u1"});
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe("AES-GCM");
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
  });

  it("persists the key across fresh provider instances (same IndexedDB)", async () => {
    const cacheDbName = uniqueDbName();
    const first = await createLocalKeyProvider({cacheDbName}).getKey({userId: "u1"});
    const second = await createLocalKeyProvider({cacheDbName}).getKey({userId: "u1"});
    const decrypted = await roundTripAcrossKeys({decryptKey: second, encryptKey: first});
    expect(decrypted).toBe("cross-key payload");
  });

  it("shares one key across concurrent first calls (no split-brain keys)", async () => {
    const provider = createLocalKeyProvider({cacheDbName: uniqueDbName()});
    const [k1, k2] = await Promise.all([
      provider.getKey({userId: "u1"}),
      provider.getKey({userId: "u1"}),
    ]);
    expect(k1).toBe(k2);
  });

  it("scopes keys per userId", async () => {
    const provider = createLocalKeyProvider({cacheDbName: uniqueDbName()});
    expect(
      roundTripAcrossKeys({
        decryptKey: await provider.getKey({userId: "u2"}),
        encryptKey: await provider.getKey({userId: "u1"}),
      })
    ).rejects.toBeInstanceOf(PayloadIntegrityError);
  });

  it("caches the CryptoKey itself in IndexedDB", async () => {
    const cacheDbName = uniqueDbName();
    await createLocalKeyProvider({cacheDbName}).getKey({userId: "u1"});
    const stored = await idbGet<CryptoKey>({databaseName: cacheDbName, key: "local:u1"});
    expect(stored).toBeInstanceOf(CryptoKey);
  });
});

describe("createKeyProviderCodec", () => {
  it("round-trips using a lazily resolved key", async () => {
    const provider = createLocalKeyProvider({cacheDbName: uniqueDbName()});
    const codec = createKeyProviderCodec({keyProvider: provider, userId: "u1"});
    const payload = await codec.encode("lazy key payload");
    expect(await codec.decode(payload)).toBe("lazy key payload");
  });

  it("resolves the key from the provider exactly once", async () => {
    const inner = createLocalKeyProvider({cacheDbName: uniqueDbName()});
    const getKey = mock(({userId}: {userId: string}) => inner.getKey({userId}));
    const spyProvider: KeyProvider = {getKey};
    const codec = createKeyProviderCodec({keyProvider: spyProvider, userId: "u1"});
    await codec.decode(await codec.encode("a"));
    await codec.encode("b");
    expect(getKey).toHaveBeenCalledTimes(1);
    expect(getKey).toHaveBeenCalledWith({userId: "u1"});
  });

  it("prepare() resolves the key so later encodes need no provider call", async () => {
    const inner = createLocalKeyProvider({cacheDbName: uniqueDbName()});
    const getKey = mock(({userId}: {userId: string}) => inner.getKey({userId}));
    const codec = createKeyProviderCodec({keyProvider: {getKey}, userId: "u1"});
    await codec.prepare?.();
    expect(getKey).toHaveBeenCalledTimes(1);
    await codec.decode(await codec.encode("prepared"));
    expect(getKey).toHaveBeenCalledTimes(1);
  });

  it("retries key resolution after a failure instead of failing every later call", async () => {
    const inner = createLocalKeyProvider({cacheDbName: uniqueDbName()});
    let isOnline = false;
    const getKey = mock(({userId}: {userId: string}) =>
      isOnline ? inner.getKey({userId}) : Promise.reject(new Error("offline"))
    );
    const codec = createKeyProviderCodec({keyProvider: {getKey}, userId: "u1"});
    await expect(codec.prepare?.()).rejects.toThrow("offline");
    isOnline = true;
    expect(await codec.decode(await codec.encode("after retry"))).toBe("after retry");
    expect(getKey).toHaveBeenCalledTimes(2);
  });
});
