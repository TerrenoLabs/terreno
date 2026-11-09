import {describe, expect, it} from "bun:test";

import {getSocialProviderName} from "../SocialLoginButton";
import {getLoginMethodLabels, maskEmail} from "./loginMethods";

describe("getSocialProviderName", () => {
  it("names the branded providers", () => {
    expect(getSocialProviderName("github")).toBe("GitHub");
  });

  it("returns undefined for other ids, including Object.prototype keys", () => {
    expect(getSocialProviderName("mock-oidc")).toBeUndefined();
    expect(getSocialProviderName("__proto__")).toBeUndefined();
    expect(getSocialProviderName("constructor")).toBeUndefined();
  });
});

describe("getLoginMethodLabels", () => {
  it("names email, passkeys, branded and generic providers", () => {
    expect(getLoginMethodLabels({method: "email"})).toEqual({name: "email", phrase: "email"});
    expect(getLoginMethodLabels({method: "passkey"})).toEqual({
      name: "passkey",
      phrase: "a passkey",
    });
    expect(getLoginMethodLabels({method: "google"})).toEqual({name: "Google", phrase: "Google"});
    expect(
      getLoginMethodLabels({
        genericProviders: [
          {id: "mock-oidc", label: "Mock OIDC", onPress: async (): Promise<void> => {}},
        ],
        method: "mock-oidc",
      })
    ).toEqual({name: "Mock OIDC", phrase: "Mock OIDC"});
  });

  it("names a method that matches an Object.prototype key by its id", () => {
    expect(getLoginMethodLabels({method: "__proto__"})).toEqual({
      name: "__proto__",
      phrase: "__proto__",
    });
    expect(getLoginMethodLabels({method: "constructor"})).toEqual({
      name: "constructor",
      phrase: "constructor",
    });
  });
});

describe("maskEmail", () => {
  it("keeps the first character of the name and the host", () => {
    expect(maskEmail("josh@nang.io")).toBe("j***@n***.io");
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});
