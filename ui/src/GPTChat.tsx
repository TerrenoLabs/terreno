import {DateTime} from "luxon";
import React, {useCallback, useEffect, useRef, useState} from "react";
import {
  Platform,
  Image as RNImage,
  type ScrollView as RNScrollView,
  type TextInput as RNTextInput,
} from "react-native";

import {AttachmentPreview} from "./AttachmentPreview";
import {Box} from "./Box";
import {Button} from "./Button";
import {DropdownMenuItem} from "./DropdownMenuItem";
import {DropdownPanel} from "./DropdownPanel";
import type {SelectedFile} from "./FilePickerButton";
import {FilePickerButton} from "./FilePickerButton";
import {Heading} from "./Heading";
import {Icon} from "./Icon";
import {IconButton} from "./IconButton";
import {MarkdownView} from "./MarkdownView";
import {Modal} from "./Modal";
import {SelectField} from "./SelectField";
import {Spinner} from "./Spinner";
import {Text} from "./Text";
import {TextArea} from "./TextArea";
import {TextField} from "./TextField";

// ============================================================
// Content Part Types (mirroring backend types for rendering)
// ============================================================

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image";
  url: string;
  mimeType?: string;
}

export interface FileContentPart {
  type: "file";
  url: string;
  filename?: string;
  mimeType: string;
}

export type MessageContentPart = TextContentPart | ImageContentPart | FileContentPart;

// ============================================================
// Tool Call Types
// ============================================================

export interface ToolCallInfo {
  args: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
}

export interface ToolResultInfo {
  result: unknown;
  toolCallId: string;
  toolName: string;
}

// ============================================================
// Message Types
// ============================================================

export interface GPTChatMessage {
  content: string;
  contentParts?: MessageContentPart[];
  rating?: "up" | "down";
  role: "user" | "assistant" | "system" | "tool-call" | "tool-result";
  toolCall?: ToolCallInfo;
  toolResult?: ToolResultInfo;
}

export interface GPTChatHistory {
  id: string;
  prompts: GPTChatMessage[];
  title?: string;
  updated?: string;
}

export interface MCPServerStatus {
  connected: boolean;
  name: string;
}

export interface MCPToolDetail {
  name: string;
  description?: string;
}

export interface GPTChatProps {
  attachments?: SelectedFile[];
  availableModels?: Array<{label: string; value: string}>;
  currentHistoryId?: string;
  currentMessages: GPTChatMessage[];
  geminiApiKey?: string;
  histories: GPTChatHistory[];
  isStreaming?: boolean;
  /** Available MCP tools to display in the tools panel. */
  mcpTools?: MCPToolDetail[];
  mcpServers?: MCPServerStatus[];
  onAttachFiles?: (files: SelectedFile[]) => void;
  onCreateHistory: () => void;
  onDeleteHistory: (id: string) => void;
  onGeminiApiKeyChange?: (key: string) => void;
  onMemoryEdit?: (memory: string) => void;
  onModelChange?: (modelId: string) => void;
  onRateFeedback?: (promptIndex: number, rating: "up" | "down" | null) => void;
  onRemoveAttachment?: (index: number) => void;
  onSelectHistory: (id: string) => void;
  onSubmit: (prompt: string) => void;
  onUpdateTitle?: (id: string, title: string) => void;
  selectedModel?: string;
  /**
   * Optional consumer-owned character for an empty chat. Terreno does not ship a
   * default mascot — pass an image, icon, Lottie view, or any React node. Hidden
   * once `currentMessages` is non-empty.
   */
  mascot?: React.ReactNode;
  suggestedPrompts?: string[];
  systemMemory?: string;
  testID?: string;
}

// ============================================================
// Small helper components to replace ternaries
// ============================================================

const ExpandableContent = ({
  children,
  isExpanded,
}: {
  children: React.ReactNode;
  isExpanded: boolean;
}): React.ReactElement | null => {
  if (!isExpanded) {
    return null;
  }
  return <>{children}</>;
};

const ToolCallCard = ({toolCall}: {toolCall: ToolCallInfo}): React.ReactElement => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Box border="default" padding={2} rounding="md">
      <Box
        accessibilityHint="Toggle tool call details"
        accessibilityLabel={`Tool: ${toolCall.toolName}`}
        alignItems="center"
        direction="row"
        gap={1}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Icon iconName="wrench" size="xs" />
        <Text bold size="sm">
          Tool: {toolCall.toolName}
        </Text>
        <Icon iconName={isExpanded ? "chevron-up" : "chevron-down"} size="xs" />
      </Box>
      <ExpandableContent isExpanded={isExpanded}>
        <Box marginTop={1} padding={1}>
          <Text color="secondaryDark" size="sm">
            {JSON.stringify(toolCall.args, null, 2)}
          </Text>
        </Box>
      </ExpandableContent>
    </Box>
  );
};

