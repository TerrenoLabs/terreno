import {beforeEach, describe, expect, it} from "bun:test";
import {createRequire} from "node:module";

import {registerSendGridMock} from "./sendgrid";

const sendGrid = registerSendGridMock();

interface MailModule {
  send: (
    data: unknown
  ) => Promise<[{headers: Record<string, string>; statusCode: number}, unknown]>;
  setApiKey: (key: string) => void;
}

// Not a dependency of this package: the specifier is a variable so tsc does not resolve it,
// and the registered mock serves the import.
const SENDGRID_MODULE: string = "@sendgrid/mail";

describe("registerSendGridMock", () => {
  beforeEach((): void => {
    sendGrid.reset();
  });

  it("serves the ESM default export and the CommonJS module", async (): Promise<void> => {
    const esm = (await import(SENDGRID_MODULE)) as {default: MailModule};
    const cjs = createRequire(__filename)("@sendgrid/mail") as MailModule;

    esm.default.setApiKey("SG.key");
    const [first] = await esm.default.send({subject: "one", to: "a@example.com"});
    const [second] = await cjs.send([{subject: "two"}, {subject: "three"}]);

    expect(sendGrid.setApiKey).toHaveBeenCalledWith("SG.key");
    expect(first.statusCode).toBe(202);
    expect(first.headers["x-message-id"]).toBe("mock-sendgrid-1");
    expect(second.headers["x-message-id"]).toBe("mock-sendgrid-2");
    expect(sendGrid.getSentMessages()).toEqual([
      {subject: "one", to: "a@example.com"},
      {subject: "two"},
      {subject: "three"},
    ]);
  });

  it("reset clears messages, overrides, and the id counter", async (): Promise<void> => {
    const cjs = createRequire(__filename)("@sendgrid/mail") as MailModule;
    sendGrid.send.mockRejectedValueOnce(Object.assign(new Error("Bad Request"), {code: 400}));
    await expect(cjs.send({subject: "x"})).rejects.toThrow("Bad Request");

    sendGrid.reset();

    expect(sendGrid.getSentMessages()).toEqual([]);
    const [response] = await cjs.send({subject: "y"});
    expect(response.headers["x-message-id"]).toBe("mock-sendgrid-1");
  });
});
