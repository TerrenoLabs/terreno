import {mock} from "bun:test";
import {render} from "@testing-library/react-native";
import type {JestNativeMatchers} from "@testing-library/react-native/build/matchers/types";
import type React from "react";
import {View} from "react-native";
import type {ReactTestInstance, ReactTestRendererJSON} from "react-test-renderer";

import type {CustomIconProps, IconRegistryMap} from "./Common";
import {IconRegistryProvider} from "./IconRegistry";
import {ThemeProvider} from "./Theme";

// Register a custom icon name for tests. test-utils.tsx is excluded from the
// published build (see tsconfig), so this augmentation never leaks to consumers.
declare module "./Common" {
  interface CustomIconRegistry {
    testCustomIcon: true;
  }
}

// @testing-library/react-native registers its matchers (toHaveStyle, toHaveProp, ...) on the
// global expect at import time; expose their types on bun:test's expect as well.
declare module "bun:test" {
  interface Matchers<T> extends JestNativeMatchers<void> {}
}

export const TEST_CUSTOM_ICON_TEST_ID = "test-custom-icon";

export const TestCustomIcon: React.FC<CustomIconProps> = ({size, testID}) => {
  return <View accessibilityLabel={`size:${size}`} testID={testID ?? TEST_CUSTOM_ICON_TEST_ID} />;
};

export const testCustomIcons: IconRegistryMap = {testCustomIcon: TestCustomIcon};

export const renderWithTheme = (ui: React.ReactElement) => {
  return render(ui, {wrapper: ThemeProvider});
};

export const renderWithIcons = (
  ui: React.ReactElement,
  icons: IconRegistryMap = testCustomIcons
) => {
  return render(ui, {
    wrapper: ({children}: {children: React.ReactNode}) => (
      <ThemeProvider>
        <IconRegistryProvider icons={icons}>{children}</IconRegistryProvider>
      </ThemeProvider>
    ),
  });
};

export const createCommonMocks = () => ({
  onBlur: mock(() => {}),
  onChange: mock((_value: string) => {}),
  onEnter: mock(() => {}),
  onFocus: mock(() => {}),
  onIconClick: mock(() => {}),
  onSubmitEditing: mock(() => {}),
});

export const setupComponentTest = () => {
  return createCommonMocks();
};

export const teardownComponentTest = () => {
  // In Bun, mocks are automatically cleaned up
  // No-op for compatibility
};

/**
 * Host element name (e.g. "View") of a test-renderer node. The react-native mock in bunSetup.ts
 * renders string host types that React's DOM-only JSX typings do not list, so read it as a string.
 */
const hostTypeName = (node: ReactTestInstance): string | undefined => {
  const type: unknown = node.type;
  return typeof type === "string" ? type : undefined;
};

const isHostType = (node: ReactTestInstance, name: string): boolean => {
  return hostTypeName(node) === name;
};

/** Typed equivalent of `root.findByType("View")` for string host types. */
export const findByHostType = (root: ReactTestInstance, name: string): ReactTestInstance => {
  return root.find((node) => isHostType(node, name));
};

/** Typed equivalent of `root.findAllByType("View")` for string host types. */
export const findAllByHostType = (
  root: ReactTestInstance,
  name: string,
  options?: {deep: boolean}
): ReactTestInstance[] => {
  return root.findAll((node) => isHostType(node, name), options);
};

/**
 * Props of a React element handed to `createNodeMock` or returned from a render method. React
 * types element props as `unknown`; tests read the few host props they inspect through this.
 */
export const elementProps = <P extends object = Record<string, unknown>>(
  element: React.ReactElement
): Partial<P> => {
  return (element.props ?? {}) as Partial<P>;
};

/** Narrows a `toJSON()` result to its single root node; fails when the render has several roots. */
export const rootJSONNode = (
  tree: ReactTestRendererJSON | ReactTestRendererJSON[] | null
): ReactTestRendererJSON | null => {
  if (Array.isArray(tree)) {
    throw new Error(`Expected a single root node, got ${tree.length}`);
  }
  return tree;
};
