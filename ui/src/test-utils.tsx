import {mock} from "bun:test";
import {render} from "@testing-library/react-native";
import type React from "react";
import {View} from "react-native";

import type {CustomIconProps, IconRegistryMap} from "./Common";
import {IconRegistryProvider} from "./IconRegistry";
import type {TerrenoRequestArgs, TerrenoRequestClient} from "./requestClient";
import {ThemeProvider} from "./Theme";

// Register a custom icon name for tests. test-utils.tsx is excluded from the
// published build (see tsconfig), so this augmentation never leaks to consumers.
declare module "./Common" {
  interface CustomIconRegistry {
    testCustomIcon: true;
  }
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
  onChange: mock(() => {}),
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

/** Handler for one fake route; return the response payload or throw to fail the request. */
export type FakeRouteHandler = (
  args: TerrenoRequestArgs,
  pathParams: Record<string, string>
) => unknown | Promise<unknown>;

export interface FakeRequestClient {
  client: TerrenoRequestClient;
  /** Every request in call order. */
  calls: TerrenoRequestArgs[];
  /** Requests whose method and URL match `route` (for example `"POST /consents/respond"`). */
  callsTo: (route: string) => TerrenoRequestArgs[];
}

/** Error shaped like a failed request: carries the HTTP `status`. */
export const fakeHttpError = (status: number, title = `HTTP ${status}`): Error =>
  Object.assign(new Error(title), {data: {title}, status});

const routePattern = (route: string): {method: string; regex: RegExp; names: string[]} => {
  const [method, path] = route.split(" ");
  const names: string[] = [];
  const source = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return {method: method.toUpperCase(), names, regex: new RegExp(`^${source}$`)};
};

const matchRoute = (
  route: string,
  args: TerrenoRequestArgs
): Record<string, string> | undefined => {
  const {method, names, regex} = routePattern(route);
  if ((args.method ?? "GET").toUpperCase() !== method) {
    return undefined;
  }
  const match = regex.exec(args.url);
  if (!match) {
    return undefined;
  }
  return Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? ""]));
};

/**
 * In-memory {@link TerrenoRequestClient}. Routes are `"METHOD /path/:param"` keys; a request
 * with no matching route rejects with a 404 error.
 */
export const createFakeRequestClient = (
  routes: Record<string, FakeRouteHandler>
): FakeRequestClient => {
  const calls: TerrenoRequestArgs[] = [];
  const request = async <T,>(args: TerrenoRequestArgs): Promise<T> => {
    calls.push(args);
    for (const [route, handler] of Object.entries(routes)) {
      const pathParams = matchRoute(route, args);
      if (pathParams) {
        return (await handler(args, pathParams)) as T;
      }
    }
    throw fakeHttpError(404, `No fake route for ${args.method ?? "GET"} ${args.url}`);
  };
  return {
    calls,
    callsTo: (route: string): TerrenoRequestArgs[] =>
      calls.filter((args) => matchRoute(route, args) !== undefined),
    client: {request},
  };
};
