import {DateTime} from "luxon";
import React, {useCallback, useState} from "react";

import {Box} from "./Box";
import {Button} from "./Button";
import {IconButton} from "./IconButton";
import {Modal} from "./Modal";

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

export const FilePickerButton = ({
  disabled = false,
  documentTypes = DEFAULT_DOCUMENT_TYPES,
  includeImages = true,
  multiple = false,
  onFilesSelected,
  testID,
  text,
}: FilePickerButtonProps): React.ReactElement => {
  const [showModal, setShowModal] = useState(false);
  const includeDocuments = documentTypes.length > 0;

  const handlePickImage = useCallback(async () => {
    setShowModal(false);
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
  }, [multiple, onFilesSelected]);

  const handlePickDocument = useCallback(async () => {
    setShowModal(false);
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
  }, [documentTypes, multiple, onFilesSelected]);

  const handleOpen = useCallback((): void => {
    if (!includeImages) {
      void handlePickDocument();
      return;
    }
    if (!includeDocuments) {
      void handlePickImage();
      return;
    }
    setShowModal(true);
  }, [handlePickDocument, handlePickImage, includeDocuments, includeImages]);

  const buttonTestID = testID ?? "file-picker-button";

  return (
    <>
      {text === undefined ? (
        <IconButton
          accessibilityLabel="Attach file"
          disabled={disabled}
          iconName="paperclip"
          onClick={handleOpen}
          testID={buttonTestID}
        />
      ) : (
        <Button
          disabled={disabled}
          iconName="paperclip"
          onClick={handleOpen}
          testID={buttonTestID}
          text={text}
          variant="outline"
        />
      )}
      <Modal onDismiss={() => setShowModal(false)} size="sm" title="Attach" visible={showModal}>
        <Box gap={2} padding={3}>
          <Button
            iconName="image"
            onClick={handlePickImage}
            text="Photo Library"
            variant="outline"
          />
          <Button iconName="file" onClick={handlePickDocument} text="Document" variant="outline" />
        </Box>
      </Modal>
    </>
  );
};
