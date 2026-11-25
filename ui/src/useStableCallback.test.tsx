import {describe, expect, it} from "bun:test";
import {renderHook} from "@testing-library/react-native";

import {useStableCallback} from "./useStableCallback";

describe("useStableCallback", () => {
  it("keeps one identity across renders", () => {
    const {result, rerender} = renderHook(
      ({callback}: {callback: () => string}) => useStableCallback(callback),
      {initialProps: {callback: (): string => "first"}}
    );
    const initial = result.current;

    rerender({callback: (): string => "second"});

    expect(result.current).toBe(initial);
  });

  it("calls the newest callback with the caller's arguments", () => {
    const {result, rerender} = renderHook(
      ({callback}: {callback: (value: number) => string}) => useStableCallback(callback),
      {initialProps: {callback: (value: number): string => `first ${value}`}}
    );
    const stable = result.current;
    expect(stable(1)).toBe("first 1");

    rerender({callback: (value: number): string => `second ${value}`});

    expect(stable(2)).toBe("second 2");
  });
});
