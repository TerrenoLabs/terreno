import {describe, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";

import {renderWithTheme} from "../../ui/src/test-utils";
import {RelatedComponents} from "./RelatedComponents";
import {UsageSnippet} from "./UsageSnippet";

const EXAMPLE = `import {Button} from "@terreno/ui";

<Button onClick={() => {}} text="Save" />`;

describe("UsageSnippet", () => {
  it("shows the example and copies it", async () => {
    const {getAllByText, getByTestId, getByText} = renderWithTheme(
      <UsageSnippet example={EXAMPLE} />
    );
    assert.isAtLeast(getAllByText(/text="Save"/).length, 1);
    await act(async () => {
      fireEvent.press(getByTestId("usage-copy"));
    });
    assert.equal(getByText("Copied").props.children, "Copied");
  });
});

describe("RelatedComponents", () => {
  it("points each related name at its demo route", () => {
    const {getByTestId} = renderWithTheme(
      <RelatedComponents names={["Card", "Table icon button"]} />
    );
    assert.equal(getByTestId("related-Card").props.accessibilityHint, "/demo/Card");
    assert.equal(
      getByTestId("related-Table icon button").props.accessibilityHint,
      "/demo/Table%20icon%20button"
    );
  });
});