const ToolResultText = ({result}: {result: unknown}): React.ReactElement => {
  if (typeof result === "string") {
    return (
      <Text color="secondaryDark" size="sm">
        {result}
      </Text>
    );
  }
  return (
    <Text color="secondaryDark" size="sm">
      {JSON.stringify(result, null, 2)}
    </Text>
  );
};

const ToolResultCard = ({toolResult}: {toolResult: ToolResultInfo}): React.ReactElement => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Box border="default" padding={2} rounding="md">
      <Box
        accessibilityHint="Toggle tool result details"
        accessibilityLabel={`Result: ${toolResult.toolName}`}
        alignItems="center"
        direction="row"
        gap={1}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Icon iconName="check" size="xs" />
        <Text bold size="sm">
          Result: {toolResult.toolName}
        </Text>
        <Icon iconName={isExpanded ? "chevron-up" : "chevron-down"} size="xs" />
      </Box>
      <ExpandableContent isExpanded={isExpanded}>
        <Box marginTop={1} padding={1}>
          <ToolResultText result={toolResult.result} />
        </Box>
      </ExpandableContent>
    </Box>
  );
};

const handleDownloadFile = (url: string, filename: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const getImageFilename = (part: ImageContentPart): string => {
  const extension = IMAGE_EXTENSIONS[part.mimeType ?? ""] ?? "png";
  return `image-${DateTime.now().toMillis()}.${extension}`;
};

// Browsers reliably accept only PNG on the clipboard, so other formats are redrawn as PNG.
const convertBlobToPng = async (blob: Blob): Promise<Blob> => {
  if (blob.type === "image/png") {
    return blob;
  }
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("PNG conversion failed"))));
  });
};

/** Copies the image itself (not a text placeholder) to the clipboard. */
const copyImageToClipboard = async (part: ImageContentPart): Promise<void> => {
  if (Platform.OS === "web") {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      console.warn("Copying images is not supported in this browser");
      return;
    }
    const response = await fetch(part.url);
    const png = await convertBlobToPng(await response.blob());
    await navigator.clipboard.write([new ClipboardItem({"image/png": png})]);
    return;
  }
  const Clipboard = await import("expo-clipboard");
  const base64 = part.url.startsWith("data:") ? part.url.split(",")[1] : undefined;
  if (base64) {
    await Clipboard.setImageAsync(base64);
  } else {
    await Clipboard.setStringAsync(part.url);
  }
};

const ImageActions = ({part}: {part: ImageContentPart}): React.ReactElement => {
  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await copyImageToClipboard(part);
    } catch (error) {
      console.warn("Failed to copy image", error);
    }
  }, [part]);

  const handleDownload = useCallback((): void => {
    handleDownloadFile(part.url, getImageFilename(part));
  }, [part]);

  return (
    <Box direction="row" gap={1} testID="gpt-image-actions">
      <IconButton
        accessibilityLabel="Copy image"
        iconName="copy"
        onClick={handleCopy}
        testID="gpt-copy-image"
        variant="ghost"
      />
      {Platform.OS === "web" ? (
        <IconButton
          accessibilityLabel="Download image"
          iconName="download"
          onClick={handleDownload}
          testID="gpt-download-image"
          variant="ghost"
        />
      ) : null}
    </Box>
  );
};

const MessageContentParts = ({parts}: {parts: MessageContentPart[]}): React.ReactElement => {
  return (
    <Box gap={2}>
      {parts.map((part, index) => {
        if (part.type === "image") {
          return (
            <Box gap={1} key={`content-${index}`}>
              <RNImage
                resizeMode="contain"
                source={{uri: part.url}}
                style={{borderRadius: 8, height: 400, maxWidth: 800, minWidth: 400, width: "100%"}}
              />
              <ImageActions part={part} />
            </Box>
          );
        }
        if (part.type === "file") {
          const hasDownloadableUrl = part.url?.startsWith("data:") || part.url?.startsWith("http");
          const filename = part.filename ?? "File";
          const isPdf = part.mimeType === "application/pdf";
          const iconName = isPdf ? "file-pdf" : "file";

          if (hasDownloadableUrl) {
            return (
              <Box
                accessibilityHint="Download this file"
                accessibilityLabel={`File: ${filename}`}
                alignItems="center"
                border="default"
                direction="row"
                gap={1}
                key={`content-${index}`}
                onClick={() => handleDownloadFile(part.url, filename)}
                padding={2}
                rounding="md"
              >
                <Icon iconName={iconName} size="sm" />
                <Text size="sm">{filename}</Text>
                <Icon iconName="download" size="xs" />
              </Box>
            );
          }

          return (
            <Box
              alignItems="center"
              border="default"
              direction="row"
              gap={1}
              key={`content-${index}`}
              padding={2}
              rounding="md"
            >
              <Icon iconName={iconName} size="sm" />
              <Text size="sm">{filename}</Text>
            </Box>
          );
        }
        return null;
      })}
    </Box>
  );
};

