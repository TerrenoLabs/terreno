import {DateTime} from "luxon";
import React, {useCallback, useState} from "react";
import {Platform} from "react-native";

import {Box} from "./Box";
import {Button} from "./Button";
import {DropdownMenuItem} from "./DropdownMenuItem";
import {DropdownPanel} from "./DropdownPanel";
import {IconButton} from "./IconButton";

export interface SelectedFile {
  mimeType: string;
  name: string;
  /** The file's size in bytes, when the picker reports it. */
  size?: number;
  uri: string;
}

const DEFAULT_DOCUMENT_TYPES = ["application/pdf", "text/plain", "text/csv", "application/json"];

export interface FilePickerButtonProps {
  disabled?: boolean;
  /**
   * The MIME types the document picker offers. Defaults to PDF, text, CSV, and JSON. An empty list
   * hides Document, so the button opens the photo library directly.
   */
  documentTypes?: string[];
  /**
   * Offer Photo Library. Defaults to true. When false, the button opens the document picker
   * directly.
   */
  includeImages?: boolean;
  multiple?: boolean;
  onFilesSelected: (files: SelectedFile[]) => void;
  testID?: string;
  /** Shows a labelled button, such as "Choose files", instead of the paperclip icon. */
  text?: string;
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (): void => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = (): void => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

/**
 * Opens the browser file dialog. Must run synchronously inside the press handler: browsers
 * only open a file input from a trusted user gesture, which an awaited import would lose.
 * Files resolve as `data:` URLs so they outlive the page, unlike `blob:` object URLs.
 */
const pickFilesOnWeb = ({
  accept,
  multiple,
}: {
  accept: string;
  multiple: boolean;
}): Promise<SelectedFile[]> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    const cleanup = (): void => {
      input.remove();
    };
    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      try {
        const selected = await Promise.all(
          files.map(async (file) => ({
            mimeType: file.type || "application/octet-stream",
            name: file.name,
            ...(file.size === undefined ? {} : {size: file.size}),
            uri: await readFileAsDataUrl(file),
          }))
        );
        resolve(selected);
      } catch (error) {
        console.warn("Failed to read selected files", error);
        resolve([]);
      }
    });
    input.addEventListener("cancel", () => {
      cleanup();
      resolve([]);
    });
    document.body.appendChild(input);
    input.click();
  });

export const FilePickerButton = ({
  disabled = false,
  documentTypes = DEFAULT_DOCUMENT_TYPES,
  includeImages = true,
  multiple = false,
  onFilesSelected,
  testID,
  text,
}: FilePickerButtonProps): React.ReactElement => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const includeDocuments = documentTypes.length > 0;
  const triggerTestID = testID ?? "file-picker-button";

  const handleWebPick = useCallback(
    async (accept: string): Promise<void> => {
      const files = await pickFilesOnWeb({accept, multiple});
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [multiple, onFilesSelected]
  );

  const handlePickImage = useCallback(async () => {
    setIsMenuOpen(false);
    if (Platform.OS === "web") {
      await handleWebPick("image/*");
      return;
    }
    const ImagePicker = await import("expo-image-picker");
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: multiple,
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      const files: SelectedFile[] = result.assets.map((asset) => ({
        mimeType: asset.mimeType ?? "image/jpeg",
        name: asset.fileName ?? `image-${DateTime.now().toMillis()}.jpg`,
        ...(asset.fileSize === undefined ? {} : {size: asset.fileSize}),
        uri: asset.uri,
      }));
      onFilesSelected(files);
    }
  }, [handleWebPick, multiple, onFilesSelected]);

  const handlePickDocument = useCallback(async () => {
    setIsMenuOpen(false);
    if (Platform.OS === "web") {
      await handleWebPick(documentTypes.join(","));
      return;
    }
    const DocumentPicker = await import("expo-document-picker");
    const result = await DocumentPicker.getDocumentAsync({multiple, type: documentTypes});

    if (!result.canceled && result.assets.length > 0) {
      const files: SelectedFile[] = result.assets.map((asset) => ({
        mimeType: asset.mimeType ?? "application/octet-stream",
        name: asset.name,
        ...(asset.size === undefined ? {} : {size: asset.size}),
        uri: asset.uri,
      }));
      onFilesSelected(files);
    }
  }, [documentTypes, handleWebPick, multiple, onFilesSelected]);

  const handleOpen = useCallback((): void => {
    if (!includeImages) {
      void handlePickDocument();
      return;
    }
    if (!includeDocuments) {
      void handlePickImage();
      return;
    }
    setIsMenuOpen(true);
  }, [handlePickDocument, handlePickImage, includeDocuments, includeImages]);

  const trigger =
    text === undefined ? (
      <IconButton
        accessibilityLabel="Attach file"
        disabled={disabled}
        iconName="paperclip"
        onClick={handleOpen}
        testID={triggerTestID}
      />
    ) : (
      <Button
        disabled={disabled}
        iconName="paperclip"
        onClick={handleOpen}
        testID={triggerTestID}
        text={text}
        variant="outline"
      />
    );

  if (!includeImages || !includeDocuments) {
    return trigger;
  }

  return (
    <DropdownPanel
      align="auto"
      isOpen={isMenuOpen}
      onOpenChange={setIsMenuOpen}
      renderTrigger={({toggle}) =>
        text === undefined ? (
          <IconButton
            accessibilityLabel="Attach file"
            disabled={disabled}
            iconName="paperclip"
            onClick={toggle}
            testID={triggerTestID}
          />
        ) : (
          <Button
            disabled={disabled}
            iconName="paperclip"
            onClick={toggle}
            testID={triggerTestID}
            text={text}
            variant="outline"
          />
        )
      }
      showActionButtons={false}
      testID={`${triggerTestID}-menu`}
      width={200}
    >
      <Box gap={1}>
        <DropdownMenuItem
          iconName="image"
          label="Photo Library"
          onClick={handlePickImage}
          testID={`${triggerTestID}-photo`}
        />
        <DropdownMenuItem
          iconName="file"
          label="Document"
          onClick={handlePickDocument}
          testID={`${triggerTestID}-document`}
        />
      </Box>
    </DropdownPanel>
  );
};
