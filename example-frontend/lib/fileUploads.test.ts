import {describe, it} from "bun:test";
import {assert} from "chai";

import {fileUploadsEnabledFromFlags} from "./fileUploads";

describe("fileUploadsEnabledFromFlags", () => {
  it("stays enabled while flags are loading", () => {
    assert.isTrue(fileUploadsEnabledFromFlags({flags: {}, isLoading: true}));
  });

  it("stays enabled when the flag has not been created", () => {
    assert.isTrue(
      fileUploadsEnabledFromFlags({flags: {"dark-mode-toggle": true}, isLoading: false})
    );
  });

  it("hides uploads when the flag resolves to false", () => {
    assert.isFalse(fileUploadsEnabledFromFlags({flags: {"file-uploads": false}, isLoading: false}));
  });

  it("shows uploads when the flag resolves to true", () => {
    assert.isTrue(fileUploadsEnabledFromFlags({flags: {"file-uploads": true}, isLoading: false}));
  });
});
