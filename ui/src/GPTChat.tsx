import {
  type AskValidationError,
  askResponseSchema,
  type Block,
  type BlockAction,
  type BlocksDocument,
  parseBlocksPartial,
} from "@terreno/blocks";
import React, {useCallback, useEffect, useRef, useState} from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  type Text as NativeText,
  Platform,
  Image as RNImage,
  type ScrollView as RNScrollView,
  type TextInput as RNTextInput,
  View,
} from "react-native";

import {AttachmentPreview} from "./AttachmentPreview";
import {AskCard} from "./asks/AskCard";
import type {AskFilesResolver} from "./asks/askFileRefs";
import type {AskSubmitHandler, ChatAsk} from "./asks/askTypes";
import {Box} from "./Box";
import {Button} from "./Button";
import {BlocksView} from "./blocks/BlocksView";
import type {BlocksViewProps} from "./Common";
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

export interface BlockChatEvent {
  action: BlockAction;
  blockId: string;
  elementId: string;
  messageId: string;
}

/** What `onBlockCallback` returns. `replace: "block"` swaps that block. `text` appends a message. */
export interface BlockCallbackResult {
  blocks?: Block | BlocksDocument;
  replace?: "block";
  text?: string;
}

export interface GPTChatMessage {
  /**
   * Set on a `tool-call` message when the tool call is an agent ask. The chat renders an `AskCard`
   * instead of the tool call, and hides the ask's `tool-result` message.
   */
  ask?: ChatAsk;
  /** Subtle caption under a block reply, such as "3 components". */
  blockNote?: string;
  content: string;
  /** Stable id for block actions. Falls back to the message index. */
  id?: string;
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
  /** Errors for the last answer to each ask, keyed by tool call id, such as a 400's `fields`. */
  askErrors?: Record<string, AskValidationError[]>;
  attachments?: SelectedFile[];
  availableModels?: Array<{label: string; value: string}>;
  currentHistoryId?: string;
  currentMessages: GPTChatMessage[];
  geminiApiKey?: string;
  histories: GPTChatHistory[];
  /** Callback names the host will run. A callback outside this list is disabled. */
  hostActions?: readonly string[];
  isStreaming?: boolean;
  /** Available MCP tools to display in the tools panel. */
  mcpTools?: MCPToolDetail[];
  mcpServers?: MCPServerStatus[];
  /**
   * Called when the user answers a pending ask. The pressed control shows a loading state until
   * the returned promise settles. Without it, asks are shown but cannot be answered.
   */
  onAskSubmit?: AskSubmitHandler;
  /** `open` and `select`. `reply` calls `onSubmit`. `callback` calls `onBlockCallback`. */
  onBlockAction?: (event: BlockChatEvent) => void;
  /** Runs a callback button. The button stays loading until the promise settles. */
  onBlockCallback?: (
    event: BlockChatEvent
  ) => BlockCallbackResult | Promise<BlockCallbackResult | undefined> | undefined;
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
  /**
   * Turns the files picked for a `files` ask into the answer's refs: uploads (`{fileId}`) or data
   * URLs (`{url}`). Defaults to data URLs. Throw to keep the ask open.
   */
  resolveAskFiles?: AskFilesResolver;
  /** Loads a `ref` dataset while `uiBlocks` is on. */
  resolveDataset?: BlocksViewProps["resolveDataset"];
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
  /**
   * Assistant messages are whole-reply documents. A streaming message renders each finished
   * top-level block and a spinner for the block still arriving.
   */
  uiBlocks?: boolean;
  /** Renders `html` blocks in a sandboxed frame. Off until the host turns it on. */
  allowHtml?: boolean;
  /** Hostnames allowed on https image sources. Empty rejects every https image. */
  imageHosts?: readonly string[];
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

const MessageContentParts = ({parts}: {parts: MessageContentPart[]}): React.ReactElement => {
  return (
    <Box gap={2}>
      {parts.map((part, index) => {
        if (part.type === "image") {
          return (
            <RNImage
              key={`content-${index}`}
              resizeMode="contain"
              source={{uri: part.url}}
              style={{borderRadius: 8, height: 400, maxWidth: 800, minWidth: 400, width: "100%"}}
            />
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
    <Text color={history.id === currentHistoryId ? "inverted" : "primary"} size="sm" truncate>
      {history.title ?? "New Chat"}
    </Text>
  );
};

const HistoryItemActionButton = ({
  editingHistoryId,
  handleFinishRename,
  handleStartRename,
  history,
  onUpdateTitle,
}: {
  editingHistoryId: string | null;
  handleFinishRename: () => void;
  handleStartRename: (id: string, title: string) => void;
  history: GPTChatHistory;
  onUpdateTitle?: (id: string, title: string) => void;
}): React.ReactElement | null => {
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
  if (!onUpdateTitle) {
    return null;
  }
  return (
    <IconButton
      accessibilityLabel={`Rename chat: ${history.title ?? "New Chat"}`}
      iconName="pencil"
      onClick={() => handleStartRename(history.id, history.title ?? "")}
      testID={`gpt-rename-history-${history.id}`}
    />
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

const replacementBlock = (blocks: Block | BlocksDocument): Block | undefined => {
  if ("type" in blocks) {
    return blocks;
  }
  return blocks.blocks[0];
};

const documentFromPartial = (partial: ReturnType<typeof parseBlocksPartial>): BlocksDocument => {
  const doc = {v: 1} as BlocksDocument;
  if (partial.datasets !== undefined) {
    doc.datasets = partial.datasets as BlocksDocument["datasets"];
  }
  doc.blocks = partial.blocks as Block[];
  return doc;
};

const AssistantBlocks = ({
  allowHtml,
  content,
  hostActions,
  imageHosts,
  isPartial,
  messageId,
  onBlockEvent,
  overrides,
  pendingElementIds,
  resolveDataset,
}: {
  allowHtml?: boolean;
  content: string;
  hostActions?: readonly string[];
  imageHosts?: readonly string[];
  isPartial: boolean;
  messageId: string;
  onBlockEvent: (event: BlockChatEvent) => void;
  overrides?: Record<string, Block>;
  pendingElementIds?: readonly string[];
  resolveDataset?: BlocksViewProps["resolveDataset"];
}): React.ReactElement => {
  if (isPartial) {
    const partial = parseBlocksPartial(content);
    return (
      <Box gap={2} testID={`gpt-blocks-${messageId}`}>
        {partial.blocks.length > 0 ? (
          <BlocksView
            allowHtml={allowHtml}
            document={documentFromPartial(partial)}
            hostActions={hostActions}
            imageHosts={imageHosts}
            onAction={(event) =>
              onBlockEvent({
                action: event.action,
                blockId: event.blockId,
                elementId: event.elementId,
                messageId,
              })
            }
            overrides={overrides}
            pendingElementIds={pendingElementIds}
            resolveDataset={resolveDataset}
            streaming
          />
        ) : null}
        {partial.pending ? (
          <Box testID="gpt-blocks-pending">
            <Spinner size="sm" />
          </Box>
        ) : null}
      </Box>
    );
  }
  return (
    <BlocksView
      allowHtml={allowHtml}
      document={content}
      hostActions={hostActions}
      imageHosts={imageHosts}
      onAction={(event) =>
        onBlockEvent({
          action: event.action,
          blockId: event.blockId,
          elementId: event.elementId,
          messageId,
        })
      }
      overrides={overrides}
      pendingElementIds={pendingElementIds}
      resolveDataset={resolveDataset}
      testID={`gpt-blocks-${messageId}`}
    />
  );
};

const MessageText = ({
  allowHtml,
  content,
  hostActions,
  imageHosts,
  isPartial,
  messageId,
  onBlockEvent,
  overrides,
  pendingElementIds,
  resolveDataset,
  role,
  uiBlocks,
}: {
  allowHtml?: boolean;
  content: string;
  hostActions?: readonly string[];
  imageHosts?: readonly string[];
  isPartial: boolean;
  messageId: string;
  onBlockEvent: (event: BlockChatEvent) => void;
  overrides?: Record<string, Block>;
  pendingElementIds?: readonly string[];
  resolveDataset?: BlocksViewProps["resolveDataset"];
  role: string;
  uiBlocks: boolean;
}): React.ReactElement => {
  if (role === "assistant" && uiBlocks) {
    return (
      <AssistantBlocks
        allowHtml={allowHtml}
        content={content}
        hostActions={hostActions}
        imageHosts={imageHosts}
        isPartial={isPartial}
        messageId={messageId}
        onBlockEvent={onBlockEvent}
        overrides={overrides}
        pendingElementIds={pendingElementIds}
        resolveDataset={resolveDataset}
      />
    );
  }
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
  handleCopyMessage: (text: string) => void;
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
        onClick={() => handleCopyMessage(message.content)}
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

/**
 * Moves focus to a pending ask when it appears, so keyboard and screen reader users land on it.
 * On web the ask's group takes keyboard focus. On native, screen reader focus goes to the ask's
 * question, because it only lands on an accessible element and the group is not one. A raw
 * `View` because `Box` does not expose its native view to a ref.
 */
const AskFocusTarget = ({
  label,
  renderCard,
}: {
  label: string;
  renderCard: (promptRef: React.RefObject<NativeText | null>) => React.ReactElement;
}): React.ReactElement => {
  const viewRef = useRef<View>(null);
  const promptRef = useRef<NativeText>(null);

  // Focus the ask once, when it mounts; later renders of the same ask leave focus alone.
  useEffect(() => {
    if (Platform.OS === "web") {
      (viewRef.current as unknown as HTMLElement | null)?.focus?.({preventScroll: true});
      return;
    }
    const node = promptRef.current ? findNodeHandle(promptRef.current) : null;
    if (node) {
      AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, []);

  return (
    <View aria-label={label} ref={viewRef} role="group" tabIndex={-1}>
      {renderCard(promptRef)}
    </View>
  );
};

/** The ask's answer, taken from its `tool-result` message when the host did not set `response`. */
const withStoredResponse = (ask: ChatAsk, results: Map<string, unknown>): ChatAsk => {
  if (ask.response || !results.has(ask.toolCallId)) {
    return ask;
  }
  const stored = askResponseSchema.safeParse(results.get(ask.toolCallId));
  return stored.success ? {...ask, response: stored.data} : ask;
};

const AskTranscriptItem = ({
  ask,
  errors,
  onAskSubmit,
  resolveAskFiles,
}: {
  ask: ChatAsk;
  errors?: AskValidationError[];
  onAskSubmit?: AskSubmitHandler;
  resolveAskFiles?: AskFilesResolver;
}): React.ReactElement => {
  const renderCard = (promptRef?: React.Ref<NativeText>): React.ReactElement => (
    <AskCard
      ask={ask}
      errors={errors}
      onSubmit={onAskSubmit}
      promptRef={promptRef}
      resolveAskFiles={resolveAskFiles}
      testID={`gpt-ask-${ask.toolCallId}`}
    />
  );
  if (ask.status !== "pending") {
    return <Box alignItems="start">{renderCard()}</Box>;
  }
  return (
    <Box maxWidth="80%" width="100%">
      <AskFocusTarget
        label={ask.input?.title ?? "Question from the assistant"}
        renderCard={renderCard}
      />
    </Box>
  );
};

const MessageList = ({
  allowHtml,
  appendedMessages,
  askErrors,
  blockOverrides,
  currentMessages,
  handleCopyMessage,
  hostActions,
  imageHosts,
  isStreaming,
  onAskSubmit,
  onBlockEvent,
  onRateFeedback,
  pendingElements,
  resolveAskFiles,
  resolveDataset,
  uiBlocks,
}: {
  allowHtml?: boolean;
  appendedMessages: GPTChatMessage[];
  askErrors?: Record<string, AskValidationError[]>;
  blockOverrides: Record<string, Record<string, Block>>;
  currentMessages: GPTChatMessage[];
  handleCopyMessage: (text: string) => void;
  hostActions?: readonly string[];
  imageHosts?: readonly string[];
  isStreaming: boolean;
  onAskSubmit?: AskSubmitHandler;
  onBlockEvent: (event: BlockChatEvent) => void;
  onRateFeedback?: (promptIndex: number, rating: "up" | "down" | null) => void;
  pendingElements: Record<string, readonly string[]>;
  resolveAskFiles?: AskFilesResolver;
  resolveDataset?: BlocksViewProps["resolveDataset"];
  uiBlocks: boolean;
}): React.ReactElement => {
  const askToolCallIds = new Set<string>();
  const toolResults = new Map<string, unknown>();
  for (const message of currentMessages) {
    if (message.role === "tool-call" && message.ask) {
      askToolCallIds.add(message.ask.toolCallId);
    }
    if (message.role === "tool-result" && message.toolResult) {
      toolResults.set(message.toolResult.toolCallId, message.toolResult.result);
    }
  }

  const streamingIndex =
    uiBlocks && isStreaming
      ? currentMessages.findLastIndex((message) => message.role === "assistant")
      : -1;
  const messages =
    appendedMessages.length === 0 ? currentMessages : [...currentMessages, ...appendedMessages];

  return (
    <>
      {messages.map((message, index) => {
        if (message.role === "tool-call" && message.ask) {
          return (
            <AskTranscriptItem
              ask={withStoredResponse(message.ask, toolResults)}
              errors={askErrors?.[message.ask.toolCallId]}
              key={`ask-${message.ask.toolCallId}`}
              onAskSubmit={onAskSubmit}
              resolveAskFiles={resolveAskFiles}
            />
          );
        }
        if (
          message.role === "tool-result" &&
          message.toolResult &&
          askToolCallIds.has(message.toolResult.toolCallId)
        ) {
          return null;
        }
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
        const messageId = message.id ?? `msg-${index}`;
        return (
          <Box
            alignItems={message.role === "user" ? "end" : "start"}
            key={message.id ?? `msg-${index}`}
          >
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
              <MessageText
                allowHtml={allowHtml}
                content={message.content}
                hostActions={hostActions}
                imageHosts={imageHosts}
                isPartial={index === streamingIndex}
                messageId={messageId}
                onBlockEvent={onBlockEvent}
                overrides={blockOverrides[messageId]}
                pendingElementIds={pendingElements[messageId]}
                resolveDataset={resolveDataset}
                role={message.role}
                uiBlocks={uiBlocks}
              />
              {message.blockNote ? (
                <Text color="secondaryLight" size="sm" testID={`gpt-block-note-${messageId}`}>
                  {message.blockNote}
                </Text>
              ) : null}
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

export const GPTChat = ({
  askErrors,
  attachments = [],
  availableModels,
  currentHistoryId,
  currentMessages,
  geminiApiKey,
  histories,
  hostActions,
  isStreaming = false,
  mcpTools,
  mcpServers,
  onAskSubmit,
  onBlockAction,
  onBlockCallback,
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
  resolveAskFiles,
  resolveDataset,
  selectedModel,
  mascot,
  suggestedPrompts,
  systemMemory,
  testID,
  uiBlocks = false,
  allowHtml = false,
  imageHosts,
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
  const [blockOverrides, setBlockOverrides] = useState<Record<string, Record<string, Block>>>({});
  const [pendingElements, setPendingElements] = useState<Record<string, string[]>>({});
  const [appendedMessages, setAppendedMessages] = useState<GPTChatMessage[]>([]);
  const [blockHistoryId, setBlockHistoryId] = useState(currentHistoryId);
  if (blockHistoryId !== currentHistoryId) {
    setBlockHistoryId(currentHistoryId);
    setBlockOverrides({});
    setPendingElements({});
    setAppendedMessages([]);
  }

  const runBlockCallback = useCallback(
    async (event: BlockChatEvent): Promise<void> => {
      setPendingElements((current) => ({
        ...current,
        [event.messageId]: [...(current[event.messageId] ?? []), event.elementId],
      }));
      try {
        const result = await onBlockCallback?.(event);
        if (result?.text) {
          const text = result.text;
          setAppendedMessages((current) => [
            ...current,
            {
              content: text,
              id: `block-text-${event.messageId}-${event.elementId}-${current.length}`,
              role: "assistant",
            },
          ]);
        }
        if (result?.replace === "block" && result.blocks !== undefined) {
          const block = replacementBlock(result.blocks);
          if (block !== undefined) {
            setBlockOverrides((current) => ({
              ...current,
              [event.messageId]: {...(current[event.messageId] ?? {}), [event.blockId]: block},
            }));
          }
        }
      } finally {
        setPendingElements((current) => ({
          ...current,
          [event.messageId]: (current[event.messageId] ?? []).filter(
            (id) => id !== event.elementId
          ),
        }));
      }
    },
    [onBlockCallback]
  );

  const handleBlockEvent = useCallback(
    (event: BlockChatEvent): void => {
      if (event.action.kind === "reply") {
        onSubmit(event.action.text);
        return;
      }
      if (event.action.kind === "callback") {
        void runBlockCallback(event);
        return;
      }
      onBlockAction?.(event);
    },
    [onBlockAction, onSubmit, runBlockCallback]
  );

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

  const handleCopyMessage = useCallback(async (text: string) => {
    const Clipboard = await import("expo-clipboard");
    await Clipboard.setStringAsync(text);
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
    setIsScrolledUp(distanceFromBottom > 100);
  }, []);

  const handleContentLayout = useCallback(
    (_event: {nativeEvent: {layout: {height: number; width: number; x: number; y: number}}}) => {
      contentHeightRef.current = _event.nativeEvent.layout.height;
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
            <Box direction="row" gap={1}>
              <HistoryItemActionButton
                editingHistoryId={editingHistoryId}
                handleFinishRename={handleFinishRename}
                handleStartRename={handleStartRename}
                history={history}
                onUpdateTitle={onUpdateTitle}
              />
              <IconButton
                accessibilityLabel={`Delete chat: ${history.title ?? "New Chat"}`}
                iconName="trash"
                onClick={() => onDeleteHistory(history.id)}
                testID={`gpt-delete-history-${history.id}`}
                variant="destructive"
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
                    allowHtml={allowHtml}
                    appendedMessages={appendedMessages}
                    askErrors={askErrors}
                    blockOverrides={blockOverrides}
                    currentMessages={currentMessages}
                    handleCopyMessage={handleCopyMessage}
                    hostActions={hostActions}
                    imageHosts={imageHosts}
                    isStreaming={isStreaming}
                    onAskSubmit={onAskSubmit}
                    onBlockEvent={handleBlockEvent}
                    onRateFeedback={onRateFeedback}
                    pendingElements={pendingElements}
                    resolveAskFiles={resolveAskFiles}
                    resolveDataset={resolveDataset}
                    uiBlocks={uiBlocks}
                  />
                  <StreamingIndicator
                    isStreaming={
                      isStreaming &&
                      !(
                        uiBlocks &&
                        currentMessages[currentMessages.length - 1]?.role === "assistant"
                      )
                    }
                  />
                </>
              )}
            </Box>
          </Box>
        </Box>

        <ScrollToBottomButton isScrolledUp={isScrolledUp} scrollToBottom={scrollToBottom} />
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
              inputRef={handleInputRef}
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
