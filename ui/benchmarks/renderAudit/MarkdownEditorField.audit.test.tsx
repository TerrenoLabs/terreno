import {describe, expect, it} from "bun:test";

import {MarkdownEditorField} from "../../src/MarkdownEditorField";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const onChange = (): void => {};
const baseline = {onChange, title: "Notes", value: "# Hello\n\nSome **bold** text\n\n- a\n- b"};

describe("MarkdownEditorField renders", () => {
  it("does not re-render the toolbar buttons while typing", async () => {
    const report = await auditComponent({
      baseline,
      Component: MarkdownEditorField,
      changes: {
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "typed a character": {...baseline, value: `${baseline.value}c`},
      },
      name: "MarkdownEditorField",
    });

    expect(componentStat(report, "typed a character", "ToolbarButtonView")).toBeUndefined();
    expect(componentStat(report, "new onChange identity", "ToolbarButtonView")).toBeUndefined();
    expect(componentStat(report, "same props", "ToolbarButtonView")).toBeUndefined();
  });
});
