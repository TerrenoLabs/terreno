import {describe, it} from "bun:test";
import {assert} from "chai";
import type {SyncEntity} from "../storage/types";
import {applyLocalQuery} from "./localQuery";

describe("applyLocalQuery", () => {
  it("rejects a where the local compiler cannot evaluate", (): void => {
    const entities: SyncEntity<{title: string}>[] = [
      {data: {title: "a"}, deleted: false, id: "1", seq: 0},
    ];

    assert.throws((): void => {
      applyLocalQuery(entities, {where: {$search: "a"}});
    }, /cannot evaluate locally/);
  });
});
