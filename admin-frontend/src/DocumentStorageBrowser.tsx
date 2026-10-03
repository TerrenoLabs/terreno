import {
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  type DataTableCustomComponentMap,
  IconButton,
  Link,
  Modal,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Platform} from "react-native";

import {AdminScreenPage} from "./AdminScreenPage";
import type {DocumentFile, DocumentListResponse, DocumentStorageBrowserProps} from "./types";
import {useDocumentStorageApi} from "./useDocumentStorageApi";

const ACTIONS_COLUMN_TYPE = "documentActions";
const NAME_COLUMN_TYPE = "documentName";

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const uploadErrorMessage = (err: unknown): string => {
  const {status, data} = (err ?? {}) as {status?: number; data?: {title?: string}};
  if (status === 429) {
    return "Upload limit reached. Try again in a minute.";
  }
  return data?.title ? `Upload failed: ${data.title}` : "Upload failed. Please try again.";
};

const formatDate = (isoDate: string): string => {
  const dt = DateTime.fromISO(isoDate);
  return dt.isValid ? dt.toLocaleString(DateTime.DATETIME_SHORT) : isoDate;
};

export const DocumentStorageBrowser: React.FC<DocumentStorageBrowserProps> = ({
  api,
  basePath,
  backHref,
  backButton = true,
  title = "Documents",
  allowDelete = true,
  allowUpload = true,
  onFileSelect,
  onSettingsPress,
}) => {
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [isNotConfigured, setIsNotConfigured] = useState(false);
  const [skipFetch, setSkipFetch] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    useListQuery,
    useUploadMutation,
    useDeleteMutation,
    useDeleteFolderMutation,
    useCreateFolderMutation,
    useLazyDownloadQuery,
  } = useDocumentStorageApi(api, basePath);

  const {
    data: listData,
    isLoading,
    isError,
    error,
    refetch,
  } = useListQuery(currentPrefix || undefined, {skip: skipFetch}) as {
    data: DocumentListResponse | undefined;
    isLoading: boolean;
    isError: boolean;
    error: {status?: number; originalStatus?: number} | undefined;
    refetch: () => void;
  };
  const [uploadFile, {isLoading: isUploading}] = useUploadMutation();
  const [deleteFile] = useDeleteMutation();
  const [deleteFolder] = useDeleteFolderMutation();
  const [createFolder] = useCreateFolderMutation();
  const [downloadFile] = useLazyDownloadQuery();

  // Detect 503 "not configured" responses
  useEffect(() => {
    if (isError && error) {
      const status = error?.status ?? error?.originalStatus;
      if (status === 503) {
        setIsNotConfigured(true);
        setSkipFetch(true);
      }
    }
  }, [isError, error]);

  const handleRefresh = useCallback(() => {
    if (skipFetch) {
      setIsNotConfigured(false);
      setSkipFetch(false);
    } else {
      refetch();
    }
  }, [skipFetch, refetch]);

  const handleFolderClick = useCallback((folder: string) => {
    setCurrentPrefix(folder);
  }, []);

  const handleBreadcrumbClick = useCallback((prefix: string) => {
    setCurrentPrefix(prefix);
  }, []);

  const handleDownload = useCallback(
    async (filePath: string) => {
      console.info("[DocumentStorageBrowser] handleDownload filePath:", filePath);
      try {
        const blob = await downloadFile(filePath).unwrap();
        console.info("[DocumentStorageBrowser] got blob:", blob);
        if (Platform.OS === "web" && blob) {
          const blobObj = blob as Blob;
          const url = URL.createObjectURL(blobObj);
          const filename = filePath.split("/").filter(Boolean).pop() ?? "download";
          console.info(
            "[DocumentStorageBrowser] creating download link, filename:",
            filename,
            "blobSize:",
            blobObj.size,
            "blobType:",
            blobObj.type,
            "url:",
            url
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.error("Failed to download file:", err);
      }
    },
    [downloadFile]
  );

  const handleDelete = useCallback(
    async (filePath: string) => {
      try {
        await deleteFile(filePath).unwrap();
      } catch (err) {
        console.error("Failed to delete file:", err);
      }
    },
    [deleteFile]
  );

  const handleDeleteFolder = useCallback(
    async (folderPath: string) => {
      try {
        await deleteFolder(folderPath).unwrap();
      } catch (err) {
        console.error("Failed to delete folder:", err);
      }
    },
    [deleteFolder]
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      setUploadError(null);
      try {
        await uploadFile({formData, prefix: currentPrefix || undefined}).unwrap();
      } catch (err) {
        console.error("Failed to upload file:", err);
        setUploadError(uploadErrorMessage(err));
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [uploadFile, currentPrefix]
  );

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) {
      return;
    }
    setIsCreatingFolder(true);
    try {
      await createFolder({folderName: name, prefix: currentPrefix || undefined}).unwrap();
      setNewFolderName("");
      setShowNewFolderModal(false);
    } catch (err) {
      console.error("Failed to create folder:", err);
    } finally {
      setIsCreatingFolder(false);
    }
  }, [createFolder, newFolderName, currentPrefix]);

  const handleNewFolderModalDismiss = useCallback(() => {
    setShowNewFolderModal(false);
    setNewFolderName("");
  }, []);

  // Build breadcrumb segments
  const breadcrumbs = useMemo(() => {
    const segments: {label: string; prefix: string}[] = [{label: "Root", prefix: ""}];
    if (currentPrefix) {
      const parts = currentPrefix.split("/").filter(Boolean);
      let accumulated = "";
      for (const part of parts) {
        accumulated += `${part}/`;
        segments.push({label: part, prefix: accumulated});
      }
    }
    return segments;
  }, [currentPrefix]);

  const DocumentNameCell: React.FC<{
    column: DataTableColumn;
    cellData: DataTableCellData;
  }> = useCallback(
    ({cellData}: {column: DataTableColumn; cellData: DataTableCellData}) => {
      const {
        name,
        isFolder: isFolderItem,
        folder,
        file,
      } = cellData.value as {
        name: string;
        isFolder: boolean;
        folder?: string;
        file?: DocumentFile;
      };
      if (isFolderItem && folder) {
        return <Link onClick={() => handleFolderClick(folder)} text={name} />;
      }
      if (file && onFileSelect) {
        return <Link onClick={() => onFileSelect(file)} text={name} />;
      }
      return <Text>{name}</Text>;
    },
    [handleFolderClick, onFileSelect]
  );

  const DocumentActionsCell: React.FC<{
    column: DataTableColumn;
    cellData: DataTableCellData;
  }> = useCallback(
    ({cellData}: {column: DataTableColumn; cellData: DataTableCellData}) => {
      const {filePath, isFolder: isFolderItem} = cellData.value as {
        filePath: string;
        isFolder: boolean;
      };
      if (isFolderItem) {
        if (!allowDelete) {
          return null;
        }
        return (
          <Box alignItems="center" direction="row" gap={1} justifyContent="end">
            <IconButton
              accessibilityLabel="Delete folder"
              confirmationText="Delete this folder and all its contents?"
              iconName="trash"
              onClick={() => handleDeleteFolder(filePath)}
              tooltipText="Delete folder"
              variant="destructive"
              withConfirmation
            />
          </Box>
        );
      }
      return (
        <Box alignItems="center" direction="row" gap={1} justifyContent="end">
          {Platform.OS === "web" && (
            <IconButton
              accessibilityLabel="Download"
              iconName="download"
              onClick={() => handleDownload(filePath)}
              tooltipText="Download"
              variant="muted"
            />
          )}
          {allowDelete && (
            <IconButton
              accessibilityLabel="Delete"
              confirmationText="Are you sure you want to delete this file?"
              iconName="trash"
              onClick={() => handleDelete(filePath)}
              tooltipText="Delete"
              variant="destructive"
              withConfirmation
            />
          )}
        </Box>
      );
    },
    [handleDownload, handleDelete, handleDeleteFolder, allowDelete]
  );

  const customColumnComponentMap: DataTableCustomComponentMap = useMemo(
    () => ({
      [ACTIONS_COLUMN_TYPE]: DocumentActionsCell,
      [NAME_COLUMN_TYPE]: DocumentNameCell,
    }),
    [DocumentActionsCell, DocumentNameCell]
  );

  const columns: DataTableColumn[] = useMemo(
    () => [
      {columnType: NAME_COLUMN_TYPE, sortable: false, title: "Name", width: 300},
      {columnType: "text", sortable: false, title: "Size", width: 100},
      {columnType: "text", sortable: false, title: "Type", width: 150},
      {columnType: "text", sortable: false, title: "Updated", width: 180},
      {columnType: ACTIONS_COLUMN_TYPE, sortable: false, title: "", width: 100},
    ],
    []
  );

  const tableData = useMemo(() => {
    const rows: DataTableCellData[][] = [];

    for (const folder of listData?.folders ?? []) {
      const folderName = folder.split("/").filter(Boolean).pop() ?? folder;
      rows.push([
        {value: {folder, isFolder: true, name: `${folderName}/`}},
        {value: "\u2014"},
        {value: "Folder"},
        {value: ""},
        {value: {filePath: folder, isFolder: true}},
      ]);
    }

    for (const file of listData?.files ?? []) {
      rows.push([
        {value: {file, isFolder: false, name: file.name}},
        {value: formatFileSize(file.size)},
        {value: file.contentType ?? "Unknown"},
        {value: file.updated ? formatDate(file.updated) : ""},
        {value: {filePath: file.fullPath, isFolder: false}},
      ]);
    }

    return rows;
  }, [listData]);

  const headerRow = (
    <Box alignItems="center" direction="row" padding={2}>
      {/* Breadcrumbs */}
      <Box alignItems="center" direction="row" flex="grow" gap={1} wrap>
        {breadcrumbs.map((crumb, index) => (
          <Box direction="row" gap={1} key={crumb.prefix || "root"}>
            {index > 0 && <Text color="secondaryDark">/</Text>}
            {index === breadcrumbs.length - 1 ? (
              <Text bold>{crumb.label}</Text>
            ) : (
              <Link onClick={() => handleBreadcrumbClick(crumb.prefix)} text={crumb.label} />
            )}
          </Box>
        ))}
      </Box>

      {/* Action buttons */}
      <Box alignItems="center" direction="row" gap={1}>
        {Platform.OS === "web" && allowUpload && (
          <>
            <input
              accept="*/*"
              onChange={handleFileChange}
              ref={fileInputRef}
              style={{display: "none"}}
              type="file"
            />
            <IconButton
              accessibilityLabel="Upload file"
              iconName="cloud-arrow-up"
              loading={isUploading}
              onClick={handleUploadClick}
              testID="document-upload-button"
              tooltipText="Upload file"
              variant="muted"
            />
          </>
        )}
        {allowUpload && (
          <IconButton
            accessibilityLabel="New folder"
            iconName="folder-plus"
            onClick={() => setShowNewFolderModal(true)}
            testID="document-new-folder-button"
            tooltipText="New folder"
            variant="muted"
          />
        )}
        <IconButton
          accessibilityLabel="Refresh"
          iconName="rotate"
          onClick={handleRefresh}
          testID="document-refresh-button"
          tooltipText="Refresh"
          variant="muted"
        />
        {onSettingsPress && (
          <IconButton
            accessibilityLabel="Storage settings"
            iconName="gear"
            onClick={onSettingsPress}
            testID="document-settings-button"
            variant="muted"
          />
        )}
      </Box>
    </Box>
  );

  const renderContent = () => {
    if (isNotConfigured) {
      return (
        <Box alignItems="center" gap={3} padding={6}>
          <Text color="error">Storage is not configured.</Text>
          {onSettingsPress && (
            <Button
              iconName="gear"
              onClick={onSettingsPress}
              text="Open Settings"
              variant="secondary"
            />
          )}
        </Box>
      );
    }
    if (isLoading) {
      return (
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      );
    }
    if (isError) {
      return (
        <Box alignItems="center" padding={6}>
          <Text color="error">Failed to load files. Please try again.</Text>
        </Box>
      );
    }
    if (tableData.length === 0) {
      return (
        <Box alignItems="center" padding={6}>
          <Text color="secondaryDark">No files found.</Text>
        </Box>
      );
    }
    return (
      <DataTable
        columns={columns}
        customColumnComponentMap={customColumnComponentMap}
        data={tableData}
      />
    );
  };

  return (
    <AdminScreenPage
      backButton={backButton}
      backHref={backHref}
      color="transparent"
      maxWidth="100%"
      padding={0}
      title={title}
    >
      {headerRow}
      {uploadError && (
        <Box paddingX={4} paddingY={2} testID="document-upload-error">
          <Text color="error">{uploadError}</Text>
        </Box>
      )}
      {renderContent()}

      <Modal
        onDismiss={handleNewFolderModalDismiss}
        primaryButtonOnClick={handleCreateFolder}
        primaryButtonText="Create"
        secondaryButtonOnClick={handleNewFolderModalDismiss}
        secondaryButtonText="Cancel"
        size="sm"
        title="New Folder"
        visible={showNewFolderModal}
      >
        <Box gap={3}>
          <TextField
            disabled={isCreatingFolder}
            onChange={setNewFolderName}
            placeholder="folder-name"
            testID="new-folder-name-input"
            title="Folder Name"
            value={newFolderName}
          />
        </Box>
      </Modal>
    </AdminScreenPage>
  );
};
