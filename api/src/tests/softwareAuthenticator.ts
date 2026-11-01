/**
 * A software WebAuthn authenticator for API tests: one ES256 (P-256) credential that answers
 * registration with `none` attestation and signs authentication assertions, so passkey
 * ceremonies run end to end against the real `@better-auth/passkey` verification.
 */

import {createHash, generateKeyPairSync, type KeyObject, randomBytes, sign} from "node:crypto";

type CborValue = number | string | Buffer | CborValue[] | Map<CborValue, CborValue>;

const cborHead = (major: number, length: number): Buffer => {
  if (length < 24) {
    return Buffer.from([(major << 5) | length]);
  }
  if (length < 0x100) {
    return Buffer.from([(major << 5) | 24, length]);
  }
  if (length < 0x10000) {
    const head = Buffer.alloc(3);
    head[0] = (major << 5) | 25;
    head.writeUInt16BE(length, 1);
    return head;
  }
  const head = Buffer.alloc(5);
  head[0] = (major << 5) | 26;
  head.writeUInt32BE(length, 1);
  return head;
};

/** The subset of CBOR (RFC 8949) WebAuthn needs: ints, byte and text strings, arrays, maps. */
const encodeCbor = (value: CborValue): Buffer => {
  if (typeof value === "number") {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([cborHead(2, value.length), value]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([cborHead(4, value.length), ...value.map(encodeCbor)]);
  }
  const entries = Array.from(value.entries());
  return Buffer.concat([
    cborHead(5, entries.length),
    ...entries.flatMap(([key, entry]) => [encodeCbor(key), encodeCbor(entry)]),
  ]);
};

const sha256 = (value: string | Buffer): Buffer => createHash("sha256").update(value).digest();

const uint32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};

// Authenticator data flags: user present, user verified, attested credential data included.
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

/** A registration response, as `navigator.credentials.create` serialized by SimpleWebAuthn. */
interface SoftwareRegistrationResponse {
  authenticatorAttachment: "platform";
  clientExtensionResults: Record<string, never>;
  id: string;
  rawId: string;
  response: {attestationObject: string; clientDataJSON: string; transports: string[]};
  type: "public-key";
}

/** An authentication response, as `navigator.credentials.get` serialized by SimpleWebAuthn. */
interface SoftwareAuthenticationResponse {
  authenticatorAttachment: "platform";
  clientExtensionResults: Record<string, never>;
  id: string;
  rawId: string;
  response: {authenticatorData: string; clientDataJSON: string; signature: string};
  type: "public-key";
}

export interface SoftwareAuthenticator {
  /** Answers `/passkey/generate-authenticate-options` with a signed assertion. */
  authenticate: (options: {challenge: string}) => SoftwareAuthenticationResponse;
  /** Answers `/passkey/generate-register-options` with a new credential. */
  register: (options: {challenge: string}) => SoftwareRegistrationResponse;
}

/** Creates an authenticator holding one credential for `rpID`, used from `origin`. */
export const createSoftwareAuthenticator = ({
  origin,
  rpID,
}: {
  origin: string;
  rpID: string;
}): SoftwareAuthenticator => {
  const {privateKey, publicKey} = generateKeyPairSync("ec", {namedCurve: "P-256"});
  const credentialId = randomBytes(16);
  const id = credentialId.toString("base64url");
  const rpIdHash = sha256(rpID);
  let signCount = 0;

  const clientData = (type: string, challenge: string): Buffer =>
    Buffer.from(JSON.stringify({challenge, crossOrigin: false, origin, type}));

  const coseKey = (key: KeyObject): Buffer => {
    const jwk = key.export({format: "jwk"});
    // kty EC2, alg ES256, crv P-256, x, y.
    return encodeCbor(
      new Map<CborValue, CborValue>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x ?? "", "base64url")],
        [-3, Buffer.from(jwk.y ?? "", "base64url")],
      ])
    );
  };

  return {
    authenticate: ({challenge}): SoftwareAuthenticationResponse => {
      signCount += 1;
      const authenticatorData = Buffer.concat([
        rpIdHash,
        Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED]),
        uint32(signCount),
      ]);
      const clientDataJSON = clientData("webauthn.get", challenge);
      const signature = sign(
        "sha256",
        Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
        privateKey
      );
      return {
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        id,
        rawId: id,
        response: {
          authenticatorData: authenticatorData.toString("base64url"),
          clientDataJSON: clientDataJSON.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        type: "public-key",
      };
    },
    register: ({challenge}): SoftwareRegistrationResponse => {
      const credentialIdLength = Buffer.alloc(2);
      credentialIdLength.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_CREDENTIAL]),
        uint32(signCount),
        Buffer.alloc(16),
        credentialIdLength,
        credentialId,
        coseKey(publicKey),
      ]);
      const attestationObject = encodeCbor(
        new Map<CborValue, CborValue>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ])
      );
      return {
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        id,
        rawId: id,
        response: {
          attestationObject: attestationObject.toString("base64url"),
          clientDataJSON: clientData("webauthn.create", challenge).toString("base64url"),
          transports: ["internal"],
        },
        type: "public-key",
      };
    },
  };
};