const MCPServerList = ({servers}: {servers: MCPServerStatus[]}): React.ReactElement => {
  return (
    <Box border="default" marginTop={1} padding={2} position="absolute" rounding="md">
      {servers.map((server) => (
        <Box alignItems="center" direction="row" gap={1} key={server.name} padding={1}>
          <Box
            color={server.connected ? "success" : "error"}
            height={6}
            rounding="circle"
            width={6}
          />
          <Text size="sm">{server.name}</Text>
        </Box>
      ))}
    </Box>
  );
};

const MCPStatusIndicator = ({servers}: {servers: MCPServerStatus[]}): React.ReactElement => {
  const [showList, setShowList] = useState(false);
  const connectedCount = servers.filter((s) => s.connected).length;

  return (
    <Box>
      <Box
        accessibilityHint="Show MCP server list"
        accessibilityLabel="MCP server status"
        alignItems="center"
        direction="row"
        gap={1}
        onClick={() => setShowList(!showList)}
      >
        <Box
          color={connectedCount > 0 ? "success" : "error"}
          height={8}
          rounding="circle"
          width={8}
        />
        <Text color="secondaryDark" size="sm">
          {connectedCount}/{servers.length} MCP
        </Text>
      </Box>
      <ExpandableContent isExpanded={showList}>
        <MCPServerList servers={servers} />
      </ExpandableContent>
    </Box>
  );
};

const SidebarModelSelector = ({
  availableModels,
  onModelChange,
  selectedModel,
}: {
  availableModels?: Array<{label: string; value: string}>;
  onModelChange?: (modelId: string) => void;
  selectedModel?: string;
}): React.ReactElement | null => {
  if (!availableModels || availableModels.length === 0 || !onModelChange) {
    return null;
  }
  return (
    <Box marginBottom={2}>
      <SelectField
        onChange={onModelChange}
        options={availableModels}
        requireValue
        value={selectedModel ?? availableModels[0]?.value ?? ""}
      />
    </Box>
  );
};

const SidebarToolbarButtons = ({
  mcpServers,
  onGeminiApiKeyChange,
  onMemoryEdit,
  handleOpenApiKeyModal,
  systemMemory,
}: {
  handleOpenApiKeyModal: () => void;
  mcpServers?: MCPServerStatus[];
  onGeminiApiKeyChange?: (key: string) => void;
  onMemoryEdit?: (memory: string) => void;
  systemMemory?: string;
}): React.ReactElement => {
  return (
    <>
      <MCPServersButton servers={mcpServers} />
      <ApiKeyButton
        handleOpenApiKeyModal={handleOpenApiKeyModal}
        onGeminiApiKeyChange={onGeminiApiKeyChange}
      />
      <MemoryButton onMemoryEdit={onMemoryEdit} systemMemory={systemMemory} />
    </>
  );
};

const MCPServersButton = ({servers}: {servers?: MCPServerStatus[]}): React.ReactElement | null => {
  if (!servers || servers.length === 0) {
    return null;
  }
  return <MCPStatusIndicator servers={servers} />;
};

const ApiKeyButton = ({
  handleOpenApiKeyModal,
  onGeminiApiKeyChange,
}: {
  handleOpenApiKeyModal: () => void;
  onGeminiApiKeyChange?: (key: string) => void;
}): React.ReactElement | null => {
  if (!onGeminiApiKeyChange) {
    return null;
  }
  return (
    <IconButton
      accessibilityLabel="Set Gemini API key"
      iconName="key"
      onClick={handleOpenApiKeyModal}
      testID="gpt-api-key-button"
    />
  );
};

const MemoryButton = ({
  onMemoryEdit,
  systemMemory,
}: {
  onMemoryEdit?: (memory: string) => void;
  systemMemory?: string;
}): React.ReactElement | null => {
  if (!onMemoryEdit) {
    return null;
  }
  return (
    <IconButton
      accessibilityLabel="Edit system memory"
      iconName="gear"
      onClick={() => onMemoryEdit(systemMemory ?? "")}
      testID="gpt-memory-button"
    />
  );
};

const HistoryItemTitle = ({
  currentHistoryId,
  editingHistoryId,
  editingTitle,
  handleFinishRename,
  history,
  setEditingTitle,
}: {
  currentHistoryId?: string;
  editingHistoryId: string | null;
  editingTitle: string;
  handleFinishRename: () => void;
  history: GPTChatHistory;
  setEditingTitle: (title: string) => void;
}): React.ReactElement => {
  if (editingHistoryId === history.id) {
    return (
      <Box flex="grow" marginRight={1}>
        <TextField
          onBlur={handleFinishRename}
          onChange={setEditingTitle}
          onEnter={handleFinishRename}
          testID={`gpt-rename-input-${history.id}`}
          value={editingTitle}
        />
      </Box>
    );
  }
  return (
    <Box flex="grow" minWidth={0}>
      <Text color={history.id === currentHistoryId ? "inverted" : "primary"} size="sm" truncate>
        {history.title ?? "New Chat"}
      </Text>
    </Box>
  );
};

