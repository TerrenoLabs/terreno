import {beforeEach, describe, expect, it} from "bun:test";
import {createRequire} from "node:module";

import {registerTwilioMock, type TwilioMockClient} from "./twilio";

const twilio = registerTwilioMock();

type TwilioFactory = ((sid: string, token: string) => TwilioMockClient) & {
  Twilio: new (sid: string, token: string) => TwilioMockClient;
};

describe("registerTwilioMock", () => {
  beforeEach((): void => {
    twilio.reset();
  });

  it("works as a CommonJS factory, ESM default, and Twilio class", async (): Promise<void> => {
    const cjs = createRequire(__filename)("twilio") as TwilioFactory;
    const esm = (await import("twilio")) as unknown as {default: TwilioFactory};

    expect(cjs("AC1", "token")).toBe(twilio.client);
    expect(esm.default("AC2", "token")).toBe(twilio.client);
    expect(new cjs.Twilio("AC3", "token")).toBe(twilio.client);
    expect(twilio.twilio).toHaveBeenCalledWith("AC1", "token");
    expect(twilio.twilio).toHaveBeenCalledTimes(3);
  });

  it("sends SMS and runs a verify start/check", async (): Promise<void> => {
    const message = await twilio.client.messages.create({
      body: "hi",
      from: "+15550000000",
      to: "+15551111111",
    });
    expect(message.sid).toBe(`SMmock${"1".padStart(28, "0")}`);
    expect(message.status).toBe("queued");
    expect(twilio.messagesCreate).toHaveBeenCalledWith({
      body: "hi",
      from: "+15550000000",
      to: "+15551111111",
    });

    const service = twilio.client.verify.v2.services("VAservice");
    const started = await service.verifications.create({channel: "sms", to: "+15551111111"});
    const checked = await service.verificationChecks.create({code: "123456", to: "+15551111111"});

    expect(twilio.verifyServices).toHaveBeenCalledWith("VAservice");
    expect(started).toEqual({
      channel: "sms",
      sid: `VEmock${"2".padStart(28, "0")}`,
      status: "pending",
      to: "+15551111111",
    });
    expect(checked).toEqual({status: "approved", to: "+15551111111", valid: true});
  });

  it("reset restores defaults after an override", async (): Promise<void> => {
    twilio.verificationChecksCreate.mockResolvedValue({
      status: "pending",
      to: "+1",
      valid: false,
    });
    const service = twilio.client.verify.v2.services("VA");
    expect((await service.verificationChecks.create({code: "0", to: "+1"})).valid).toBe(false);

    twilio.reset();

    expect((await service.verificationChecks.create({code: "0", to: "+1"})).valid).toBe(true);
    expect(twilio.verificationChecksCreate).toHaveBeenCalledTimes(1);
  });
});
