import {afterAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {fireEvent, waitFor, within} from "@testing-library/react-native";
import {Platform, Pressable} from "react-native";

// Override the IconButton mock so the onClick fires when pressed.
mock.module("./IconButton", () => ({
  IconButton: ({
    accessibilityLabel,
    disabled,
    onClick,
    testID,
  }: {
    accessibilityLabel?: string;
    disabled?: boolean;
    onClick?: () => void;
    testID?: string;
  }) => (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onClick}
      testID={testID}
    />
  ),
}));

afterAll(() => {
  mock.module("./IconButton", () => ({
    IconButton: mock(() => null),
  }));
});

import {FilePickerButton, type SelectedFile} from "./FilePickerButton";
import {renderWithTheme} from "./test-utils";

interface ImagePickerResult {
  assets: Array<{fileName?: string; fileSize?: number; mimeType?: string; uri: string}>;
  canceled: boolean;
}

interface DocumentPickerResult {
  assets: Array<{mimeType?: string; name: string; size?: number; uri: string}>;
  canceled: boolean;
}

let imagePickerResult: ImagePickerResult = {assets: [], canceled: true};
let documentPickerResult: DocumentPickerResult = {assets: [], canceled: true};
const launchImageLibraryAsync = mock(async (): Promise<ImagePickerResult> => imagePickerResult);
const getDocumentAsync = mock(async (): Promise<DocumentPickerResult> => documentPickerResult);

mock.module("expo-image-picker", () => ({launchImageLibraryAsync}));
mock.module("expo-document-picker", () => ({getDocumentAsync}));

const openModal = (
  multiple = false
): {files: SelectedFile[][]; getByText: typeof result.getByText} => {
  const files: SelectedFile[][] = [];
  const result = renderWithTheme(
    <FilePickerButton multiple={multiple} onFilesSelected={(selected) => files.push(selected)} />
  );
  fireEvent.press(result.getByTestId("file-picker-button"));
  return {files, getByText: result.getByText};
};