const HistoryItemActions = ({
  editingHistoryId,
  handleFinishRename,
  handleStartRename,
  history,
  isSelected,
  onDeleteHistory,
  onUpdateTitle,
}: {
  editingHistoryId: string | null;
  handleFinishRename: () => void;
  handleStartRename: (id: string, title: string) => void;
  history: GPTChatHistory;
  isSelected: boolean;
  onDeleteHistory: (id: string) => void;
  onUpdateTitle?: (id: string, title: string) => void;
}): React.ReactElement => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const title = history.title ?? "New Chat";

  const handleRename = useCallback((): void => {
    setIsMenuOpen(false);
    handleStartRename(history.id, history.title ?? "");
  }, [handleStartRename, history.id, history.title]);

  const handleDelete = useCallback((): void => {
    setIsMenuOpen(false);
    onDeleteHistory(history.id);
  }, [history.id, onDeleteHistory]);

  if (editingHistoryId === history.id) {
    return (
      <IconButton
        accessibilityLabel="Save title"
        iconName="check"
        onClick={handleFinishRename}
        testID={`gpt-rename-save-${history.id}`}
      />
    );
  }

  return (
    <DropdownPanel
      align="auto"
      isOpen={isMenuOpen}
      onOpenChange={setIsMenuOpen}
      renderTrigger={({toggle}) => (
        <IconButton
          accessibilityLabel={`Chat actions: ${title}`}
          iconName="ellipsis-vertical"
          onClick={toggle}
          testID={`gpt-history-menu-${history.id}`}
          variant={isSelected ? "primary" : "ghost"}
        />
      )}
      showActionButtons={false}
      testID={`gpt-history-menu-panel-${history.id}`}
      width={180}
    >
      <Box gap={1}>
        {onUpdateTitle ? (
          <DropdownMenuItem
            accessibilityLabel={`Rename chat: ${title}`}
            iconName="pen-to-square"
            label="Rename"
            onClick={handleRename}
            testID={`gpt-rename-history-${history.id}`}
          />
        ) : null}
        <DropdownMenuItem
          accessibilityLabel={`Delete chat: ${title}`}
          color="error"
          iconName="trash-can"
          label="Delete"
          onClick={handleDelete}
          testID={`gpt-delete-history-${history.id}`}
        />
      </Box>
    </DropdownPanel>
  );
};

const ContentPartsPreview = ({
  hasContent,
  parts,
}: {
  hasContent: boolean;
  parts?: MessageContentPart[];
}): React.ReactElement | null => {
  const nonTextParts = parts?.filter((p) => p.type !== "text");
  if (!nonTextParts || nonTextParts.length === 0) {
    return null;
  }
  return (
    <Box marginBottom={hasContent ? 2 : 0}>
      <MessageContentParts parts={nonTextParts} />
    </Box>
  );
};

const MessageText = ({content, role}: {content: string; role: string}): React.ReactElement => {
  if (role === "assistant") {
    return <MarkdownView>{content}</MarkdownView>;
  }
  return <Text color={role === "user" ? "inverted" : "primary"}>{content}</Text>;
};

const RatingButtons = ({
  index,
  onRateFeedback,
  rating,
}: {
  index: number;
  onRateFeedback?: (promptIndex: number, rating: "up" | "down" | null) => void;
  rating?: "up" | "down";
}): React.ReactElement | null => {
  if (!onRateFeedback) {
    return null;
  }
  return (
    <>
      <IconButton
        accessibilityLabel="Thumbs up"
        iconName="thumbs-up"
        onClick={() => onRateFeedback(index, rating === "up" ? null : "up")}
        testID={`gpt-rate-up-${index}`}
        variant={rating === "up" ? "primary" : "muted"}
      />
      <IconButton
        accessibilityLabel="Thumbs down"
        iconName="thumbs-down"
        onClick={() => onRateFeedback(index, rating === "down" ? null : "down")}
        testID={`gpt-rate-down-${index}`}
        variant={rating === "down" ? "primary" : "muted"}
      />
    </>
  );
};

const AssistantActions = ({
  handleCopyMessage,
  index,
  message,
  onRateFeedback,
}: {
  handleCopyMessage: (message: GPTChatMessage) => void;
  index: number;
  message: GPTChatMessage;
  onRateFeedback?: (promptIndex: number, rating: "up" | "down" | null) => void;
}): React.ReactElement | null => {
  if (message.role !== "assistant") {
    return null;
  }
  return (
    <Box alignItems="end" direction="row" gap={1} justifyContent="end" marginTop={1}>
      <RatingButtons index={index} onRateFeedback={onRateFeedback} rating={message.rating} />
      <IconButton
        accessibilityLabel="Copy message"
        iconName="copy"
        onClick={() => handleCopyMessage(message)}
        testID={`gpt-copy-msg-${index}`}
      />
    </Box>
  );
};

