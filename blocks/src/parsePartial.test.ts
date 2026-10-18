import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {parseBlocksPartial} from "./parsePartial";

const partialDir = join(import.meta.dir, "fixtures", "partial");

describe("parseBlocksPartial", () => {
  it("returns every block of a finished document and pending false", () => {
    const text = "v: 1\nblocks:\n  - type: divider\n  - type: heading\n    text: Done\n";
    expect(parseBlocksPartial(text)).toEqual({
      blocks: [{type: "divider"}, {text: "Done", type: "heading"}],
      datasets: undefined,
      pending: false,
    });
  });

  it("keeps completed top-level blocks and drops a cut tail", () => {
    const text = readFileSync(join(partialDir, "cut-after-divider.yaml"), "utf8");
    const result = parseBlocksPartial(text);
    expect(result.pending).toBe(true);
    expect(result.blocks).toEqual([{type: "divider"}]);
  });

  it("returns datasets only after the datasets section has closed", () => {
    const open = parseBlocksPartial("v: 1\ndatasets:\n  signups:\n    source: ref\n    id: ds_1\n");
    expect(open).toEqual({blocks: [], pending: true});

    const closed = parseBlocksPartial(
      [
        "v: 1",
        "datasets:",
        "  signups:",
        "    source: ref",
        "    id: ds_1",
        "blocks:",
        "  - type: divider",
        "  - type: text",
        '    markdown: "still',
        "",
      ].join("\n")
    );
    expect(closed.pending).toBe(true);
    expect(closed.blocks).toEqual([{type: "divider"}]);
    expect(closed.datasets).toEqual({signups: {id: "ds_1", source: "ref"}});
  });

  it("never throws on garbage", () => {
    expect(parseBlocksPartial("::: not yaml")).toEqual({blocks: [], pending: true});
    expect(parseBlocksPartial("")).toEqual({blocks: [], pending: true});
  });
});
