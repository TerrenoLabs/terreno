import {describe, it} from "bun:test";
import {assert} from "chai";

import {resolveStoredColorScheme} from "./storedColorScheme";

describe("resolveStoredColorScheme", () => {
  it("keeps a stored dark choice and treats every other stored value as light", () => {
    assert.equal(resolveStoredColorScheme("dark"), "dark");
    assert.equal(resolveStoredColorScheme("light"), "light");
    assert.equal(resolveStoredColorScheme("system"), "light");
    assert.equal(resolveStoredColorScheme(undefined), "light");
  });
});
