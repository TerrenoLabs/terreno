import {beforeEach, describe, it, mock} from "bun:test";
import {act, render} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";

mock.module("react-native", () => ({
  Platform: {
    OS: "ios",
    select: (options: Record<string, unknown>) => options.ios ?? options.default,
  },
  Pressable: "Pressable",
  StyleSheet: {create: (styles: unknown) => styles, flatten: (styles: unknown) => styles},
  Text: "Text",
  useWindowDimensions: () => ({height: 800, width: 400}),
  View: "View",
}));

mock.module("@terreno/ui", () => {
  const ReactModule = require("react");
  const ReactNative = require("react-native");
  const Container = ({
    children,
    ...props
  }: {children?: React.ReactNode} & Record<string, unknown>) =>
    ReactModule.createElement(ReactNative.View, props, children);
  const Button = ({
    text,
    onClick,
    ...props
  }: {onClick?: () => void; text?: string} & Record<string, unknown>) =>
    ReactModule.createElement(
      ReactNative.Pressable,
      {...props, onPress: onClick},
      ReactModule.createElement(ReactNative.Text, {}, text)
    );
  const Field = ({
    onChange,
    testID,
    title,
    value,
  }: {
    onChange?: (value: unknown) => void;
    testID?: string;
    title?: string;
    value?: unknown;
  }) => ReactModule.createElement(ReactNative.View, {onChange, testID, title, value});
  const Modal = ({
    children,
    onDismiss,
    primaryButtonOnClick,
    secondaryButtonOnClick,
    visible,
  }: {
    children?: React.ReactNode;
    onDismiss?: () => void;
    primaryButtonOnClick?: () => void;
    secondaryButtonOnClick?: () => void;
    visible?: boolean;
  }) =>
    visible
      ? ReactModule.createElement(
          ReactNative.View,
          {
            onDismiss,
            primaryButtonOnClick,
            secondaryButtonOnClick,
            testID: "mobile-filter-modal",
          },
          children
        )
      : null;
  return {
    BooleanField: Field,
    Box: Container,
    Button,
    Card: Container,
    DateTimeField: Field,
    Heading: Container,
    IconButton: Button,
    Modal,
    SelectField: Field,
    Text: Container,
    TextField: Field,
  };
});

mock.module("../AdminRefField", () => ({
  AdminRefField: (props: Record<string, unknown>) => React.createElement("AdminRefField", props),
}));

import {AdminFilterDrawer} from "../AdminFilterDrawer";

const findWithCallback = (
  root: ReactTestInstance,
  testID: string,
  callback: string
): ReactTestInstance => {
  const node = root.findAll(
    (candidate: ReactTestInstance) =>
      candidate.props.testID === testID && typeof candidate.props[callback] === "function"
  )[0];
  assert.isDefined(node);
  return node;
};

describe("AdminFilterDrawer mobile", () => {
  const onApply = mock(() => {});

  beforeEach(() => {
    onApply.mockClear();
  });

  it("opens the sheet, applies a draft, and closes it", () => {
    const {getByTestId, queryByTestId, UNSAFE_root} = render(
      <AdminFilterDrawer
        appliedFilterState={{}}
        fields={{email: {required: false, type: "string"}}}
        filters={[{field: "email", kind: "string"}]}
        onApply={onApply}
      />
    );

    act(() => {
      findWithCallback(UNSAFE_root, "admin-filter-open", "onPress").props.onPress();
    });
    assert.isDefined(getByTestId("admin-filter-sheet"));

    act(() => {
      findWithCallback(UNSAFE_root, "admin-filter-email", "onChange").props.onChange(
        "mobile@example.com"
      );
    });
    act(() => {
      getByTestId("mobile-filter-modal").props.primaryButtonOnClick();
    });

    assert.deepEqual(onApply.mock.calls[0]?.[0], {email: "mobile@example.com"});
    assert.isNull(queryByTestId("admin-filter-sheet"));
  });

  it("dismisses changes and clears applied filters", () => {
    const {getByTestId, queryByTestId, UNSAFE_root} = render(
      <AdminFilterDrawer
        appliedFilterState={{email: "existing@example.com"}}
        fields={{email: {required: false, type: "string"}}}
        filters={[{field: "email", kind: "string"}]}
        onApply={onApply}
      />
    );

    act(() => {
      findWithCallback(UNSAFE_root, "admin-filter-open", "onPress").props.onPress();
    });
    act(() => {
      getByTestId("mobile-filter-modal").props.secondaryButtonOnClick();
    });
    assert.isNull(queryByTestId("admin-filter-sheet"));
    assert.equal(onApply.mock.calls.length, 0);

    act(() => {
      findWithCallback(UNSAFE_root, "admin-filter-open", "onPress").props.onPress();
    });
    act(() => {
      findWithCallback(UNSAFE_root, "admin-filter-clear-all", "onPress").props.onPress();
    });
    assert.deepEqual(onApply.mock.calls[0]?.[0], {});
    assert.isNull(queryByTestId("admin-filter-sheet"));
  });
});
