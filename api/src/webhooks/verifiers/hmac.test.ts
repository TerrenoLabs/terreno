import {describe, it} from "bun:test";
import crypto from "node:crypto";
import {assert} from "chai";
import type {Request} from "express";
import {DateTime} from "luxon";

import {hmacSignature} from "./hmac";

const SECRET = "whsec_test";
const BODY = Buffer.from(`{"id":"evt_1"}`);
const VALID_HEX = "030fa3b2413d1993c551364bd53bb9b3edb5c0c34d55dba6ada6041245632811";

const hmacHex = (payload: Buffer | string): string => {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
};

const fakeReq = ({
  signature,
  timestamp,
  rawBody = BODY,
}: {
  rawBody?: Buffer;
  signature?: string;
  timestamp?: string;
}): Request => {
  const headers: Record<string, string> = {};
  if (signature !== undefined) {
    headers["x-webhook-signature"] = signature;
  }
  if (timestamp !== undefined) {
    headers["x-webhook-timestamp"] = timestamp;
  }
  return {headers, rawBody} as Request;
};

describe("hmacSignature", () => {
  it("accepts a matching hex HMAC of the raw body", () => {
    const verify = hmacSignature({header: "X-Webhook-Signature", secret: SECRET});
    assert.isTrue(verify(fakeReq({signature: VALID_HEX})));
  });

  it("rejects a shorter signature instead of throwing", () => {
    const verify = hmacSignature({header: "X-Webhook-Signature", secret: SECRET});
    assert.isFalse(verify(fakeReq({signature: VALID_HEX.slice(0, 8)})));
  });

  it("rejects a timestamp outside the tolerance window", () => {
    const verify = hmacSignature({
      header: "X-Webhook-Signature",
      secret: SECRET,
      timestampHeader: "X-Webhook-Timestamp",
      toleranceSec: 300,
    });
    const stale = String(DateTime.utc().toUnixInteger() - 301);
    const signature = hmacHex(`${stale}.{"id":"evt_1"}`);
    assert.isFalse(verify(fakeReq({signature, timestamp: stale})));
  });

  it("accepts HMAC of timestamp plus raw body inside the tolerance window", () => {
    const verify = hmacSignature({
      header: "X-Webhook-Signature",
      secret: SECRET,
      timestampHeader: "X-Webhook-Timestamp",
      toleranceSec: 300,
    });
    const now = String(DateTime.utc().toUnixInteger());
    const signature = hmacHex(`${now}.{"id":"evt_1"}`);
    assert.isTrue(verify(fakeReq({signature, timestamp: now})));
  });

  it("rejects a body-only HMAC when a timestamp header is required", () => {
    const verify = hmacSignature({
      header: "X-Webhook-Signature",
      secret: SECRET,
      timestampHeader: "X-Webhook-Timestamp",
      toleranceSec: 300,
    });
    const now = String(DateTime.utc().toUnixInteger());
    assert.isFalse(verify(fakeReq({signature: VALID_HEX, timestamp: now})));
  });

  it("rejects a missing raw body", () => {
    const verify = hmacSignature({header: "X-Webhook-Signature", secret: SECRET});
    const req = {headers: {"x-webhook-signature": VALID_HEX}} as unknown as Request;
    assert.isFalse(verify(req));
  });

  it("rejects a missing signature", () => {
    const verify = hmacSignature({header: "X-Webhook-Signature", secret: SECRET});
    assert.isFalse(verify(fakeReq({})));
  });

  it("rejects a missing timestamp when timestampHeader is set", () => {
    const verify = hmacSignature({
      header: "X-Webhook-Signature",
      secret: SECRET,
      timestampHeader: "X-Webhook-Timestamp",
    });
    assert.isFalse(verify(fakeReq({signature: VALID_HEX})));
  });

  it("rejects a non-numeric timestamp", () => {
    const verify = hmacSignature({
      header: "X-Webhook-Signature",
      secret: SECRET,
      timestampHeader: "X-Webhook-Timestamp",
    });
    assert.isFalse(verify(fakeReq({signature: VALID_HEX, timestamp: "not-a-number"})));
  });
});
