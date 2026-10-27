import {describe, expect, it} from "bun:test";
import type {FC} from "react";

import {SkeletonList} from "./Skeleton";
import {Text} from "./Text";
import {renderWithTheme} from "./test-utils";
import {withLoading} from "./withLoading";

// Skeletons are hidden from assistive tech, so queries opt in to hidden elements.
const HIDDEN = {includeHiddenElements: true};

interface UserRowProps {
  name: string;
  testID?: string;
}

const UserRow: FC<UserRowProps> = ({name, testID}) => <Text testID={testID}>{name}</Text>;

describe("withLoading", () => {
  it("renders the wrapped component when not loading", () => {
    const UserRowWithLoading = withLoading(UserRow);
    const {getByText} = renderWithTheme(<UserRowWithLoading name="Ada" />);
    expect(getByText("Ada")).toBeTruthy();
  });

  it("renders the default placeholder in a busy box while loading", () => {
    const UserRowWithLoading = withLoading(UserRow, {
      loadingComponent: <SkeletonList rows={1} testID="row-skeleton" />,
    });
    const {getByTestId, queryByText} = renderWithTheme(
      <UserRowWithLoading loading name="Ada" testID="user-row" />
    );
    expect(queryByText("Ada")).toBeNull();
    expect(getByTestId("row-skeleton", HIDDEN)).toBeTruthy();
    const container = getByTestId("user-row-loading", HIDDEN);
    expect(container.props["aria-busy"]).toBe(true);
    expect(container.props.accessibilityLabel).toBe("Loading");
  });

  it("lets the caller override the placeholder and label", () => {
    const UserRowWithLoading = withLoading(UserRow, {
      loadingComponent: <SkeletonList testID="default-skeleton" />,
    });
    const {getByTestId, queryByTestId} = renderWithTheme(
      <UserRowWithLoading
        loading
        loadingComponent={<SkeletonList rows={1} testID="custom-skeleton" />}
        loadingLabel="Loading user"
        name="Ada"
        testID="user-row"
      />
    );
    expect(getByTestId("custom-skeleton", HIDDEN)).toBeTruthy();
    expect(queryByTestId("default-skeleton", HIDDEN)).toBeNull();
    expect(getByTestId("user-row-loading", HIDDEN).props.accessibilityLabel).toBe("Loading user");
  });

  it("names the wrapper after the wrapped component", () => {
    expect(withLoading(UserRow).displayName).toBe("withLoading(UserRow)");
  });
});
