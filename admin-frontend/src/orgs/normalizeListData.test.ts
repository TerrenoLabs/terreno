import {describe, expect, it} from "bun:test";
import {normalizeListData} from "./normalizeListData";

describe("normalizeListData", () => {
  it("returns a bare array from the already-unwrapped shape", () => {
    expect(normalizeListData([{_id: "org-1"}])).toEqual([{_id: "org-1"}]);
  });

  it("returns data from the JSON API envelope shape", () => {
    expect(normalizeListData({data: [{_id: "org-1"}]})).toEqual([{_id: "org-1"}]);
  });

  it("returns an empty array when data is missing", () => {
    expect(normalizeListData(undefined)).toEqual([]);
    expect(normalizeListData({})).toEqual([]);
  });
});
