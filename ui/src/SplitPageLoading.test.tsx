import {describe, expect, it} from "bun:test";
import {View} from "react-native";

import {SkeletonList} from "./Skeleton";
import {SplitPageLoading} from "./SplitPageLoading";
import {renderWithTheme} from "./test-utils";

// Skeletons are hidden from assistive tech, so queries opt in to hidden elements.
const HIDDEN = {includeHiddenElements: true};

describe("SplitPageLoading", () => {
  it("renders only the content when not loading", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <SplitPageLoading loading={false} spinner={<View testID="spinner" />}>
        <View testID="content" />
      </SplitPageLoading>
    );
    expect(getByTestId("content")).toBeTruthy();
    expect(queryByTestId("split-page-loading")).toBeNull();
    expect(queryByTestId("spinner")).toBeNull();
  });

  it("shows a busy, labeled spinner beside the content without a loadingComponent", () => {
    const {getByTestId} = renderWithTheme(
      <SplitPageLoading loading loadingLabel="Loading inbox" spinner={<View testID="spinner" />}>
        <View testID="content" />
      </SplitPageLoading>
    );
    const region = getByTestId("split-page-loading");
    expect(region.props["aria-busy"]).toBe(true);
    expect(region.props.accessibilityLabel).toBe("Loading inbox");
    expect(getByTestId("spinner")).toBeTruthy();
    expect(getByTestId("content")).toBeTruthy();
  });

  it("replaces the content with the loadingComponent", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <SplitPageLoading
        loading
        loadingComponent={<SkeletonList testID="skeleton" />}
        spinner={<View testID="spinner" />}
      >
        <View testID="content" />
      </SplitPageLoading>
    );
    expect(getByTestId("split-page-loading").props["aria-busy"]).toBe(true);
    expect(getByTestId("skeleton", HIDDEN)).toBeTruthy();
    expect(queryByTestId("content")).toBeNull();
    expect(queryByTestId("spinner")).toBeNull();
  });
});
