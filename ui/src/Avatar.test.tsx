import {beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import * as ImageManipulator from "expo-image-manipulator";

import {Avatar} from "./Avatar";
import {renderWithTheme} from "./test-utils";

// Mock functions for image manipulation chain
const mockSaveAsync = mock(() =>
  Promise.resolve({
    base64: "test-base64",
    uri: "test-uri",
  })
);
const mockRenderAsync = mock(() =>
  Promise.resolve({
    saveAsync: mockSaveAsync,
  })
);
const mockResize = mock(() => ({
  renderAsync: mockRenderAsync,
}));

// Mock expo-image-manipulator
mock.module("expo-image-manipulator", () => ({
  ImageManipulator: {
    manipulate: mock(() => ({
      resize: mockResize,
    })),
  },
  SaveFormat: {
    JPEG: "jpeg",
    PNG: "png",
  },
}));

// Mock expo-image-picker
mock.module("expo-image-picker", () => ({
  launchImageLibraryAsync: mock(() =>
    Promise.resolve({
      assets: [
        {
          height: 100,
          uri: "test-uri",
          width: 100,
        },
      ],
      canceled: false,
    })
  ),
}));

// Mock expo-linear-gradient
mock.module("expo-linear-gradient", () => ({
  LinearGradient: "LinearGradient",
}));

describe("Avatar", () => {
  const defaultProps = {
    name: "John Doe",
    src: "https://example.com/avatar.jpg",
    testID: "avatar",
  };

  beforeEach(() => {
    // Reset mocks
    mockSaveAsync.mockClear();
    mockRenderAsync.mockClear();
    mockResize.mockClear();
  });

  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(<Avatar {...defaultProps} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("takes keyboard focus only when the avatar is editable", () => {
    const {UNSAFE_getAllByProps, rerender} = renderWithTheme(<Avatar name="John Doe" />);
    expect(UNSAFE_getAllByProps({"aria-role": "button"})[0].props.focusable).toBe(false);

    rerender(<Avatar name="John Doe" status="imagePicker" />);
    expect(UNSAFE_getAllByProps({"aria-role": "button"})[0].props.focusable).toBe(true);
  });

  it("renders initials when no image is provided", () => {
    const {getByText} = renderWithTheme(<Avatar name="John Doe" testID="avatar" />);
    expect(getByText("JD")).toBeTruthy();
  });

  it("renders image when src is provided", () => {
    const {getByTestId} = renderWithTheme(<Avatar {...defaultProps} />);
    const image = getByTestId("avatar-image");
    expect(image).toBeTruthy();
  });

  it("shows initials when image fails to load", () => {
    const {getByText, getByTestId} = renderWithTheme(<Avatar {...defaultProps} name="John Doe" />);

    // Simulate image load error
    fireEvent(getByTestId("avatar-image"), "onError");

    expect(getByText("JD")).toBeTruthy();
  });

  it("applies correct size class", () => {
    const size = "lg";
    const {getByTestId} = renderWithTheme(<Avatar {...defaultProps} size={size} />);
    const avatar = getByTestId("avatar-image");
    // Check if the style contains the expected size
    expect(avatar.props.style).toMatchObject({
      height: 72, // lg size from the sizes object
    });
  });

  it("shows status indicator when status is provided", () => {
    const {getByTestId} = renderWithTheme(<Avatar {...defaultProps} status="online" />);
    expect(getByTestId("status-indicator")).toBeTruthy();
  });

  it("shows edit icon when status is imagePicker and size is xl", () => {
    const {getByText} = renderWithTheme(
      <Avatar {...defaultProps} size="xl" status="imagePicker" />
    );
    expect(getByText("Upload Image")).toBeTruthy();
  });

  it("calls onChange when edit icon is pressed", async () => {
    const mockOnChange = mock(() => {});
    const {getByText} = renderWithTheme(
      <Avatar {...defaultProps} onChange={mockOnChange} size="xl" status="imagePicker" />
    );

    await act(async () => {
      fireEvent.press(getByText("Upload Image"));
    });

    // The onChange should be called with the processed image
    expect(mockOnChange).toHaveBeenCalledWith({
      avatarImageFormat: "png",
      base64: "test-base64",
      uri: "data:image/png;base64,test-base64",
    });
    expect(ImageManipulator.ImageManipulator.manipulate).toHaveBeenCalled();
    expect(mockResize).toHaveBeenCalled();
    expect(mockRenderAsync).toHaveBeenCalled();
    expect(mockSaveAsync).toHaveBeenCalledWith({
      base64: true,
      format: "png",
    });
  });

  it("applies border when hasBorder is true", () => {
    const {getByTestId} = renderWithTheme(<Avatar {...defaultProps} hasBorder />);
    const avatar = getByTestId("avatar-image");
    // Check if the style contains border properties
    expect(avatar.props.style).toMatchObject({
      borderColor: expect.any(String),
      borderWidth: expect.any(Number),
    });
  });

  it("shows warning when imagePicker status is used with non-xl size", () => {
    const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    renderWithTheme(<Avatar {...defaultProps} size="lg" status="imagePicker" />);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Avatars with the status of 'imagePicker' should also have an onChange property."
    );
    consoleWarnSpy.mockRestore();
  });
});
