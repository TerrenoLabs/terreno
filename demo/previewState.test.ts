import {describe, it} from "bun:test";
import {assert} from "chai";

import {previewQueryFromState, previewStateFromQuery} from "./previewState";

describe("preview state", () => {
  it("reads the Button dark 375 query and writes it back", () => {
    const state = previewStateFromQuery({
      background: "inverse",
      locale: "en-US",
      reducedMotion: "1",
      rtl: "1",
      theme: "dark",
      viewport: "375",
    });
    assert.equal(state.theme, "dark");
    assert.equal(state.viewport, "375");
    assert.equal(state.background, "inverse");
    assert.equal(state.locale, "en-US");
    assert.strictEqual(state.rtl, true);
    assert.strictEqual(state.reducedMotion, true);
    const roundTrip = previewStateFromQuery(
      Object.fromEntries(new URLSearchParams(previewQueryFromState(state)))
    );
    assert.deepEqual(roundTrip, state);
  });

  it("ignores unknown viewport and theme values", () => {
    const state = previewStateFromQuery({theme: "neon", viewport: "999"});
    assert.equal(state.theme, "light");
    assert.equal(state.viewport, "full");
  });
});
