import {describe, it} from "bun:test";
import {assert} from "chai";

import {defaultPreviewState, previewParamsFromState, previewQueryFromState, previewStateFromQuery} from "./previewState";

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

  it("clears merged query keys when the toolbar returns to defaults", () => {
    const dark = previewParamsFromState({...defaultPreviewState(), theme: "dark", viewport: "375"});
    const reset = previewParamsFromState(defaultPreviewState());
    const merged = {...dark, ...reset};
    assert.equal(merged.theme, "");
    assert.equal(merged.viewport, "");
    assert.deepEqual(previewStateFromQuery(merged), defaultPreviewState());
    assert.equal(previewQueryFromState(defaultPreviewState()), "");
  });

  it("keeps follow-system as a shareable theme choice", () => {
    const state = previewStateFromQuery({theme: "system"});
    assert.equal(state.theme, "system");
    assert.equal(previewQueryFromState(state), "theme=system");
    assert.equal(previewParamsFromState(state).theme, "system");
  });

  it("ignores unknown viewport and theme values", () => {
    const state = previewStateFromQuery({theme: "neon", viewport: "999"});
    assert.equal(state.theme, "light");
    assert.equal(state.viewport, "full");
  });
});
