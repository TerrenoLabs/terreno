import {describe, it} from "bun:test";
import {assert} from "chai";

import {renderWithTheme} from "../../ui/src/test-utils";
import {DemoPreviewContext} from "../previewContext";
import {defaultPreviewState} from "../previewState";
import {ConsentFormScreenDemo} from "./ConsentFormScreen.stories";

describe("ConsentFormScreen preview locale", () => {
  it("uses the toolbar locale when the preview provider sets en-US", () => {
    const {getByTestId} = renderWithTheme(
      <DemoPreviewContext.Provider value={{...defaultPreviewState(), locale: "en-US"}}>
        <ConsentFormScreenDemo />
      </DemoPreviewContext.Provider>
    );
    assert.equal(getByTestId("consent-preview-locale").props.children, "en-US");
  });
});
