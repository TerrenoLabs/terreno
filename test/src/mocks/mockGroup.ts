import {type Mock, mock} from "bun:test";

// Any function: `never[]` parameters accept every signature, and the type is assignable to
// Bun's `Mock<T>` constraint.
type AnyFunction = (...args: never[]) => unknown;

export interface MockGroup {
  /** Creates a mock whose default behavior `reset()` restores. */
  fn: <T extends AnyFunction>(implementation: T) => Mock<T>;
  /** Clears every mock's calls and restores its default implementation. */
  reset: () => void;
}

/** Tracks a set of SDK mocks so one call resets calls, one-off overrides, and implementations. */
export const createMockGroup = (): MockGroup => {
  const entries: Array<{implementation: AnyFunction; mockFn: Mock<AnyFunction>}> = [];

  const fn = <T extends AnyFunction>(implementation: T): Mock<T> => {
    const mockFn = mock(implementation);
    entries.push({implementation, mockFn: mockFn as unknown as Mock<AnyFunction>});
    return mockFn;
  };

  const reset = (): void => {
    for (const {implementation, mockFn} of entries) {
      mockFn.mockReset();
      mockFn.mockImplementation(implementation);
    }
  };

  return {fn, reset};
};
