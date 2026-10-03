import {DateTime} from "luxon";
import React, {useCallback, useState} from "react";
import {Platform} from "react-native";

import {Box} from "./Box";
import {DropdownMenuItem} from "./DropdownMenuItem";
import {DropdownPanel} from "./DropdownPanel";
import {IconButton} from "./IconButton";

export interface SelectedFile {
  mimeType: string;
  name: string;
  uri: string;
}

export interface FilePickerButtonProps {
  disabled?: boolean;
  multiple?: boolean;
  onFilesSelected: (files: SelectedFile[]) => void;
  testID?: string;
}

const DOCUMENT_MIME_TYPES = ["application/pdf", "text/plain", "text/csv", "application/json"];

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
  multiple = false,
  onFilesSelected,
  testID,
}: FilePickerButtonProps): React.ReactElement => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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
        uri: asset.uri,
      }));
      onFilesSelected(files);
    }
  }, [handleWebPick, multiple, onFilesSelected]);

  const handlePickDocument = useCallback(async () => {
    setIsMenuOpen(false);
    if (Platform.OS === "web") {
      await handleWebPick(DOCUMENT_MIME_TYPES.join(","));
      return;
    }
    const DocumentPicker = await import("expo-document-picker");
    const result = await DocumentPicker.getDocumentAsync({
      multiple,
      type: DOCUMENT_MIME_TYPES,
    });

    if (!result.canceled && result.assets.length > 0) {
      const files: SelectedFile[] = result.assets.map((asset) => ({
        mimeType: asset.mimeType ?? "application/octet-stream",
        name: asset.name,
        uri: asset.uri,
      }));
      onFilesSelected(files);
    }
  }, [handleWebPick, multiple, onFilesSelected]);

  return (
    <DropdownPanel
      align="auto"
      isOpen={isMenuOpen}
      onOpenChange={setIsMenuOpen}
      renderTrigger={({toggle}) => (
        <IconButton
          accessibilityLabel="Attach file"
          disabled={disabled}
          iconName="paperclip"
          onClick={toggle}
          testID={triggerTestID}
        />
      )}
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