describe("FilePickerButton", () => {
  beforeEach(() => {
    imagePickerResult = {assets: [], canceled: true};
    documentPickerResult = {assets: [], canceled: true};
    launchImageLibraryAsync.mockClear();
    getDocumentAsync.mockClear();
  });

  it("renders with default and custom testIDs", () => {
    const {getByTestId} = renderWithTheme(<FilePickerButton onFilesSelected={() => {}} />);
    expect(getByTestId("file-picker-button")).toBeTruthy();
    const custom = renderWithTheme(<FilePickerButton onFilesSelected={() => {}} testID="custom" />);
    expect(custom.getByTestId("custom")).toBeTruthy();
  });

  it("passes disabled through to the trigger button", () => {
    const {getByTestId} = renderWithTheme(<FilePickerButton disabled onFilesSelected={() => {}} />);
    expect(getByTestId("file-picker-button").props.accessibilityState).toEqual({disabled: true});
  });

  it("opens an anchored dropdown with both options instead of a modal", () => {
    const {getByText} = openModal();
    expect(getByText("Photo Library")).toBeTruthy();
    expect(getByText("Document")).toBeTruthy();
  });

  it("closes the dropdown from the backdrop", () => {
    const {getByLabelText, getByTestId, queryByText} = renderWithTheme(
      <FilePickerButton onFilesSelected={() => {}} />
    );
    fireEvent.press(getByLabelText("Attach file"));
    expect(queryByText("Document")).toBeTruthy();
    fireEvent.press(getByTestId("file-picker-button-menu.backdrop"));
    expect(queryByText("Document")).toBeNull();
  });

  it("maps picked images and applies default mime type and name", async () => {
    imagePickerResult = {
      assets: [
        {fileName: "pic.png", mimeType: "image/png", uri: "file:///pic.png"},
        {uri: "file:///unnamed"},
      ],
      canceled: false,
    };
    const {files, getByText} = openModal(true);
    fireEvent.press(getByText("Photo Library"));
    await waitFor(() => expect(files).toHaveLength(1));
    expect(launchImageLibraryAsync).toHaveBeenCalledWith({
      allowsMultipleSelection: true,
      mediaTypes: ["images"],
      quality: 0.8,
    });
    expect(files[0][0]).toEqual({mimeType: "image/png", name: "pic.png", uri: "file:///pic.png"});
    expect(files[0][1].mimeType).toBe("image/jpeg");
    expect(files[0][1].name).toMatch(/^image-\d+\.jpg$/);
    expect(files[0][1].uri).toBe("file:///unnamed");
  });

  it("does nothing when the image picker is canceled or returns no assets", async () => {
    const canceled = openModal();
    fireEvent.press(canceled.getByText("Photo Library"));
    await waitFor(() => expect(launchImageLibraryAsync).toHaveBeenCalledTimes(1));
    expect(canceled.files).toHaveLength(0);

    imagePickerResult = {assets: [], canceled: false};
    const empty = openModal();
    fireEvent.press(empty.getByText("Photo Library"));
    await waitFor(() => expect(launchImageLibraryAsync).toHaveBeenCalledTimes(2));
    expect(empty.files).toHaveLength(0);
  });

  it("maps picked documents and applies default mime type", async () => {
    documentPickerResult = {
      assets: [
        {mimeType: "application/pdf", name: "report.pdf", uri: "file:///report.pdf"},
        {name: "notes.txt", uri: "file:///notes.txt"},
      ],
      canceled: false,
    };
    const {files, getByText} = openModal();
    fireEvent.press(getByText("Document"));
    await waitFor(() => expect(files).toHaveLength(1));
    expect(getDocumentAsync).toHaveBeenCalledWith({
      multiple: false,
      type: ["application/pdf", "text/plain", "text/csv", "application/json"],
    });
    expect(files[0]).toEqual([
      {mimeType: "application/pdf", name: "report.pdf", uri: "file:///report.pdf"},
      {mimeType: "application/octet-stream", name: "notes.txt", uri: "file:///notes.txt"},
    ]);
  });

  it("does nothing when the document picker is canceled or returns no assets", async () => {
    const canceled = openModal();
    fireEvent.press(canceled.getByText("Document"));
    await waitFor(() => expect(getDocumentAsync).toHaveBeenCalledTimes(1));
    expect(canceled.files).toHaveLength(0);

    documentPickerResult = {assets: [], canceled: false};
    const empty = openModal();
    fireEvent.press(empty.getByText("Document"));
    await waitFor(() => expect(getDocumentAsync).toHaveBeenCalledTimes(2));
    expect(empty.files).toHaveLength(0);
  });

  it("shows a labelled button when text is set", () => {
    const {getByTestId} = renderWithTheme(
      <FilePickerButton onFilesSelected={() => {}} text="Choose files" />
    );
    expect(within(getByTestId("file-picker-button")).getByText("Choose files")).toBeTruthy();
  });

  it("opens the document picker with the given types directly when images are off", async () => {
    documentPickerResult = {
      assets: [{mimeType: "text/csv", name: "day.csv", size: 42, uri: "file:///day.csv"}],
      canceled: false,
    };
    const files: SelectedFile[][] = [];
    const {getByTestId, queryByText} = renderWithTheme(
      <FilePickerButton
        documentTypes={["text/csv"]}
        includeImages={false}
        onFilesSelected={(selected) => files.push(selected)}
        text="Choose files"
      />
    );

    fireEvent.press(getByTestId("file-picker-button"));

    await waitFor(() => expect(files).toHaveLength(1));
    expect(queryByText("Photo Library")).toBeNull();
    expect(getDocumentAsync).toHaveBeenCalledWith({multiple: false, type: ["text/csv"]});
    expect(files[0]).toEqual([
      {mimeType: "text/csv", name: "day.csv", size: 42, uri: "file:///day.csv"},
    ]);
  });

  it("opens the photo library directly when there are no document types", async () => {
    imagePickerResult = {
      assets: [
        {fileName: "pic.png", fileSize: 2048, mimeType: "image/png", uri: "file:///pic.png"},
      ],
      canceled: false,
    };
    const files: SelectedFile[][] = [];
    const {getByTestId} = renderWithTheme(
      <FilePickerButton documentTypes={[]} onFilesSelected={(selected) => files.push(selected)} />
    );

    fireEvent.press(getByTestId("file-picker-button"));

    await waitFor(() => expect(files).toHaveLength(1));
    expect(getDocumentAsync).not.toHaveBeenCalled();
    expect(files[0]).toEqual([
      {mimeType: "image/png", name: "pic.png", size: 2048, uri: "file:///pic.png"},
    ]);
  });

  it("opens a browser file input for documents on web and returns data URLs", async () => {
    const listeners: Record<string, () => void | Promise<void>> = {};
    const file = {name: "notes.txt", type: "text/plain"};
    const input = {
      accept: "",
      addEventListener: (event: string, handler: () => void): void => {
        listeners[event] = handler;
      },
      click: mock(() => {}),
      files: [file],
      multiple: false,
      remove: mock(() => {}),
      style: {display: ""},
      type: "",
    };
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalDocument = globals.document;
    const originalFileReader = globals.FileReader;
    const originalOS = Platform.OS;

    const {files, getByText} = openModal();
    globals.document = {
      body: {appendChild: mock(() => {})},
      createElement: (): typeof input => input,
    };
    globals.FileReader = class {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      result = "data:text/plain;base64,aGk=";
      readAsDataURL(): void {
        this.onload?.();
      }
    };
    Platform.OS = "web";
    try {
      fireEvent.press(getByText("Document"));
      expect(input.click).toHaveBeenCalledTimes(1);
      expect(input.accept).toBe("application/pdf,text/plain,text/csv,application/json");
      await listeners.change?.();
      await waitFor(() => expect(files).toHaveLength(1));
      expect(files[0]).toEqual([
        {mimeType: "text/plain", name: "notes.txt", uri: "data:text/plain;base64,aGk="},
      ]);
      expect(getDocumentAsync).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
      globals.document = originalDocument;
      globals.FileReader = originalFileReader;
    }
  });
});
