/**
 * Encryption primitives for at-rest protection of persisted data. Encryption is
 * applied at the persistence boundary (the serialized store blob), keeping the
 * in-memory store plaintext for querying while only ciphertext lands in
 * IndexedDB/SQLite.
 */

/** Symmetric codec applied to the serialized store blob before persistence. */
export interface PayloadCodec {
  /** Encrypt/encode a plaintext string into a binary payload for storage. */
  encode(plaintext: string): Promise<Uint8Array>;
  /** Decrypt/decode a previously encoded binary payload. */
  decode(payload: Uint8Array): Promise<string>;
  /**
   * Resolve whatever `encode`/`decode` need (e.g. a key fetched from the server)
   * ahead of the first save, so a later flush never needs the network.
   */
  prepare?(): Promise<void>;
}

/**
 * Resolves the per-user symmetric encryption key. Implementations must return
 * non-extractable AES-GCM keys so raw key bytes never sit in page-inspectable
 * memory or storage.
 */
export interface KeyProvider {
  getKey({userId}: {userId: string}): Promise<CryptoKey>;
}
