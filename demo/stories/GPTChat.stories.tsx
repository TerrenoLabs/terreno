import type {GPTChatHistory, GPTChatMessage, SelectedFile} from "@terreno/ui";
import {Box, GPTChat, Heading, Text} from "@terreno/ui";
import type React from "react";
import {useCallback, useState} from "react";

const STATIC_HISTORIES: GPTChatHistory[] = [
  {id: "h1", prompts: [], title: "Onboarding questions"},
  {id: "h2", prompts: [], title: "API design"},
  {
    id: "h3",
    prompts: [],
    title: "A very long chat title that truncates before the actions menu is pushed out",
  },
];

// A 64x64 PNG so the image actions (copy, download) have something real to act on.
const DEMO_IMAGE_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQQkAAAgEsOtjKTPY/2EE38JgBZbqeS0CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApcFG3TQ4h4AqHMAAAAASUVORK5CYII=";

const STATIC_MESSAGES: GPTChatMessage[] = [
  {content: "How do I add a new synced collection?", role: "user"},
  {
    content:
      "Add `syncPlugin` and `isDeletedPlugin` to the model, then pass a `sync` config to `modelRouter`. No live backend is required for this demo.",
    role: "assistant",
  },
  {content: "Draw a tiny teal square", role: "user"},
  {
    content: "",
    contentParts: [{mimeType: "image/png", type: "image", url: DEMO_IMAGE_URL}],
    role: "assistant",
  },
];

const CANNED_ASSISTANT_REPLY =
  "This demo uses a static message list. Submit appends a canned reply locally — there is no AI backend.";

const noop = (): void => {};

const GPTChatFrame: React.FC<{children: React.ReactNode}> = ({children}) => {
  return (
    <Box height={480} overflow="hidden" width="100%">
      {children}
    </Box>
  );
};

const DEMO_MASCOT: React.ReactElement = (
  <Box alignItems="center" gap={3}>
    <Heading size="2xl">🦊</Heading>
    <Text align="center" color="secondaryDark" size="sm">
      Demo fox — supplied by the story, not by GPTChat.
    </Text>
  </Box>
);

export const GPTChatDemo: React.FC = (): React.ReactElement => {
  const [messages, setMessages] = useState<GPTChatMessage[]>(STATIC_MESSAGES);
  const [historyId, setHistoryId] = useState<string>("h1");
  const [histories, setHistories] = useState<GPTChatHistory[]>(STATIC_HISTORIES);
  const [attachments, setAttachments] = useState<SelectedFile[]>([]);

  const handleUpdateTitle = useCallback((id: string, title: string): void => {
    setHistories((current) => current.map((h) => (h.id === id ? {...h, title} : h)));
  }, []);

  const handleDeleteHistory = useCallback((id: string): void => {
    setHistories((current) => current.filter((h) => h.id !== id));
  }, []);

  const handleAttachFiles = useCallback((files: SelectedFile[]): void => {
    setAttachments((current) => [...current, ...files]);
  }, []);

  const handleRemoveAttachment = useCallback((index: number): void => {
    setAttachments((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback((prompt: string): void => {
    setMessages((current) => [
      ...current,
      {content: prompt, role: "user"},
      {content: CANNED_ASSISTANT_REPLY, role: "assistant"},
    ]);
    setAttachments([]);
  }, []);

  const handleSelectHistory = useCallback((id: string): void => {
    setHistoryId(id);
  }, []);

  const handleCreateHistory = useCallback((): void => {
    setHistoryId("h-new");
    setMessages([]);
  }, []);

  return (
    <GPTChatFrame>
      <GPTChat
        attachments={attachments}
        currentHistoryId={historyId}
        currentMessages={messages}
        histories={histories}
        onAttachFiles={handleAttachFiles}
        onCreateHistory={handleCreateHistory}
        onDeleteHistory={handleDeleteHistory}
        onRemoveAttachment={handleRemoveAttachment}
        onSelectHistory={handleSelectHistory}
        onSubmit={handleSubmit}
        onUpdateTitle={handleUpdateTitle}
        suggestedPrompts={["Summarize the last answer", "Show a code sample"]}
        testID="demo-gpt-chat"
      />
    </GPTChatFrame>
  );
};

export const GPTChatEmpty: React.FC = (): React.ReactElement => {
  return (
    <Box gap={2} width="100%">
      <Heading size="sm">Empty</Heading>
      <Text>No messages — suggested prompts only. No backend.</Text>
      <GPTChatFrame>
        <GPTChat
          currentMessages={[]}
          histories={STATIC_HISTORIES}
          onCreateHistory={noop}
          onDeleteHistory={noop}
          onSelectHistory={noop}
          onSubmit={noop}
          suggestedPrompts={["What can this chat do?", "Explain SplitPage"]}
          testID="demo-gpt-chat-empty"
        />
      </GPTChatFrame>
    </Box>
  );
};

export const GPTChatMascot: React.FC = (): React.ReactElement => {
  return (
    <Box gap={2} width="100%">
      <Heading size="sm">Mascot</Heading>
      <Text>
        Empty chat with a consumer-supplied mascot. GPTChat ships none — omit `mascot` to keep the
        default empty state.
      </Text>
      <GPTChatFrame>
        <GPTChat
          currentMessages={[]}
          histories={STATIC_HISTORIES}
          mascot={DEMO_MASCOT}
          onCreateHistory={noop}
          onDeleteHistory={noop}
          onSelectHistory={noop}
          onSubmit={noop}
          suggestedPrompts={["What can this chat do?", "Explain SplitPage"]}
          testID="demo-gpt-chat-mascot"
        />
      </GPTChatFrame>
    </Box>
  );
};

export const GPTChatStreaming: React.FC = (): React.ReactElement => {
  return (
    <Box gap={2} width="100%">
      <Heading size="sm">Streaming</Heading>
      <Text>Assistant is streaming. Input submit is ignored while `isStreaming` is true.</Text>
      <GPTChatFrame>
        <GPTChat
          currentHistoryId="h1"
          currentMessages={[...STATIC_MESSAGES, {content: "Drafting a reply", role: "assistant"}]}
          histories={STATIC_HISTORIES}
          isStreaming
          onCreateHistory={noop}
          onDeleteHistory={noop}
          onSelectHistory={noop}
          onSubmit={noop}
          testID="demo-gpt-chat-streaming"
        />
      </GPTChatFrame>
    </Box>
  );
};