const EmptyChatHero = ({
  handleSuggestedPrompt,
  isStreaming,
  mascot,
  suggestedPrompts,
  viewportHeight,
}: {
  handleSuggestedPrompt: (prompt: string) => void;
  isStreaming: boolean;
  mascot?: React.ReactNode;
  suggestedPrompts?: string[];
  viewportHeight: number;
}): React.ReactElement | null => {
  const hasSuggestedPrompts = Boolean(suggestedPrompts && suggestedPrompts.length > 0);
  if (!mascot && !hasSuggestedPrompts && !isStreaming) {
    return null;
  }
  return (
    <Box
      alignItems="center"
      flex="grow"
      justifyContent="center"
      padding={4}
      testID="gpt-empty-state"
      {...(viewportHeight > 0 ? {minHeight: viewportHeight} : {})}
    >
      <Box alignItems="center" gap={5} maxWidth={640} width="100%">
        {mascot ? (
          <Box alignItems="center" testID="gpt-mascot">
            {mascot}
          </Box>
        ) : null}
        {hasSuggestedPrompts ? (
          <Box alignItems="center" gap={3} width="100%">
            <Text color="secondaryDark" size="sm">
              Try asking...
            </Text>
            <Box direction="row" gap={2} justifyContent="center" wrap={true}>
              {suggestedPrompts?.map((prompt) => (
                <Box
                  accessibilityHint="Send this suggested prompt"
                  accessibilityLabel={prompt}
                  border="default"
                  key={prompt}
                  onClick={() => handleSuggestedPrompt(prompt)}
                  paddingX={3}
                  paddingY={2}
                  rounding="lg"
                >
                  <Text size="sm">{prompt}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        ) : null}
      </Box>
      <StreamingIndicator isStreaming={isStreaming} />
    </Box>
  );
};

const MessageList = ({
  currentMessages,
  handleCopyMessage,
  onRateFeedback,
}: {
  currentMessages: GPTChatMessage[];
  handleCopyMessage: (message: GPTChatMessage) => void;
  onRateFeedback?: (promptIndex: number, rating: "up" | "down" | null) => void;
}): React.ReactElement => {
  return (
    <>
      {currentMessages.map((message, index) => {
        if (message.role === "tool-call" && message.toolCall) {
          return (
            <Box alignItems="start" key={`msg-${index}`} maxWidth="80%">
              <ToolCallCard toolCall={message.toolCall} />
            </Box>
          );
        }
        if (message.role === "tool-result" && message.toolResult) {
          return (
            <Box alignItems="start" key={`msg-${index}`} maxWidth="80%">
              <ToolResultCard toolResult={message.toolResult} />
            </Box>
          );
        }

        const hasImages = message.contentParts?.some((p) => p.type === "image");
        return (
          <Box alignItems={message.role === "user" ? "end" : "start"} key={`msg-${index}`}>
            <Box
              color={message.role === "user" ? "primary" : "neutralLight"}
              maxWidth={hasImages ? "90%" : "80%"}
              padding={3}
              rounding="lg"
            >
              <ContentPartsPreview
                hasContent={Boolean(message.content)}
                parts={message.contentParts}
              />
              <MessageText content={message.content} role={message.role} />
              <AssistantActions
                handleCopyMessage={handleCopyMessage}
                index={index}
                message={message}
                onRateFeedback={onRateFeedback}
              />
            </Box>
          </Box>
        );
      })}
    </>
  );
};

const StreamingIndicator = ({isStreaming}: {isStreaming: boolean}): React.ReactElement | null => {
  if (!isStreaming) {
    return null;
  }
  return (
    <Box alignItems="start" padding={2} testID="gpt-streaming-indicator">
      <Spinner size="sm" />
    </Box>
  );
};

const ScrollToBottomButton = ({
  isScrolledUp,
  scrollToBottom,
}: {
  isScrolledUp: boolean;
  scrollToBottom: () => void;
}): React.ReactElement | null => {
  if (!isScrolledUp) {
    return null;
  }
  return (
    <Box alignItems="center" marginBottom={2}>
      <Button
        iconName="arrow-down"
        onClick={scrollToBottom}
        text="Scroll to bottom"
        variant="outline"
      />
    </Box>
  );
};

const AttachmentSection = ({
  attachments,
  onRemoveAttachment,
}: {
  attachments: SelectedFile[];
  onRemoveAttachment?: (index: number) => void;
}): React.ReactElement | null => {
  if (attachments.length === 0 || !onRemoveAttachment) {
    return null;
  }
  return <AttachmentPreview attachments={attachments} onRemove={onRemoveAttachment} />;
};

const AttachButton = ({
  handleFilesSelected,
  isStreaming,
  onAttachFiles,
}: {
  handleFilesSelected: (files: SelectedFile[]) => void;
  isStreaming: boolean;
  onAttachFiles?: (files: SelectedFile[]) => void;
}): React.ReactElement | null => {
  if (!onAttachFiles) {
    return null;
  }
  return (
    <FilePickerButton
      disabled={isStreaming}
      onFilesSelected={handleFilesSelected}
      testID="gpt-attach-button"
    />
  );
};

const ToolsModal = ({
  isVisible,
  mcpTools,
  onDismiss,
}: {
  isVisible: boolean;
  mcpTools: MCPToolDetail[];
  onDismiss: () => void;
}): React.ReactElement => {
  return (
    <Modal onDismiss={onDismiss} size="md" title="Available Tools" visible={isVisible}>
      <Box gap={2} padding={3}>
        {mcpTools.length === 0 ? (
          <Text color="secondaryDark" size="sm">
            No tools available.
          </Text>
        ) : (
          mcpTools.map((tool) => (
            <Box border="default" gap={1} key={tool.name} padding={3} rounding="md">
              <Box alignItems="center" direction="row" gap={2}>
                <Icon iconName="wrench" size="xs" />
                <Text bold size="sm">
                  {tool.name}
                </Text>
              </Box>
              {tool.description && (
                <Text color="secondaryDark" size="sm">
                  {tool.description}
                </Text>
              )}
            </Box>
          ))
        )}
      </Box>
    </Modal>
  );
};

const ApiKeyModal = ({
  apiKeyDraft,
  handleSaveApiKey,
  isVisible,
  onDismiss,
  onGeminiApiKeyChange,
  setApiKeyDraft,
}: {
  apiKeyDraft: string;
  handleSaveApiKey: () => void;
  isVisible: boolean;
  onDismiss: () => void;
  onGeminiApiKeyChange?: (key: string) => void;
  setApiKeyDraft: (key: string) => void;
}): React.ReactElement | null => {
  if (!onGeminiApiKeyChange) {
    return null;
  }
  return (
    <Modal
      onDismiss={onDismiss}
      primaryButtonOnClick={handleSaveApiKey}
      primaryButtonText="Save"
      secondaryButtonOnClick={onDismiss}
      secondaryButtonText="Cancel"
      size="sm"
      subtitle="Provide your own Gemini API key for AI requests."
      title="Gemini API Key"
      visible={isVisible}
    >
      <Box padding={2}>
        <TextField
          onChange={setApiKeyDraft}
          placeholder="Enter Gemini API key..."
          testID="gpt-api-key-input"
          type="password"
          value={apiKeyDraft}
        />
      </Box>
    </Modal>
  );
};

// ============================================================
// Main Component
// ============================================================

/** Pixels of content below the viewport before "Scroll to bottom" appears. */
const SCROLL_TO_BOTTOM_THRESHOLD = 100;
/** Height the composer grows to before its text scrolls. */
const COMPOSER_MAX_HEIGHT = 200;

export const GPTChat = ({
  attachments = [],
  availableModels,
  currentHistoryId,
  currentMessages,
  geminiApiKey,
  histories,
  isStreaming = false,
  mcpTools,
  mcpServers,
  onAttachFiles,
  onCreateHistory,
  onDeleteHistory,
  onGeminiApiKeyChange,
  onMemoryEdit,
  onModelChange,
  onRateFeedback,
  onRemoveAttachment,
  onSelectHistory,
  onSubmit,
  onUpdateTitle,
  selectedModel,
  mascot,
  suggestedPrompts,
  systemMemory,
  testID,
}: GPTChatProps): React.ReactElement => {
  const [inputValue, setInputValue] = useState("");
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const scrollViewRef = useRef<RNScrollView>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const contentHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [isApiKeyModalVisible, setIsApiKeyModalVisible] = useState(false);
  const [isToolsModalVisible, setIsToolsModalVisible] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(geminiApiKey ?? "");

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) {
      return;
    }
    setIsScrolledUp(false);
    onSubmit(trimmed);
    setInputValue("");
  }, [inputValue, isStreaming, onSubmit]);

  // On web: Enter sends, Shift+Enter inserts a new line
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
  // Attach keydown listener directly to the textarea element for reliable Enter-to-send.
  // Tracked in state (not a ref) so the effect re-runs when the textarea remounts.
  const [inputElement, setInputElement] = useState<HTMLElement | null>(null);

  // On React Native Web the TextInput ref is the underlying DOM element.
  const handleInputRef = useCallback((ref: RNTextInput | null) => {
    setInputElement(ref as unknown as HTMLElement | null);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }
    const el = inputElement;
    if (!el) {
      return;
    }
    const handler = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== "Enter") {
        return;
      }
      if (ke.shiftKey || ke.metaKey) {
        return;
      }
      e.preventDefault();
      handleSubmitRef.current();
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [inputElement]);

  // Image-only replies have no meaningful text, so copy the image instead of a placeholder.
  const handleCopyMessage = useCallback(async (message: GPTChatMessage) => {
    const firstImage = message.contentParts?.find(
      (part): part is ImageContentPart => part.type === "image"
    );
    if (firstImage && !message.content.trim()) {
      try {
        await copyImageToClipboard(firstImage);
      } catch (error) {
        console.warn("Failed to copy image", error);
      }
      return;
    }
    const Clipboard = await import("expo-clipboard");
    await Clipboard.setStringAsync(message.content);
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollViewRef.current?.scrollToEnd({animated: true});
    setIsScrolledUp(false);
  }, []);

  const handleFilesSelected = useCallback(
    (files: SelectedFile[]) => {
      onAttachFiles?.(files);
    },
    [onAttachFiles]
  );

  const handleScroll = useCallback((offsetY: number) => {
    scrollOffsetRef.current = offsetY;
    const distanceFromBottom = contentHeightRef.current - offsetY - viewportHeightRef.current;
    setIsScrolledUp(distanceFromBottom > SCROLL_TO_BOTTOM_THRESHOLD);
  }, []);

  // Growing content (a streaming reply) must not count as the user scrolling up, but content
  // that shrinks to fit the viewport (switching to a short or empty chat) clears the flag.
  const handleContentLayout = useCallback(
    (event: {nativeEvent: {layout: {height: number; width: number; x: number; y: number}}}) => {
      contentHeightRef.current = event.nativeEvent.layout.height;
      if (contentHeightRef.current <= viewportHeightRef.current + SCROLL_TO_BOTTOM_THRESHOLD) {
        setIsScrolledUp(false);
      }
    },
    []
  );

  const handleViewportLayout = useCallback(
    (event: {nativeEvent: {layout: {height: number; width: number; x: number; y: number}}}) => {
      const nextHeight = event.nativeEvent.layout.height;
      viewportHeightRef.current = nextHeight;
      setViewportHeight(nextHeight);
    },
    []
  );

  const [scrollTrigger, setScrollTrigger] = useState(0);
  const prevMessagesRef = useRef(currentMessages);

  if (
    currentMessages !== prevMessagesRef.current &&
    (currentMessages.length !== prevMessagesRef.current.length ||
      currentMessages[currentMessages.length - 1]?.content !==
        prevMessagesRef.current[prevMessagesRef.current.length - 1]?.content)
  ) {
    prevMessagesRef.current = currentMessages;
    setScrollTrigger((prev) => prev + 1);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollTrigger is intentionally used to trigger scroll on message changes
  useEffect(() => {
    if (!isScrolledUp) {
      scrollToBottom();
    }
  }, [scrollTrigger, isScrolledUp, scrollToBottom]);

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    renameSavedRef.current = false;
    setEditingHistoryId(id);
    setEditingTitle(currentTitle || "");
  }, []);

  const renameSavedRef = useRef(false);

  const handleFinishRename = useCallback(() => {
    if (renameSavedRef.current) {
      return;
    }
    renameSavedRef.current = true;
    if (editingHistoryId && editingTitle.trim()) {
      onUpdateTitle?.(editingHistoryId, editingTitle.trim());
    }
    setEditingHistoryId(null);
    setEditingTitle("");
  }, [editingHistoryId, editingTitle, onUpdateTitle]);

  const handleSuggestedPrompt = useCallback(
    (prompt: string) => {
      if (isStreaming) {
        return;
      }
      onSubmit(prompt);
    },
    [isStreaming, onSubmit]
  );

  const handleOpenApiKeyModal = useCallback(() => {
    setApiKeyDraft(geminiApiKey ?? "");
    setIsApiKeyModalVisible(true);
  }, [geminiApiKey]);

  const handleSaveApiKey = useCallback(() => {
    onGeminiApiKeyChange?.(apiKeyDraft);
    setIsApiKeyModalVisible(false);
  }, [apiKeyDraft, onGeminiApiKeyChange]);

  const isEmptyChat = currentMessages.length === 0;

  return (
    <Box direction="row" flex="grow" testID={testID}>
      {/* Sidebar */}
      <Box border="default" color="base" minWidth={250} overflow="scrollY" padding={3} width="30%">
        <SidebarModelSelector
          availableModels={availableModels}
          onModelChange={onModelChange}
          selectedModel={selectedModel}
        />

        <Box alignItems="center" direction="row" justifyContent="between" marginBottom={3}>
          <Heading size="sm">Chats</Heading>
          <Box direction="row" gap={1}>
            <SidebarToolbarButtons
              handleOpenApiKeyModal={handleOpenApiKeyModal}
              mcpServers={mcpServers}
              onGeminiApiKeyChange={onGeminiApiKeyChange}
              onMemoryEdit={onMemoryEdit}
              systemMemory={systemMemory}
            />
            <IconButton
              accessibilityLabel="New chat"
              iconName="plus"
              onClick={onCreateHistory}
              testID="gpt-new-chat-button"
            />
          </Box>
        </Box>

        {histories.map((history) => (
          <Box
            accessibilityHint="Opens this chat history"
            accessibilityLabel={`Select chat: ${history.title ?? "New Chat"}`}
            alignItems="center"
            color={history.id === currentHistoryId ? "primary" : undefined}
            direction="row"
            justifyContent="between"
            key={history.id}
            marginBottom={1}
            onClick={() => onSelectHistory(history.id)}
            padding={2}
            rounding="md"
          >
            <HistoryItemTitle
              currentHistoryId={currentHistoryId}
              editingHistoryId={editingHistoryId}
              editingTitle={editingTitle}
              handleFinishRename={handleFinishRename}
              history={history}
              setEditingTitle={setEditingTitle}
            />
            <Box marginLeft={1}>
              <HistoryItemActions
                editingHistoryId={editingHistoryId}
                handleFinishRename={handleFinishRename}
                handleStartRename={handleStartRename}
                history={history}
                isSelected={history.id === currentHistoryId}
                onDeleteHistory={onDeleteHistory}
                onUpdateTitle={onUpdateTitle}
              />
            </Box>
          </Box>
        ))}
      </Box>

      {/* Chat Panel */}
      <Box direction="column" flex="grow" padding={4}>
        {/* Messages */}
        <Box flex="grow" marginBottom={3} onLayout={handleViewportLayout} testID="gpt-viewport">
          <Box flex="grow" gap={3} onScroll={handleScroll} scroll={true} scrollRef={scrollViewRef}>
            <Box flex="grow" gap={3} onLayout={handleContentLayout} testID="gpt-messages">
              {isEmptyChat ? (
                <EmptyChatHero
                  handleSuggestedPrompt={handleSuggestedPrompt}
                  isStreaming={isStreaming}
                  mascot={mascot}
                  suggestedPrompts={suggestedPrompts}
                  viewportHeight={viewportHeight}
                />
              ) : (
                <>
                  <MessageList
                    currentMessages={currentMessages}
                    handleCopyMessage={handleCopyMessage}
                    onRateFeedback={onRateFeedback}
                  />
                  <StreamingIndicator isStreaming={isStreaming} />
                </>
              )}
            </Box>
          </Box>
        </Box>

        <ScrollToBottomButton
          isScrolledUp={isScrolledUp && !isEmptyChat}
          scrollToBottom={scrollToBottom}
        />
        <AttachmentSection attachments={attachments} onRemoveAttachment={onRemoveAttachment} />

        {/* Input */}
        <Box direction="row" gap={2} testID="gpt-composer">
          {onAttachFiles ? (
            <Box justifyContent="center" testID="gpt-composer-attach">
              <AttachButton
                handleFilesSelected={handleFilesSelected}
                isStreaming={isStreaming}
                onAttachFiles={onAttachFiles}
              />
            </Box>
          ) : null}
          {mcpTools && mcpTools.length > 0 && (
            <Box justifyContent="center" testID="gpt-composer-tools">
              <IconButton
                accessibilityLabel="Show available tools"
                iconName="hammer"
                onClick={() => setIsToolsModalVisible(true)}
                testID="gpt-tools-button"
              />
            </Box>
          )}
          <Box flex="grow" justifyContent="center">
            <TextArea
              blurOnSubmit={false}
              disabled={isStreaming}
              grow
              inputRef={handleInputRef}
              maxHeight={COMPOSER_MAX_HEIGHT}
              onChange={setInputValue}
              placeholder="Type a message..."
              testID="gpt-input"
              value={inputValue}
            />
          </Box>
          <Box justifyContent="center" testID="gpt-composer-send">
            <Button
              disabled={!inputValue.trim() || isStreaming}
              iconName="paper-plane"
              onClick={handleSubmit}
              testID="gpt-submit"
              text="Send"
            />
          </Box>
        </Box>
      </Box>

      <ApiKeyModal
        apiKeyDraft={apiKeyDraft}
        handleSaveApiKey={handleSaveApiKey}
        isVisible={isApiKeyModalVisible}
        onDismiss={() => setIsApiKeyModalVisible(false)}
        onGeminiApiKeyChange={onGeminiApiKeyChange}
        setApiKeyDraft={setApiKeyDraft}
      />
      <ToolsModal
        isVisible={isToolsModalVisible}
        mcpTools={mcpTools ?? []}
        onDismiss={() => setIsToolsModalVisible(false)}
      />
    </Box>
  );
};
