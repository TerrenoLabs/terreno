import {describe, it} from "bun:test";
import {assert} from "chai";
import {todoBrowserDetailGate} from "./todoBrowserDetailGate";

describe("todoBrowserDetailGate", () => {
  it("shows a stored todo even while sync is still starting", () => {
    assert.equal(
      todoBrowserDetailGate({hasTodo: true, isSyncDbReady: false, isSyncing: true}),
      "ready"
    );
  });

  it("waits instead of calling a deep-linked todo missing before sync is ready", () => {
    assert.equal(
      todoBrowserDetailGate({hasTodo: false, isSyncDbReady: false, isSyncing: false}),
      "loading"
    );
  });

  it("waits while a sync is still filling the local store", () => {
    assert.equal(
      todoBrowserDetailGate({hasTodo: false, isSyncDbReady: true, isSyncing: true}),
      "loading"
    );
  });

  it("calls the todo missing only after sync is idle and the row is absent", () => {
    assert.equal(
      todoBrowserDetailGate({hasTodo: false, isSyncDbReady: true, isSyncing: false}),
      "missing"
    );
  });
});
