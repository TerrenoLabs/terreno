import {describe, expect, it} from "bun:test";

import {flagBoolean, flagList, flagString, parseArgs} from "./parseArgs";

describe("parseArgs", () => {
  it("collects positionals and flags", () => {
    const parsed = parseArgs(["api", "call", "todo_list", "--schema", "./oa.json", "--json"]);
    expect(parsed.positionals).toEqual(["api", "call", "todo_list"]);
    expect(flagString(parsed.flags, "schema")).toBe("./oa.json");
    expect(flagBoolean(parsed.flags, "json")).toBe(true);
  });

  it("supports equals, short flags, and repeated values", () => {
    const parsed = parseArgs(["--param=id=1", "--param", "limit=10", "-h", "--", "kept"]);
    expect(flagList(parsed.flags, "param")).toEqual(["id=1", "limit=10"]);
    expect(flagBoolean(parsed.flags, "h")).toBe(true);
    expect(parsed.positionals).toEqual(["kept"]);
  });

  it("treats missing values as booleans", () => {
    const parsed = parseArgs(["--json", "--owner"]);
    expect(flagBoolean(parsed.flags, "json")).toBe(true);
    expect(flagString(parsed.flags, "missing")).toBeUndefined();
    expect(flagList(parsed.flags, "field")).toEqual([]);
  });

  it("appends repeated flags and short options with values", () => {
    const parsed = parseArgs(["-o", "out.ts", "--field", "a", "--field", "b", "--field", "c"]);
    expect(flagString(parsed.flags, "o")).toBe("out.ts");
    expect(flagList(parsed.flags, "field")).toEqual(["a", "b", "c"]);
  });
});
