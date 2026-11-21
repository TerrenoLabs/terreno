import type {GPTChatHistory, GPTChatMessage, MCPToolDetail, SelectedFile} from "@terreno/ui";
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

const DEMO_TOOLS: MCPToolDetail[] = [
  {
    description: "List records the signed-in user is allowed to see.",
    inputSchema: {
      properties: {
        limit: {description: "Maximum records to return.", type: "number"},
        status: {
          description: "Filter by status, such as outreach or discharged.",
          type: "string",
        },
      },
      required: ["limit"],
      type: "object",
    },
    name: "users_list",
  },
  {
    description: "Read one record by id.",
    name: "users_read",
  },
];

const DEMO_PATIENTS = Array.from({length: 40}, (_, index) => ({
  id: `patient-${index + 1}`,
  status: index % 2 === 0 ? "outreach" : "referred",
}));

const STATIC_MESSAGES: GPTChatMessage[] = [
  {content: "How do I add a new synced collection?", role: "user"},
  {
    content:
      "Add `syncPlugin` and `isDeletedPlugin` to the model, then pass a `sync` config to `modelRouter`. No live backend is required for this demo.",
    role: "assistant",
  },
  {content: "List the patients", role: "user"},
  {
    content: "",
    role: "tool-call",
    toolCall: {args: {limit: 50}, toolCallId: "call-users", toolName: "users_list"},
  },
  {
    content: "",
    role: "tool-result",
    toolResult: {
      result: {patients: DEMO_PATIENTS, total: 6931},
      toolCallId: "call-users",
      toolName: "users_list",
    },
  },
  {
    content: "There are 6,931 patient records. Open the tool row above for the first page.",
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

const GPTChatFrame: React.FC<{children: React.ReactNode; height?: number}> = ({
  children,
  height = 480,
}) => {
  return (
    <Box height={height} overflow="hidden" width="100%">
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

export const GPTChatDemo: React.FC<{frameHeight?: number}> = ({
  frameHeight = 480,
}): React.ReactElement => {
  const [messages, setMessages] = useState<GPTChatMessage[]>(STATIC_MESSAGES);
  const [historyId, setHistoryId] = useState<string>("h1");
  const [histories, setHistories] = useState<GPTChatHistory[]>(STATIC_HISTORIES);
  const [attachments, setAttachments] = useState<SelectedFile[]>([]);
  const [ratings, setRatings] = useState<Record<number, "up" | "down" | null>>({});

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

  const handleRateFeedback = useCallback((index: number, rating: "up" | "down" | null): void => {
    setRatings((current) => ({...current, [index]: rating}));
  }, []);

  const visibleMessages = messages.map((message, index) => {
    const rating = ratings[index];
    if (!rating) {
      return message;
    }
    return {...message, rating};
  });

  return (
    <GPTChatFrame height={frameHeight}>
      <GPTChat
        attachments={attachments}
        currentHistoryId={historyId}
        currentMessages={visibleMessages}
        histories={histories}
        mcpTools={DEMO_TOOLS}
        onAttachFiles={handleAttachFiles}
        onCreateHistory={handleCreateHistory}
        onDeleteHistory={handleDeleteHistory}
        onRateFeedback={handleRateFeedback}
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

export const GPTChatTranscript: React.FC = (): React.ReactElement => {
  return <GPTChatDemo frameHeight={880} />;
};

const BLOCKS_REPLY = `v: 1
datasets:
  signups:
    columns:
      - {name: month, type: string}
      - {name: count, type: number}
    rows:
      - [Jan, 120]
      - [Feb, 180]
      - [Mar, 90]
      - [Apr, 210]
blocks:
  - type: heading
    size: lg
    text: Signups this quarter
  - type: text
    markdown: Signups grew **12%** quarter over quarter.
  - type: columns
    children:
      - type: metric
        label: Total
        value: "403"
        delta: "+12%"
        trend: up
      - type: metric
        label: Best month
        value: Apr
  - type: callout
    status: info
    text: Numbers refresh hourly from the signups dataset.
  - type: card
    id: team
    title: Team
    children:
      - type: badge
        status: success
        text: On track
      - type: text
        markdown: Ada leads the quarter. The card sits on the page, not inside a chat bubble.
  - type: chart
    id: signups_chart
    kind: bar
    title: Signups
    data: signups
    x: month
    y: count
  - type: table
    id: signups_table
    title: Signups by month
    data: signups
  - type: details
    title: How a signup is counted
    text: A signup is a new workspace created during the month.
  - type: actions
    id: follow
    elements:
      - type: button
        id: reply_btn
        text: Break it down
        action: {kind: reply, text: Break signups down by channel}
`;

const BLOCKS_MESSAGES: GPTChatMessage[] = [
  {content: "How did signups do this quarter?", role: "user"},
  {content: BLOCKS_REPLY, id: "blocks-quarter", role: "assistant"},
];

export const GPTChatBlocks: React.FC = (): React.ReactElement => {
  const [messages, setMessages] = useState<GPTChatMessage[]>(BLOCKS_MESSAGES);

  const handleSubmit = useCallback((prompt: string): void => {
    setMessages((current) => [
      ...current,
      {content: prompt, role: "user"},
      {content: CANNED_ASSISTANT_REPLY, role: "assistant"},
    ]);
  }, []);

  return (
    <GPTChatFrame height={960}>
      <GPTChat
        currentHistoryId="h1"
        currentMessages={messages}
        histories={STATIC_HISTORIES}
        mcpTools={DEMO_TOOLS}
        onCreateHistory={noop}
        onDeleteHistory={noop}
        onSelectHistory={noop}
        onSubmit={handleSubmit}
        testID="demo-gpt-chat-blocks"
        uiBlocks
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

export const GPTChatNoHistory: React.FC = (): React.ReactElement => {
  return (
    <Box gap={2} width="100%">
      <Heading size="sm">No history sidebar</Heading>
      <Text>
        `showHistory={false}` drops the sidebar so messages use the full width, as on a phone.
      </Text>
      <GPTChatFrame>
        <GPTChat
          currentHistoryId="h1"
          currentMessages={STATIC_MESSAGES}
          histories={STATIC_HISTORIES}
          onCreateHistory={noop}
          onDeleteHistory={noop}
          onSelectHistory={noop}
          onSubmit={noop}
          showHistory={false}
          testID="demo-gpt-chat-no-history"
        />
      </GPTChatFrame>
    </Box>
  );
};
