import {type Mock, mock} from "bun:test";
import {createElement, Fragment, type ReactElement, type ReactNode} from "react";

/** Exports a `mock.module` factory returns. */
export type ModuleExports = Record<string, unknown>;

/** A `mock.module` factory: called by Bun when the mocked module is first imported. */
export type ModuleFactory = () => ModuleExports;

/** Map of module specifier to the factory that replaces it. */
export type ModuleMockMap = Record<string, ModuleFactory>;

/** Props the host-element stand-ins accept and forward. */
export type MockComponentProps = Record<string, unknown> & {children?: ReactNode};

/** A function component used as a stand-in for a native view. */
export type MockComponent = (props: MockComponentProps) => ReactElement;

/** Runtime platform the mocks report through `Platform.OS` and `EXPO_OS`. */
export type ExpoTestPlatform = "android" | "ios" | "web";

/** A `{remove}` subscription handle like the ones React Native listeners return. */
export interface MockSubscription {
  remove: Mock<() => void>;
}

const noop = (): void => {};

/** A `bun:test` mock that does nothing and returns `undefined`. */
export const stub = (): Mock<(...args: unknown[]) => void> => mock(noop);

/** A `bun:test` mock that always returns `value`. */
export const stubReturning = <T>(value: T): Mock<(...args: unknown[]) => T> =>
  mock((..._args: unknown[]): T => value);

/** A `bun:test` mock that always resolves to `value`. */
export const stubResolving = <T>(value: T): Mock<(...args: unknown[]) => Promise<T>> =>
  mock((..._args: unknown[]): Promise<T> => Promise.resolve(value));

/** A `bun:test` mock that returns its first argument unchanged. */
export const stubIdentity = (): Mock<<T>(value: T, ...rest: unknown[]) => T> =>
  mock(<T>(value: T, ..._rest: unknown[]): T => value);

/** A fresh `{remove}` subscription handle. */
const subscription = (): MockSubscription => ({remove: mock(noop)});

/** A `bun:test` mock that returns a fresh `{remove}` subscription on every call. */
export const stubSubscription = (): Mock<(...args: unknown[]) => MockSubscription> =>
  mock((..._args: unknown[]): MockSubscription => subscription());

/**
 * A component that renders a host element named `name` with every prop and child forwarded,
 * so tests can find it by `testID`, inspect its props, and fire its handlers.
 */
export const hostComponent = (name: string): MockComponent => {
  const Component = ({children, ...props}: MockComponentProps): ReactElement =>
    createElement(name, props, children);
  Object.defineProperty(Component, "name", {value: name});
  return Component;
};

/** A component that renders its children only (a provider or wrapper stand-in). */
export const passthroughComponent = ({children}: MockComponentProps): ReactElement =>
  createElement(Fragment, null, children);

/** Builds a map of host components, one per name. */
export const hostComponents = (names: string[]): Record<string, MockComponent> => {
  const components: Record<string, MockComponent> = {};
  for (const name of names) {
    components[name] = hostComponent(name);
  }
  return components;
};
