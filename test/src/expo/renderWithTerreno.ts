import {TerrenoProvider, type TerrenoProviderProps} from "@terreno/ui";
import {type RenderOptions, type RenderResult, render} from "@testing-library/react-native";
import {type ComponentType, createElement, type ReactElement, type ReactNode} from "react";

/** The slice of a Redux store `react-redux`'s `Provider` needs. */
export interface ReduxStoreLike {
  dispatch: (action: never) => unknown;
  getState: () => unknown;
  subscribe: (listener: () => void) => () => void;
}

/** `TerrenoProvider` props a test can set: color scheme, theme primitives, icons, OpenAPI URL. */
export type TerrenoThemeOptions = Omit<TerrenoProviderProps, "children">;

/** Options for `renderWithTerreno` and `createTerrenoWrapper`. */
export interface RenderWithTerrenoOptions extends Omit<RenderOptions, "wrapper"> {
  /** Redux store to provide. Requires the optional `react-redux` peer dependency. */
  store?: ReduxStoreLike;
  /** Props passed to `TerrenoProvider`. */
  theme?: TerrenoThemeOptions;
  /** Extra provider rendered inside `TerrenoProvider`, around the element under test. */
  wrapper?: ComponentType<{children: ReactNode}>;
}

type ProviderComponent = ComponentType<{children?: ReactNode; store: ReduxStoreLike}>;

/** `react-redux` is optional, so it is only loaded when a test passes a store. */
const loadReduxProvider = (): ProviderComponent => {
  try {
    return (require("react-redux") as {Provider: ProviderComponent}).Provider;
  } catch (error) {
    throw new Error(
      "renderWithTerreno: passing `store` requires the `react-redux` package. Install it as a devDependency.",
      {cause: error}
    );
  }
};

/**
 * Builds the wrapper `renderWithTerreno` uses — an optional Redux `Provider`, then
 * `TerrenoProvider`, then `wrapper` — for `renderHook` or a custom `render` call.
 */
export const createTerrenoWrapper = ({
  store,
  theme = {},
  wrapper: InnerWrapper,
}: Pick<RenderWithTerrenoOptions, "store" | "theme" | "wrapper"> = {}): ComponentType<{
  children: ReactNode;
}> => {
  const ReduxProvider = store ? loadReduxProvider() : undefined;
  const TerrenoWrapper = ({children}: {children: ReactNode}): ReactElement => {
    const content = InnerWrapper ? createElement(InnerWrapper, null, children) : children;
    const themed = createElement(TerrenoProvider, {...theme, children: content});
    if (!ReduxProvider || !store) {
      return themed;
    }
    return createElement(ReduxProvider, {store}, themed);
  };
  return TerrenoWrapper;
};

/**
 * Renders `ui` with `@testing-library/react-native` inside `TerrenoProvider` (theme, icons,
 * toasts, portal host), and inside a Redux `Provider` when `store` is given.
 *
 * Requires the optional peers `@terreno/ui`, `@testing-library/react-native`, `react`, and
 * `react-native` (mocked by `registerExpoTestEnvironment`), plus `react-redux` for `store`.
 */
export const renderWithTerreno = (
  ui: ReactElement,
  {store, theme, wrapper, ...renderOptions}: RenderWithTerrenoOptions = {}
): RenderResult => {
  return render(ui, {...renderOptions, wrapper: createTerrenoWrapper({store, theme, wrapper})});
};
