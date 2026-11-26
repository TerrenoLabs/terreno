import {describe, expect, it} from "bun:test";

import type {TextFieldProps} from "../../src/Common";
import {TextField} from "../../src/TextField";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const handleChange = (): void => {};
const handleAdd = (): void => {};
const handleHide = (): void => {};
const handleShow = (): void => {};
const handleFeedback = (): void => {};
const aiSuggestion = {
  feedback: undefined,
  onAdd: handleAdd,
  onFeedback: handleFeedback,
  onHide: handleHide,
  onShow: handleShow,
  status: "ready" as const,
  text: "Suggested note text for the session.",
};
const baseline: TextFieldProps = {
  aiSuggestion,
  helperText: "Helper",
  iconName: "check",
  onChange: handleChange,
  testID: "field",
  title: "Notes",
  value: "hello",
};

describe("TextField renders", () => {
  it("keeps the AI suggestion box out of keystroke re-renders", async () => {
    const report = await auditComponent({
      baseline,
      Component: TextField,
      changes: {
        "error shown": {...baseline, errorText: "Required"},
        "new aiSuggestion object": {...baseline, aiSuggestion: {...aiSuggestion}},
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "one keystroke": {...baseline, value: "hello!"},
        "suggestion text changed": {
          ...baseline,
          aiSuggestion: {...aiSuggestion, text: "A regenerated suggestion."},
        },
      },
      name: "TextField",
    });
    expect(componentStat(report, "one keystroke", "TextField")?.updates).toBe(1);
    expect(componentStat(report, "one keystroke", "AiSuggestionBox")).toBeUndefined();
    expect(componentStat(report, "error shown", "AiSuggestionBox")).toBeUndefined();
    expect(componentStat(report, "new onChange identity", "AiSuggestionBox")).toBeUndefined();
    expect(componentStat(report, "new aiSuggestion object", "AiSuggestionBox")).toBeUndefined();
    expect(componentStat(report, "same props", "AiSuggestionBox")).toBeUndefined();
    expect(componentStat(report, "suggestion text changed", "AiSuggestionBox")?.updates).toBe(1);
  });
});
