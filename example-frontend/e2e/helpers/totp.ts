/**
 * Computes the codes an authenticator app shows for a Better Auth TOTP enrollment, so specs can
 * pass a two-factor challenge.
 */
import {createHmac} from "node:crypto";
import {DateTime} from "luxon";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32Decode = (value: string): Buffer => {
  let bits = "";
  for (const char of value.replace(/=+$/, "").toUpperCase()) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
};

/** The secret in a `otpauth://totp/...?secret=...` URI, as `/two-factor/enable` returns it. */
export const totpSecretFromURI = (totpURI: string): Buffer =>
  base32Decode(new URL(totpURI).searchParams.get("secret") ?? "");

/** The current RFC 6238 code (SHA-1, 6 digits, 30-second steps). */
export const totpCode = (secret: Buffer): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(DateTime.now().toSeconds() / 30)));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
};
