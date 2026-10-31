import {afterAll, beforeAll, describe, expect, it, mock, spyOn} from "bun:test";
import React from "react";

import type {ErrorPageProps} from "./Common";
import {ErrorBoundary} from "./ErrorBoundary";
import {ErrorPage} from "./ErrorPage";
import {Text} from "./Text";
import {elementProps, renderWithTheme} from "./test-utils";

describe("ErrorBoundary", () => {
  // Suppress console.warn during tests
  const originalWarn = console.warn;
  beforeAll(() => {
    console.warn = mock(() => {});
  });
  afterAll(() => {
    console.warn = originalWarn;
  });

  it("renders children when no error", () => {
    const {getByText} = renderWithTheme(
      <ErrorBoundary>
        <Text>Child content</Text>
      </ErrorBoundary>
    );
    expect(getByText("Child content")).toBeTruthy();
  });

  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(
      <ErrorBoundary>
        <Text>Content</Text>
      </ErrorBoundary>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("accepts onError callback prop", () => {
    const handleError = mock(() => {});
    const {toJSON} = renderWithTheme(
      <ErrorBoundary onError={handleError}>
        <Text>Content</Text>
      </ErrorBoundary>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("sets state from getDerivedStateFromError", () => {
    const error = new Error("derived");

    const result = ErrorBoundary.getDerivedStateFromError(error);

    expect(result).toEqual({error});
  });

  it("calls onError when componentDidCatch receives an error", () => {
    const onError = mock<(error: Error, stack: string) => void>(() => {});
    const boundary = new ErrorBoundary({children: null, onError});
    const error = new Error("caught");

    boundary.componentDidCatch(error, {componentStack: "stack trace"});

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]).toEqual([error, "stack trace"]);
  });

  it("does not throw when componentDidCatch is called without onError", () => {
    const boundary = new ErrorBoundary({children: null});
    const error = new Error("caught");

    expect(() => boundary.componentDidCatch(error, {componentStack: "stack trace"})).not.toThrow();
  });

  it("resets error state when resetError is called", () => {
    const boundary = new ErrorBoundary({children: null});
    const setStateSpy = spyOn(boundary, "setState");

    boundary.resetError();

    expect(setStateSpy).toHaveBeenCalledTimes(1);
    expect(setStateSpy.mock.calls[0][0]).toEqual({error: undefined});
    setStateSpy.mockRestore();
  });

  it("renders ErrorPage when state has an error", () => {
    const boundary = new ErrorBoundary({children: <Text>Child content</Text>});
    const error = new Error("render error");
    boundary.state = {error};

    const renderedElement = boundary.render() as React.ReactElement;

    expect(renderedElement.type).toBe(ErrorPage);
    const pageProps = elementProps<ErrorPageProps>(renderedElement);
    expect(pageProps.error).toBe(error);
    expect(typeof pageProps.resetError).toBe("function");
  });
});
