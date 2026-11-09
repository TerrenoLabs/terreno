import {describe, it} from "bun:test";
import {assert} from "chai";

import {getSnapshotAction} from "./compareRenderedSnapshots.ts";

describe("compareRenderedSnapshots", (): void => {
  it("fails closed when a golden is missing", (): void => {
    assert.equal(getSnapshotAction({exists: false, update: false}), "missing");
  });

  it("writes goldens only in update mode", (): void => {
    assert.equal(getSnapshotAction({exists: false, update: true}), "write");
    assert.equal(getSnapshotAction({exists: true, update: true}), "write");
  });

  it("compares an existing golden outside update mode", (): void => {
    assert.equal(getSnapshotAction({exists: true, update: false}), "compare");
  });
});
