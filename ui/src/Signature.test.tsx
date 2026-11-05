import {afterEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {View} from "react-native";
import type {ReactTestInstance} from "react-test-renderer";

import {Signature} from "./Signature";
import {findAllByHostType, findByHostType, renderWithTheme} from "./test-utils";

const createMockContext = (): Record<string, ReturnType<typeof mock>> => ({
  beginPath: mock(() => {}),
  fillRect: mock(() => {}),
  lineTo: mock(() => {}),
  moveTo: mock(() => {}),
  stroke: mock(() => {}),
});

const patchCanvasRefs = (
  container: ReactTestInstance,
  ctx: Record<string, ReturnType<typeof mock>>
): HTMLCanvasElement => {
  const canvasNodes = findAllByHostType(container, "canvas");
  const canvasNode = canvasNodes[0];
  const canvas = {
    getContext: mock(() => ctx),
    height: 180,
    releasePointerCapture: mock(() => {}),
    setPointerCapture: mock(() => {}),
    toDataURL: mock(() => "data:image/png;base64,AAAA"),
    width: 300,
  } as unknown as HTMLCanvasElement;

  const ref = canvasNode.props.ref;
  if (typeof ref === "function") {
    ref(canvas);
  } else if (ref && typeof ref === "object" && "current" in ref) {
    (ref as {current: unknown}).current = canvas;
  }
  return canvas;
};

describe("Signature", () => {
  afterEach(() => {
    mock.restore();
  });

  it("renders correctly", () => {
    const mockOnChange = mock(() => {});
    const {toJSON} = renderWithTheme(<Signature onChange={mockOnChange} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("component is defined", () => {
    expect(Signature).toBeDefined();
    expect(typeof Signature).toBe("function");
  });

  it("renders with clear button", () => {
    const mockOnChange = mock(() => {});
    const {getByText} = renderWithTheme(<Signature onChange={mockOnChange} />);
    expect(getByText("Clear")).toBeTruthy();
  });

  it("scales the web canvas to the available container width", () => {
    const mockOnChange = mock(() => {});
    const {UNSAFE_root} = renderWithTheme(<Signature onChange={mockOnChange} />);
    const canvas = findByHostType(UNSAFE_root, "canvas");
    expect(canvas.props.style).toMatchObject({maxWidth: "100%", width: "100%"});
  });

  it("allows the signature box to fill its parent", () => {
    const mockOnChange = mock(() => {});
    const {UNSAFE_getAllByType} = renderWithTheme(<Signature fullWidth onChange={mockOnChange} />);
    const wrapper = UNSAFE_getAllByType(View)[1];
    expect(wrapper.props.style).toMatchObject({maxWidth: undefined, width: "100%"});
  });

  it("maps scaled canvas pointer coordinates to the canvas buffer", () => {
    const mockOnChange = mock(() => {});
    const moveTo = mock(() => {});
    const lineTo = mock(() => {});
    const {UNSAFE_root} = renderWithTheme(<Signature onChange={mockOnChange} />);
    const canvas = findByHostType(UNSAFE_root, "canvas");
    canvas.props.ref.current = {
      clientHeight: 180,
      clientWidth: 150,
      getBoundingClientRect: () => ({height: 180, width: 150}),
      getContext: () => ({
        beginPath: mock(() => {}),
        fillRect: mock(() => {}),
        lineCap: "round",
        lineJoin: "round",
        lineTo,
        moveTo,
        stroke: mock(() => {}),
      }),
      height: 180,
      setPointerCapture: mock(() => {}),
      width: 300,
    } as unknown as HTMLCanvasElement;

    canvas.props.onPointerDown({
      nativeEvent: {offsetX: 75, offsetY: 90},
      pointerId: 1,
    });
    canvas.props.onPointerMove({
      nativeEvent: {offsetX: 90, offsetY: 120},
      pointerId: 1,
    });

    expect(moveTo).toHaveBeenCalledWith(150, 90);
    expect(lineTo).toHaveBeenCalledWith(180, 120);
  });

  it("notifies the parent with an empty value when Clear is pressed", () => {
    const mockOnChange = mock(() => {});
    const {getByText} = renderWithTheme(<Signature onChange={mockOnChange} />);
    fireEvent.press(getByText("Clear"));
    expect(mockOnChange).toHaveBeenCalledWith("");
  });

  it("calls onStart when pointer down is fired on the canvas", () => {
    const mockOnChange = mock(() => {});
    const mockOnStart = mock(() => {});
    const ctx = createMockContext();
    const {UNSAFE_root} = renderWithTheme(
      <Signature onChange={mockOnChange} onStart={mockOnStart} />
    );

    patchCanvasRefs(UNSAFE_root, ctx);

    const canvasNodes = findAllByHostType(UNSAFE_root, "canvas");
    const canvasProps = canvasNodes[0].props as Record<string, (...args: unknown[]) => void>;

    act(() => {
      canvasProps.onPointerDown({
        nativeEvent: {offsetX: 10, offsetY: 20},
        pointerId: 1,
      });
    });

    expect(mockOnStart).toHaveBeenCalledTimes(1);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
  });

  it("draws a stroke on pointerMove after pointerDown", () => {
    const mockOnChange = mock(() => {});
    const ctx = createMockContext();
    const {UNSAFE_root} = renderWithTheme(<Signature onChange={mockOnChange} />);

    patchCanvasRefs(UNSAFE_root, ctx);

    const canvasNodes = findAllByHostType(UNSAFE_root, "canvas");
    const canvasProps = canvasNodes[0].props as Record<string, (...args: unknown[]) => void>;

    act(() => {
      canvasProps.onPointerDown({
        nativeEvent: {offsetX: 5, offsetY: 5},
        pointerId: 1,
      });
    });

    act(() => {
      canvasProps.onPointerMove({
        nativeEvent: {offsetX: 50, offsetY: 50},
        pointerId: 1,
      });
    });

    expect(ctx.lineTo).toHaveBeenCalledWith(50, 50);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("ignores pointerMove when not drawing", () => {
    const mockOnChange = mock(() => {});
    const ctx = createMockContext();
    const {UNSAFE_root} = renderWithTheme(<Signature onChange={mockOnChange} />);

    patchCanvasRefs(UNSAFE_root, ctx);

    const canvasNodes = findAllByHostType(UNSAFE_root, "canvas");
    const canvasProps = canvasNodes[0].props as Record<string, (...args: unknown[]) => void>;

    act(() => {
      canvasProps.onPointerMove({
        nativeEvent: {offsetX: 50, offsetY: 50},
        pointerId: 1,
      });
    });

    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  it("exports the signature as a data URL on pointerUp after drawing", () => {
    const mockOnChange = mock(() => {});
    const mockOnEnd = mock(() => {});
    const ctx = createMockContext();
    const {UNSAFE_root} = renderWithTheme(<Signature onChange={mockOnChange} onEnd={mockOnEnd} />);

    const canvas = patchCanvasRefs(UNSAFE_root, ctx);

    const canvasNodes = findAllByHostType(UNSAFE_root, "canvas");
    const canvasProps = canvasNodes[0].props as Record<string, (...args: unknown[]) => void>;

    // Start drawing
    act(() => {
      canvasProps.onPointerDown({
        nativeEvent: {offsetX: 5, offsetY: 5},
        pointerId: 1,
      });
    });

    // Move to draw
    act(() => {
      canvasProps.onPointerMove({
        nativeEvent: {offsetX: 50, offsetY: 50},
        pointerId: 1,
      });
    });

    // Lift the pointer
    act(() => {
      canvasProps.onPointerUp({
        nativeEvent: {offsetX: 50, offsetY: 50},
        pointerId: 1,
      });
    });

    expect(mockOnChange).toHaveBeenCalledWith("data:image/png;base64,AAAA");
    expect(mockOnEnd).toHaveBeenCalledTimes(1);
    expect(
      (canvas as unknown as {releasePointerCapture: ReturnType<typeof mock>}).releasePointerCapture
    ).toHaveBeenCalledWith(1);
  });

  it("does not call onChange on pointerUp if nothing was drawn", () => {
    const mockOnChange = mock(() => {});
    const ctx = createMockContext();
    const {UNSAFE_root} = renderWithTheme(<Signature onChange={mockOnChange} />);

    patchCanvasRefs(UNSAFE_root, ctx);

    const canvasNodes = findAllByHostType(UNSAFE_root, "canvas");
    const canvasProps = canvasNodes[0].props as Record<string, (...args: unknown[]) => void>;

    // pointerDown without any move (no drawing)
    act(() => {
      canvasProps.onPointerDown({
        nativeEvent: {offsetX: 5, offsetY: 5},
        pointerId: 1,
      });
    });

    act(() => {
      canvasProps.onPointerUp({
        nativeEvent: {offsetX: 5, offsetY: 5},
        pointerId: 1,
      });
    });

    // onChange should not be called with a data URL (no strokes were made)
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it("ignores pointerUp when not drawing", () => {
    const mockOnChange = mock(() => {});
    const mockOnEnd = mock(() => {});
    const ctx = createMockContext();
    const {UNSAFE_root} = renderWithTheme(<Signature onChange={mockOnChange} onEnd={mockOnEnd} />);

    patchCanvasRefs(UNSAFE_root, ctx);

    const canvasNodes = findAllByHostType(UNSAFE_root, "canvas");
    const canvasProps = canvasNodes[0].props as Record<string, (...args: unknown[]) => void>;

    act(() => {
      canvasProps.onPointerUp({
        nativeEvent: {offsetX: 50, offsetY: 50},
        pointerId: 1,
      });
    });

    expect(mockOnEnd).not.toHaveBeenCalled();
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it("handles pointerLeave the same as pointerUp", () => {
    const mockOnChange = mock(() => {});
    const mockOnEnd = mock(() => {});
    const ctx = createMockContext();
    const {UNSAFE_root} = renderWithTheme(<Signature onChange={mockOnChange} onEnd={mockOnEnd} />);

    patchCanvasRefs(UNSAFE_root, ctx);

    const canvasNodes = findAllByHostType(UNSAFE_root, "canvas");
    const canvasProps = canvasNodes[0].props as Record<string, (...args: unknown[]) => void>;

    // Draw something
    act(() => {
      canvasProps.onPointerDown({
        nativeEvent: {offsetX: 5, offsetY: 5},
        pointerId: 1,
      });
    });
    act(() => {
      canvasProps.onPointerMove({
        nativeEvent: {offsetX: 50, offsetY: 50},
        pointerId: 1,
      });
    });

    // Leave triggers pointerUp handler
    act(() => {
      canvasProps.onPointerLeave({
        nativeEvent: {offsetX: 50, offsetY: 50},
        pointerId: 1,
      });
    });

    expect(mockOnChange).toHaveBeenCalledWith("data:image/png;base64,AAAA");
    expect(mockOnEnd).toHaveBeenCalledTimes(1);
  });

  it("resets canvas and notifies parent on clear after drawing", () => {
    const mockOnChange = mock(() => {});
    const ctx = createMockContext();
    const {UNSAFE_root, getByText} = renderWithTheme(<Signature onChange={mockOnChange} />);

    patchCanvasRefs(UNSAFE_root, ctx);

    const canvasNodes = findAllByHostType(UNSAFE_root, "canvas");
    const canvasProps = canvasNodes[0].props as Record<string, (...args: unknown[]) => void>;

    // Draw
    act(() => {
      canvasProps.onPointerDown({
        nativeEvent: {offsetX: 5, offsetY: 5},
        pointerId: 1,
      });
    });
    act(() => {
      canvasProps.onPointerMove({
        nativeEvent: {offsetX: 50, offsetY: 50},
        pointerId: 1,
      });
    });
    act(() => {
      canvasProps.onPointerUp({
        nativeEvent: {offsetX: 50, offsetY: 50},
        pointerId: 1,
      });
    });

    mockOnChange.mockClear();

    // Clear
    fireEvent.press(getByText("Clear"));

    expect(mockOnChange).toHaveBeenCalledWith("");
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("ignores pointer down when the canvas ref is missing", () => {
    const mockOnChange = mock(() => {});
    const mockOnStart = mock(() => {});
    const {UNSAFE_root} = renderWithTheme(
      <Signature onChange={mockOnChange} onStart={mockOnStart} />
    );
    const canvas = findByHostType(UNSAFE_root, "canvas");
    canvas.props.ref.current = null;

    act(() => {
      canvas.props.onPointerDown({
        nativeEvent: {offsetX: 10, offsetY: 20},
        pointerId: 1,
      });
    });

    expect(mockOnStart).not.toHaveBeenCalled();
  });

  it("falls back to raw offsets when the canvas has no measurable size", () => {
    const mockOnChange = mock(() => {});
    const moveTo = mock(() => {});
    const {UNSAFE_root} = renderWithTheme(<Signature onChange={mockOnChange} />);
    const canvas = findByHostType(UNSAFE_root, "canvas");
    canvas.props.ref.current = {
      clientHeight: 0,
      clientWidth: 0,
      getBoundingClientRect: () => ({height: 0, width: 0}),
      getContext: () => ({
        beginPath: mock(() => {}),
        fillRect: mock(() => {}),
        lineCap: "round",
        lineJoin: "round",
        lineTo: mock(() => {}),
        moveTo,
        stroke: mock(() => {}),
      }),
      height: 0,
      setPointerCapture: mock(() => {}),
      width: 0,
    } as unknown as HTMLCanvasElement;

    act(() => {
      canvas.props.onPointerDown({
        nativeEvent: {offsetX: 42, offsetY: 24},
        pointerId: 1,
      });
    });

    expect(moveTo).toHaveBeenCalledWith(42, 24);
  });
});
