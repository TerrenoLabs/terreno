import {afterAll, afterEach, describe, it, mock} from "bun:test";
import type {ChoiceAskInput} from "@terreno/blocks";
import {act, fireEvent, render, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {AccessibilityInfo, Platform, Pressable, ScrollView} from "react-native";

import type {AskSubmission, ChatAsk} from "./asks/askTypes";
import type {SelectedFile} from "./FilePickerButton";
import type {GPTChatHistory, GPTChatMessage, GPTChatProps, MessageContentPart} from "./GPTChat";
import {GPTChat} from "./GPTChat";
import {Text} from "./Text";
import {ThemeProvider} from "./Theme";
import {renderWithTheme} from "./test-utils";

const setStringAsync = mock(async (_text: string) => {});
mock.module("expo-clipboard", () => ({setStringAsync}));

const pickedDocument = {mimeType: "text/plain", name: "notes.txt", uri: "file:///notes.txt"};
mock.module("expo-document-picker", () => ({
  getDocumentAsync: mock(async () => ({assets: [pickedDocument], canceled: false})),
}));

// bunSetup.ts mocks IconButton to render null; GPTChat's controls are icon buttons, so replace it
// with a pressable stub that keeps the accessibility label and testID.
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
  }) => React.createElement(Pressable, {accessibilityLabel, disabled, onPress: onClick, testID}),
}));

// Module mocks are global, so restore the bunSetup stub for test files that run after this one.
afterAll(() => {
  mock.module("./IconButton", () => ({IconButton: mock(() => null)}));
});

// Box and IconButton presses run through an async haptic call, so state updates land in a
// microtask after the event.
const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
  });
};

const histories: GPTChatHistory[] = [
  {id: "h1", prompts: [], title: "First chat"},
  {id: "h2", prompts: []},
];

const renderChat = (overrides: Partial<GPTChatProps> = {}): ReturnType<typeof renderWithTheme> => {
  return renderWithTheme(
    <GPTChat
      currentMessages={[]}
      histories={histories}
      onCreateHistory={() => {}}
      onDeleteHistory={() => {}}
      onSelectHistory={() => {}}
      onSubmit={() => {}}
      testID="gpt-chat"
      {...overrides}
    />
  );
};

describe("GPTChat", () => {
  it("renders the sidebar with chat histories", () => {
    const {getByTestId, getByText} = renderChat();

    assert.isOk(getByTestId("gpt-chat"));
    assert.isOk(getByText("Chats"));
    assert.isOk(getByText("First chat"));
    assert.isOk(getByText("New Chat"));
  });

  it("selects, creates, and deletes histories", async () => {
    const onSelectHistory = mock((_id: string) => {});
    const onCreateHistory = mock(() => {});
    const onDeleteHistory = mock((_id: string) => {});
    const {getByLabelText, getByTestId} = renderChat({
      currentHistoryId: "h1",
      onCreateHistory,
      onDeleteHistory,
      onSelectHistory,
    });

    await press(getByLabelText("Select chat: First chat"));
    await press(getByTestId("gpt-new-chat-button"));
    await press(getByTestId("gpt-delete-history-h2"));

    assert.deepEqual(onSelectHistory.mock.calls, [["h1"]]);
    assert.equal(onCreateHistory.mock.calls.length, 1);
    assert.deepEqual(onDeleteHistory.mock.calls, [["h2"]]);
  });

  it("renames a history and saves the new title once", async () => {
    const onUpdateTitle = mock((_id: string, _title: string) => {});
    const {getByTestId} = renderChat({onUpdateTitle});

    await press(getByTestId("gpt-rename-history-h1"));
    fireEvent.changeText(getByTestId("gpt-rename-input-h1"), "Renamed");
    await press(getByTestId("gpt-rename-save-h1"));

    assert.deepEqual(onUpdateTitle.mock.calls, [["h1", "Renamed"]]);
  });

  it("ignores a rename with a blank title and skips duplicate saves", async () => {
    const onUpdateTitle = mock((_id: string, _title: string) => {});
    const {getByTestId} = renderChat({onUpdateTitle});

    await press(getByTestId("gpt-rename-history-h2"));
    fireEvent.changeText(getByTestId("gpt-rename-input-h2"), "   ");
    fireEvent(getByTestId("gpt-rename-input-h2"), "blur");

    assert.equal(onUpdateTitle.mock.calls.length, 0);
  });

  it("hides the rename button when renaming is not supported", () => {
    const {queryByTestId} = renderChat();

    assert.isNull(queryByTestId("gpt-rename-history-h1"));
  });

  it("renders a model selector only when models and a change handler are given", () => {
    const onModelChange = mock((_id: string) => {});
    const {getAllByText} = renderChat({
      availableModels: [
        {label: "Flash", value: "flash"},
        {label: "Pro", value: "pro"},
      ],
      onModelChange,
      selectedModel: "pro",
    });

    assert.isNotEmpty(getAllByText("Pro"));
  });

  it("omits the model selector when there is no change handler", () => {
    const {queryByText} = renderChat({
      availableModels: [{label: "Flash", value: "flash"}],
    });

    assert.isNull(queryByText("Flash"));
  });

  it("hides the optional sidebar buttons when their handlers are missing", () => {
    const {queryByTestId} = renderChat({mcpServers: []});

    assert.isNull(queryByTestId("gpt-api-key-button"));
    assert.isNull(queryByTestId("gpt-memory-button"));
  });

  it("edits the Gemini API key through the modal", async () => {
    const onGeminiApiKeyChange = mock((_key: string) => {});
    const {getByTestId, getByText} = renderChat({geminiApiKey: "old-key", onGeminiApiKeyChange});

    await press(getByTestId("gpt-api-key-button"));
    fireEvent.changeText(getByTestId("gpt-api-key-input"), "new-key");
    await press(getByText("Save"));

    assert.deepEqual(onGeminiApiKeyChange.mock.calls, [["new-key"]]);
  });

  it("dismisses the API key modal without saving", async () => {
    const onGeminiApiKeyChange = mock((_key: string) => {});
    const {getByTestId, getByText} = renderChat({onGeminiApiKeyChange});

    await press(getByTestId("gpt-api-key-button"));
    await press(getByText("Cancel"));

    assert.equal(onGeminiApiKeyChange.mock.calls.length, 0);
  });

  it("opens the system memory editor with the current memory", async () => {
    const onMemoryEdit = mock((_memory: string) => {});
    const {getByTestId} = renderChat({onMemoryEdit, systemMemory: "remember this"});

    await press(getByTestId("gpt-memory-button"));

    assert.deepEqual(onMemoryEdit.mock.calls, [["remember this"]]);
  });

  it("opens the system memory editor with an empty memory by default", async () => {
    const onMemoryEdit = mock((_memory: string) => {});
    const {getByTestId} = renderChat({onMemoryEdit});

    await press(getByTestId("gpt-memory-button"));

    assert.deepEqual(onMemoryEdit.mock.calls, [[""]]);
  });

  it("toggles the MCP server list", async () => {
    const {getByLabelText, getByText, queryByText} = renderChat({
      mcpServers: [
        {connected: true, name: "files"},
        {connected: false, name: "search"},
      ],
    });

    assert.isOk(getByText("1/2 MCP"));
    assert.isNull(queryByText("files"));

    await press(getByLabelText("MCP server status"));
    assert.isOk(getByText("files"));
    assert.isOk(getByText("search"));

    await press(getByLabelText("MCP server status"));
    assert.isNull(queryByText("files"));
  });

  it("renders a disconnected MCP indicator when no server is connected", () => {
    const {getByText} = renderChat({mcpServers: [{connected: false, name: "files"}]});

    assert.isOk(getByText("0/1 MCP"));
  });

  it("lists the available MCP tools in a modal", async () => {
    const {getByTestId, getByText} = renderChat({
      mcpTools: [{description: "Reads files", name: "readFile"}, {name: "writeFile"}],
    });

    await press(getByTestId("gpt-tools-button"));

    assert.isOk(getByText("readFile"));
    assert.isOk(getByText("Reads files"));
    assert.isOk(getByText("writeFile"));
  });

  it("hides the tools button when there are no tools", () => {
    const {queryByTestId} = renderChat({mcpTools: []});

    assert.isNull(queryByTestId("gpt-tools-button"));
  });

  it("omits the mascot when the consumer does not pass one", () => {
    const {queryByTestId} = renderChat({suggestedPrompts: ["Summarize this"]});

    assert.isNull(queryByTestId("gpt-mascot"));
  });

  it("renders the consumer mascot on an empty chat", () => {
    const {getByTestId, getByText} = renderChat({
      mascot: <Text testID="consumer-mascot">App fox</Text>,
    });

    assert.isOk(getByTestId("gpt-mascot"));
    assert.isOk(getByText("App fox"));
  });

  it("keeps the mascot above suggested prompts on an empty chat", () => {
    const {getByTestId, getByText} = renderChat({
      mascot: <Text>App fox</Text>,
      suggestedPrompts: ["Summarize this"],
    });

    assert.isOk(getByTestId("gpt-mascot"));
    assert.isOk(getByText("Try asking..."));
  });

  it("centers the empty state in the chat panel", () => {
    const {getByTestId} = renderChat({
      mascot: <Text>App fox</Text>,
      suggestedPrompts: ["Summarize this"],
    });

    const emptyState = getByTestId("gpt-empty-state");

    assert.equal(emptyState.props.style.flexGrow, 1);
    assert.equal(emptyState.props.style.justifyContent, "center");
    assert.equal(emptyState.props.style.alignItems, "center");
  });

  it("sizes the empty hero to the viewport so short content can center", () => {
    const {getByTestId} = renderChat({
      mascot: <Text>App fox</Text>,
      suggestedPrompts: ["Summarize this"],
    });

    fireEvent(getByTestId("gpt-viewport"), "layout", {
      nativeEvent: {layout: {height: 480, width: 100, x: 0, y: 0}},
    });

    assert.equal(getByTestId("gpt-empty-state").props.style.minHeight, 480);
  });

  it("keeps the empty state inside the scrollable message content", () => {
    const {getByTestId} = renderChat({
      mascot: <Text>App fox</Text>,
      suggestedPrompts: ["Summarize this"],
    });

    assert.isOk(getByTestId("gpt-messages").findByProps({testID: "gpt-empty-state"}));
  });

  it("keeps empty-chat streaming feedback in the centered hero", () => {
    const {getByTestId} = renderChat({
      isStreaming: true,
      mascot: <Text>App fox</Text>,
    });

    assert.isOk(getByTestId("gpt-empty-state").findByProps({testID: "gpt-streaming-indicator"}));
  });

  it("drops the centered empty state once messages exist", () => {
    const {queryByTestId} = renderChat({
      currentMessages: [{content: "Hi there", role: "user"}],
      mascot: <Text>App fox</Text>,
      suggestedPrompts: ["Summarize this"],
    });

    assert.isNull(queryByTestId("gpt-empty-state"));
  });

  it("vertically centers each composer control beside the input", () => {
    const {getByTestId} = renderChat({
      mcpTools: [{name: "readFile"}],
      onAttachFiles: () => {},
    });

    // Button hard-codes alignSelf, so each control sits in a full-height cell that centers it.
    for (const cell of ["gpt-composer-attach", "gpt-composer-tools", "gpt-composer-send"]) {
      assert.equal(getByTestId(cell).props.style.justifyContent, "center");
    }
  });

  it("omits the attachment composer cell when attachments are unavailable", () => {
    const {queryByTestId} = renderChat();

    assert.isNull(queryByTestId("gpt-composer-attach"));
  });

  it("hides the mascot after messages exist", () => {
    const {queryByTestId} = renderChat({
      currentMessages: [{content: "Hi there", role: "user"}],
      mascot: <Text>App fox</Text>,
    });

    assert.isNull(queryByTestId("gpt-mascot"));
  });

  it("renders suggested prompts and submits the tapped prompt", async () => {
    const onSubmit = mock((_prompt: string) => {});
    const {getByLabelText, getByText} = renderChat({
      onSubmit,
      suggestedPrompts: ["Summarize this"],
    });

    assert.isOk(getByText("Try asking..."));
    await press(getByLabelText("Summarize this"));

    assert.deepEqual(onSubmit.mock.calls, [["Summarize this"]]);
  });

  it("ignores suggested prompts while streaming", async () => {
    const onSubmit = mock((_prompt: string) => {});
    const {getByLabelText} = renderChat({
      isStreaming: true,
      onSubmit,
      suggestedPrompts: ["Summarize this"],
    });

    await press(getByLabelText("Summarize this"));

    assert.equal(onSubmit.mock.calls.length, 0);
  });

  it("submits typed input and clears the field", async () => {
    const onSubmit = mock((_prompt: string) => {});
    const {getByTestId} = renderChat({onSubmit});

    fireEvent.changeText(getByTestId("gpt-input"), "  Hello  ");
    await press(getByTestId("gpt-submit"));

    assert.deepEqual(onSubmit.mock.calls, [["Hello"]]);
    assert.equal(getByTestId("gpt-input").props.value, "");
  });

  it("does not submit blank input", async () => {
    const onSubmit = mock((_prompt: string) => {});
    const {getByTestId} = renderChat({onSubmit});

    fireEvent.changeText(getByTestId("gpt-input"), "   ");
    await press(getByTestId("gpt-submit"));

    assert.equal(onSubmit.mock.calls.length, 0);
  });

  it("does not submit while streaming", async () => {
    const onSubmit = mock((_prompt: string) => {});
    const {getByTestId} = renderChat({isStreaming: true, onSubmit});

    fireEvent.changeText(getByTestId("gpt-input"), "Hello");
    await press(getByTestId("gpt-submit"));

    assert.equal(onSubmit.mock.calls.length, 0);
  });

  it("renders user and assistant messages", async () => {
    const messages: GPTChatMessage[] = [
      {content: "Hi there", role: "user"},
      {content: "Hello!", role: "assistant"},
    ];
    const {getByText, toJSON} = renderChat({currentMessages: messages});

    assert.isOk(getByText("Hi there"));
    // The assistant message renders through the lazily loaded markdown view.
    await waitFor(() => {
      assert.include(JSON.stringify(toJSON()), "Hello!");
    });
  });

  it("expands tool call details", async () => {
    const messages: GPTChatMessage[] = [
      {
        content: "",
        role: "tool-call",
        toolCall: {args: {path: "README.md"}, toolCallId: "1", toolName: "readFile"},
      },
    ];
    const {getByLabelText, getByText, queryByText} = renderChat({currentMessages: messages});

    assert.isNull(queryByText(/README.md/));
    await press(getByLabelText("Tool: readFile"));
    assert.isOk(getByText(/README.md/));
  });

  it("expands string and object tool results", async () => {
    const messages: GPTChatMessage[] = [
      {
        content: "",
        role: "tool-result",
        toolResult: {result: "done", toolCallId: "1", toolName: "readFile"},
      },
      {
        content: "",
        role: "tool-result",
        toolResult: {result: {ok: true}, toolCallId: "2", toolName: "writeFile"},
      },
    ];
    const {getByLabelText, getByText} = renderChat({currentMessages: messages});

    await press(getByLabelText("Result: readFile"));
    await press(getByLabelText("Result: writeFile"));

    assert.isOk(getByText("done"));
    assert.isOk(getByText(/"ok": true/));
  });

  it("renders image and file content parts", () => {
    const messages: GPTChatMessage[] = [
      {
        content: "See attached",
        contentParts: [
          {text: "See attached", type: "text"},
          {type: "image", url: "https://example.com/pic.png"},
          {mimeType: "application/pdf", type: "file", url: "https://example.com/doc.pdf"},
          {filename: "notes.txt", mimeType: "text/plain", type: "file", url: "file:///notes.txt"},
        ],
        role: "user",
      },
    ];
    const {getByText} = renderChat({currentMessages: messages});

    assert.isOk(getByText("File"));
    assert.isOk(getByText("notes.txt"));
  });

  it("downloads a file content part on press", async () => {
    const messages: GPTChatMessage[] = [
      {
        content: "",
        contentParts: [
          {filename: "doc.pdf", mimeType: "application/pdf", type: "file", url: "data:abc"},
        ],
        role: "assistant",
      },
    ];
    const clicked: string[] = [];
    const link = {click: () => clicked.push("click"), download: "", href: ""};
    const appended: unknown[] = [];
    const removed: unknown[] = [];
    const domGlobals = globalThis as typeof globalThis & {
      document?: unknown;
      window?: unknown;
    };
    const originalDocument = domGlobals.document;
    const originalWindow = domGlobals.window;
    domGlobals.window = {};
    domGlobals.document = {
      body: {
        appendChild: (node: unknown) => appended.push(node),
        removeChild: (node: unknown) => removed.push(node),
      },
      createElement: () => link,
    };

    try {
      const {getByLabelText} = renderChat({currentMessages: messages});
      await press(getByLabelText("File: doc.pdf"));
    } finally {
      domGlobals.document = originalDocument;
      domGlobals.window = originalWindow;
    }

    assert.equal(link.href, "data:abc");
    assert.equal(link.download, "doc.pdf");
    assert.deepEqual(clicked, ["click"]);
    assert.deepEqual(appended, [link]);
    assert.deepEqual(removed, [link]);
  });

  it("skips the download outside a browser environment", async () => {
    const messages: GPTChatMessage[] = [
      {
        content: "",
        contentParts: [{mimeType: "text/plain", type: "file", url: "https://example.com/a.txt"}],
        role: "assistant",
      },
    ];
    const domGlobals = globalThis as typeof globalThis & {window?: unknown};
    const originalWindow = domGlobals.window;
    domGlobals.window = undefined;

    try {
      const {getByLabelText} = renderChat({currentMessages: messages});
      await press(getByLabelText("File: File"));
    } finally {
      domGlobals.window = originalWindow;
    }
  });

  it("rates assistant messages and toggles the rating off", () => {
    const onRateFeedback = mock((_index: number, _rating: "up" | "down" | null) => {});
    const messages: GPTChatMessage[] = [
      {content: "Hello!", rating: "up", role: "assistant"},
      {content: "More", role: "assistant"},
    ];
    const {getByTestId} = renderChat({currentMessages: messages, onRateFeedback});

    fireEvent.press(getByTestId("gpt-rate-up-0"));
    fireEvent.press(getByTestId("gpt-rate-down-0"));
    fireEvent.press(getByTestId("gpt-rate-down-1"));

    assert.deepEqual(onRateFeedback.mock.calls, [
      [0, null],
      [0, "down"],
      [1, "down"],
    ]);
  });

  it("hides rating buttons without a feedback handler", () => {
    const {queryByTestId} = renderChat({
      currentMessages: [{content: "Hello!", role: "assistant"}],
    });

    assert.isNull(queryByTestId("gpt-rate-up-0"));
  });

  it("copies an assistant message to the clipboard", async () => {
    setStringAsync.mockClear();
    const {getByTestId} = renderChat({
      currentMessages: [{content: "Copy me", role: "assistant"}],
    });

    await act(async () => {
      fireEvent.press(getByTestId("gpt-copy-msg-0"));
    });

    assert.deepEqual(setStringAsync.mock.calls, [["Copy me"]]);
  });

  it("disables input and the attachment picker while streaming", () => {
    const {getByTestId} = renderChat({isStreaming: true, onAttachFiles: () => {}});

    assert.isTrue(getByTestId("gpt-input").props.readOnly);
    assert.isTrue(getByTestId("gpt-attach-button").props.disabled);
  });

  it("keeps the attachment picker enabled when not streaming", () => {
    const {getByTestId} = renderChat({onAttachFiles: () => {}});

    assert.isNotTrue(getByTestId("gpt-attach-button").props.disabled);
  });

  it("hides the attachment picker without an attach handler", () => {
    const {queryByTestId} = renderChat();

    assert.isNull(queryByTestId("gpt-attach-button"));
  });

  it("shows the scroll to bottom button once scrolled away from the end", async () => {
    const {getByTestId, getByText, queryByText, UNSAFE_getByType} = renderChat({
      currentMessages: [{content: "Hello!", role: "assistant"}],
    });

    assert.isNull(queryByText("Scroll to bottom"));

    fireEvent(getByTestId("gpt-viewport"), "layout", {
      nativeEvent: {layout: {height: 200, width: 100, x: 0, y: 0}},
    });
    fireEvent(getByTestId("gpt-messages"), "layout", {
      nativeEvent: {layout: {height: 600, width: 100, x: 0, y: 0}},
    });
    await act(async () => {
      fireEvent.scroll(UNSAFE_getByType(ScrollView), {
        nativeEvent: {contentOffset: {x: 0, y: 100}},
      });
    });

    assert.isOk(getByText("Scroll to bottom"));

    await press(getByText("Scroll to bottom"));

    assert.isNull(queryByText("Scroll to bottom"));
  });

  it("renders attachments and the attach button", () => {
    const onAttachFiles = mock(() => {});
    const onRemoveAttachment = mock((_index: number) => {});
    const {getByTestId} = renderChat({
      attachments: [{mimeType: "image/png", name: "photo.png", uri: "file:///photo.png"}],
      onAttachFiles,
      onRemoveAttachment,
    });

    assert.isOk(getByTestId("gpt-attach-button"));
    assert.isOk(getByTestId("attachment-preview"));
  });

  it("hides the attachment preview without a remove handler", () => {
    const {queryByTestId} = renderChat({
      attachments: [{mimeType: "image/png", name: "photo.png", uri: "file:///photo.png"}],
    });

    assert.isNull(queryByTestId("attachment-preview"));
  });

  it("renders nothing for unknown content part types", () => {
    const parts = [
      {type: "audio", url: "https://example.com/a.mp3"},
    ] as unknown as MessageContentPart[];
    const {getByText, queryByText} = renderChat({
      currentMessages: [{content: "Listen", contentParts: parts, role: "user"}],
    });

    assert.isOk(getByText("Listen"));
    assert.isNull(queryByText("File"));
  });

  it("forwards picked files to onAttachFiles", async () => {
    const onAttachFiles = mock((_files: SelectedFile[]) => {});
    const {getByTestId, getByText} = renderChat({onAttachFiles});

    await press(getByTestId("gpt-attach-button"));
    await press(getByText("Document"));

    await waitFor(() => {
      assert.deepEqual(onAttachFiles.mock.calls, [[[pickedDocument]]]);
    });
  });

  it("saves a rename only once when blur and enter both fire", async () => {
    const onUpdateTitle = mock((_id: string, _title: string) => {});
    const {getByTestId} = renderChat({onUpdateTitle});

    await press(getByTestId("gpt-rename-history-h1"));
    fireEvent.changeText(getByTestId("gpt-rename-input-h1"), "Renamed");
    const input = getByTestId("gpt-rename-input-h1");
    await act(async () => {
      input.props.onSubmitEditing();
      input.props.onBlur();
    });

    assert.deepEqual(onUpdateTitle.mock.calls, [["h1", "Renamed"]]);
  });

  it("scrolls to the bottom when new messages arrive", () => {
    const {getByText, rerender} = renderChat({
      currentMessages: [{content: "First", role: "assistant"}],
    });

    rerender(
      <GPTChat
        currentMessages={[
          {content: "First", role: "assistant"},
          {content: "Second", role: "assistant"},
        ]}
        histories={histories}
        onCreateHistory={() => {}}
        onDeleteHistory={() => {}}
        onSelectHistory={() => {}}
        onSubmit={() => {}}
        testID="gpt-chat"
      />
    );

    assert.isOk(getByText("Second"));
  });
});

describe("GPTChat web keyboard submit", () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  const renderOnWeb = (): {
    handlers: Map<string, (event: Event) => void>;
    onSubmit: ReturnType<typeof mock<(prompt: string) => void>>;
    result: ReturnType<typeof render>;
    removed: string[];
  } => {
    Platform.OS = "web";
    const handlers = new Map<string, (event: Event) => void>();
    const removed: string[] = [];
    const onSubmit = mock((_prompt: string) => {});
    const node = {
      addEventListener: (type: string, handler: (event: Event) => void): void => {
        handlers.set(type, handler);
      },
      removeEventListener: (type: string): void => {
        removed.push(type);
      },
      scrollToEnd: () => {},
    };
    const result = render(
      <GPTChat
        currentMessages={[]}
        histories={histories}
        onCreateHistory={() => {}}
        onDeleteHistory={() => {}}
        onSelectHistory={() => {}}
        onSubmit={onSubmit}
        testID="gpt-chat"
      />,
      {
        createNodeMock: () => node,
        wrapper: ThemeProvider,
      }
    );
    return {handlers, onSubmit, removed, result};
  };

  const keyEvent = (init: {
    key: string;
    metaKey?: boolean;
    shiftKey?: boolean;
  }): {
    event: Event;
    prevented: () => boolean;
  } => {
    let prevented = false;
    const event = {
      key: init.key,
      metaKey: init.metaKey ?? false,
      preventDefault: (): void => {
        prevented = true;
      },
      shiftKey: init.shiftKey ?? false,
    } as unknown as Event;
    return {event, prevented: (): boolean => prevented};
  };

  it("submits on Enter but not on other keys or modified Enter", async () => {
    const {handlers, onSubmit, result} = renderOnWeb();
    const keydown = handlers.get("keydown");
    assert.isFunction(keydown);

    fireEvent.changeText(result.getByTestId("gpt-input"), "Hello there");

    const other = keyEvent({key: "a"});
    const shifted = keyEvent({key: "Enter", shiftKey: true});
    const meta = keyEvent({key: "Enter", metaKey: true});
    await act(async () => {
      keydown?.(other.event);
      keydown?.(shifted.event);
      keydown?.(meta.event);
    });
    assert.isFalse(other.prevented());
    assert.isFalse(shifted.prevented());
    assert.isFalse(meta.prevented());
    assert.equal(onSubmit.mock.calls.length, 0);

    const enter = keyEvent({key: "Enter"});
    await act(async () => {
      keydown?.(enter.event);
    });
    assert.isTrue(enter.prevented());
    assert.deepEqual(onSubmit.mock.calls, [["Hello there"]]);
  });

  it("removes the keydown listener on unmount", () => {
    const {removed, result} = renderOnWeb();
    result.unmount();
    assert.include(removed, "keydown");
  });
});

describe("GPTChat asks", () => {
  const PLAN_INPUT: ChoiceAskInput = {
    default: ["team"],
    options: [
      {description: "$0, one seat", id: "starter", label: "Starter"},
      {description: "$20 per seat", id: "team", label: "Team"},
      {id: "enterprise", label: "Enterprise"},
    ],
    prompt: "Which plan should I set up?",
    select: "one",
    title: "Choose a plan",
  };

  const planAsk = (state: Partial<ChatAsk> = {}): ChatAsk => ({
    input: PLAN_INPUT,
    kind: "choice",
    status: "pending",
    toolCallId: "call_plan",
    ...state,
  });

  const askMessage = (ask: ChatAsk): GPTChatMessage => ({
    ask,
    content: "Tool call: ask_choice",
    role: "tool-call",
    toolCall: {args: {...ask.input}, toolCallId: ask.toolCallId, toolName: "ask_choice"},
  });

  const askResultMessage = (result: unknown): GPTChatMessage => ({
    content: "Tool result: ask_choice",
    role: "tool-result",
    toolResult: {result, toolCallId: "call_plan", toolName: "ask_choice"},
  });

  const userMessage: GPTChatMessage = {content: "Set up my workspace", role: "user"};

  const originalOS = Platform.OS;
  const setAccessibilityFocus = AccessibilityInfo.setAccessibilityFocus as ReturnType<typeof mock>;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it("renders a pending ask as a card in place of its tool call and sends the answer", async () => {
    const onAskSubmit = mock(async (_submission: AskSubmission) => {});
    const {getByTestId, queryByText} = renderChat({
      currentMessages: [userMessage, askMessage(planAsk())],
      onAskSubmit,
    });

    assert.isOk(getByTestId("gpt-ask-call_plan"));
    assert.isNull(queryByText("Tool: ask_choice"));
    await act(async () => {
      fireEvent.press(getByTestId("gpt-ask-call_plan-button-option:team"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.deepEqual(onAskSubmit.mock.calls[0]?.[0], {
      response: {action: "accept", content: {selected: ["team"]}},
      toolCallId: "call_plan",
    });
  });

  it("keeps a pending ask restored from history interactive", async () => {
    const onAskSubmit = mock(async (_submission: AskSubmission) => {});
    const restored: GPTChatHistory = {
      id: "h3",
      prompts: [userMessage, askMessage(planAsk({simple: undefined}))],
      title: "Plan setup",
    };
    const {getByTestId} = renderChat({
      currentHistoryId: "h3",
      currentMessages: restored.prompts,
      histories: [...histories, restored],
      onAskSubmit,
    });

    await act(async () => {
      fireEvent.press(getByTestId("gpt-ask-call_plan-button-skip"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.deepEqual(onAskSubmit.mock.calls[0]?.[0], {
      response: {action: "decline"},
      toolCallId: "call_plan",
    });
  });

  it("sends the checked options and the Other text of a restored select many ask", async () => {
    const onAskSubmit = mock(async (_submission: AskSubmission) => {});
    const toppingsAsk = planAsk({
      input: {
        allowOther: true,
        default: ["cheese"],
        maxSelected: 3,
        options: [
          {id: "cheese", label: "Extra cheese"},
          {id: "mushrooms", label: "Mushrooms"},
          {id: "olives", label: "Olives"},
        ],
        otherLabel: "Another topping",
        prompt: "Which toppings should I add?",
        select: "many",
      },
      simple: undefined,
      toolCallId: "call_toppings",
    });
    const restored: GPTChatHistory = {
      id: "h4",
      prompts: [userMessage, askMessage(toppingsAsk)],
      title: "Building a pizza",
    };
    const {getByLabelText, getByTestId} = renderChat({
      currentHistoryId: "h4",
      currentMessages: restored.prompts,
      histories: [...histories, restored],
      onAskSubmit,
    });

    await press(getByLabelText("Olives"));
    await act(async () => {
      fireEvent.changeText(getByTestId("gpt-ask-call_toppings-other"), "Basil");
    });
    await press(getByTestId("gpt-ask-call_toppings-submit"));

    assert.deepEqual(onAskSubmit.mock.calls[0]?.[0], {
      response: {action: "accept", content: {other: "Basil", selected: ["cheese", "olives"]}},
      toolCallId: "call_toppings",
    });
  });

  it("summarizes an answered ask from its hidden result message", () => {
    const {getByText, queryByTestId, queryByText} = renderChat({
      currentMessages: [
        userMessage,
        askMessage(planAsk({status: "answered"})),
        askResultMessage({action: "accept", content: {selected: ["starter"]}}),
        {content: "Starter it is.", role: "assistant"},
      ],
    });

    assert.isOk(getByText("You chose: Starter"));
    assert.isNull(queryByText("Result: ask_choice"));
    assert.isNull(queryByTestId("gpt-ask-call_plan-button-option:team"));
    assert.isOk(getByText("Starter it is."));
  });

  it("still shows tool results that do not belong to an ask", () => {
    const {getByText} = renderChat({
      currentMessages: [
        askMessage(planAsk({status: "answered"})),
        askResultMessage({action: "decline"}),
        {
          content: "Tool result: lookup",
          role: "tool-result",
          toolResult: {result: {ok: true}, toolCallId: "call_lookup", toolName: "lookup"},
        },
      ],
    });

    assert.isOk(getByText("You skipped this question."));
    assert.isOk(getByText("Result: lookup"));
  });

  it("shows the errors for the matching ask inline", () => {
    const {getByText} = renderChat({
      askErrors: {
        call_other: [
          {code: "SELECTION_COUNT", fix: "", message: "Not this ask's error.", path: "content"},
        ],
        call_plan: [
          {
            code: "OPTION_NOT_OFFERED",
            fix: "Use the id of one of the ask's options.",
            message: '"gold" is not one of the offered options.',
            path: "content.selected[0]",
          },
        ],
      },
      currentMessages: [askMessage(planAsk())],
      onAskSubmit: async () => {},
    });

    assert.isOk(getByText('"gold" is not one of the offered options.'));
  });

  describe("when the host switches to another conversation", () => {
    const regionAsk = (toolCallId: string): ChatAsk => ({
      input: {
        options: [
          {description: "Oregon", id: "west", label: "West"},
          {id: "central", label: "Central"},
          {id: "east", label: "East"},
          {id: "europe", label: "Europe"},
          {id: "asia", label: "Asia"},
        ],
        prompt: "Where should the data live?",
        select: "one",
      },
      kind: "choice",
      status: "pending",
      toolCallId,
    });

    const chatWith = ({
      historyId,
      onAskSubmit,
      toolCallId,
    }: {
      historyId: string;
      onAskSubmit: GPTChatProps["onAskSubmit"];
      toolCallId: string;
    }): React.ReactElement => (
      <GPTChat
        currentHistoryId={historyId}
        currentMessages={[userMessage, askMessage(regionAsk(toolCallId))]}
        histories={histories}
        onAskSubmit={onAskSubmit}
        onCreateHistory={() => {}}
        onDeleteHistory={() => {}}
        onSelectHistory={() => {}}
        onSubmit={() => {}}
      />
    );

    const isDisabled = (element: {props: {accessibilityState?: {disabled?: boolean}}}): boolean =>
      element.props.accessibilityState?.disabled === true;

    it("does not carry the option chosen in one chat into the other chat's ask", async () => {
      const onAskSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByLabelText, getByTestId, rerender} = renderWithTheme(
        chatWith({historyId: "h1", onAskSubmit, toolCallId: "call_first"})
      );
      await press(getByLabelText("West — Oregon"));
      assert.isFalse(isDisabled(getByTestId("gpt-ask-call_first-submit")));

      rerender(chatWith({historyId: "h2", onAskSubmit, toolCallId: "call_second"}));

      assert.isTrue(isDisabled(getByTestId("gpt-ask-call_second-submit")));
    });

    it("does not show one chat's answer still loading on the other chat's ask", async () => {
      const onAskSubmit = mock((_submission: AskSubmission) => new Promise<void>(() => {}));
      const {getByLabelText, getByTestId, rerender} = renderWithTheme(
        chatWith({historyId: "h1", onAskSubmit, toolCallId: "call_first"})
      );
      await press(getByLabelText("West — Oregon"));
      await act(async () => {
        fireEvent.press(getByTestId("gpt-ask-call_first-submit"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.lengthOf(onAskSubmit.mock.calls, 1);

      rerender(chatWith({historyId: "h2", onAskSubmit, toolCallId: "call_second"}));

      const spinners = getByTestId("gpt-ask-call_second-submit").findAll(
        (node) => node.type === "ActivityIndicator"
      );
      assert.lengthOf(spinners, 0);
      assert.isFalse(isDisabled(getByTestId("gpt-ask-call_second-button-skip")));
    });
  });

  it("moves screen reader focus to a pending ask when it appears", () => {
    setAccessibilityFocus.mockClear();
    const scrollable = {scrollTo: (): void => {}, scrollToEnd: (): void => {}};
    const {rerender} = render(
      <GPTChat
        currentMessages={[userMessage]}
        histories={histories}
        onCreateHistory={() => {}}
        onDeleteHistory={() => {}}
        onSelectHistory={() => {}}
        onSubmit={() => {}}
      />,
      {
        createNodeMock: (element) => (element.props.role === "group" ? 42 : scrollable),
        wrapper: ThemeProvider,
      }
    );
    assert.lengthOf(setAccessibilityFocus.mock.calls, 0);

    rerender(
      <GPTChat
        currentMessages={[userMessage, askMessage(planAsk())]}
        histories={histories}
        onCreateHistory={() => {}}
        onDeleteHistory={() => {}}
        onSelectHistory={() => {}}
        onSubmit={() => {}}
      />
    );

    assert.deepEqual(setAccessibilityFocus.mock.calls, [[42]]);
  });

  it("focuses a pending ask's group on web without scrolling the page", () => {
    Platform.OS = "web";
    const focus = mock((_options: {preventScroll: boolean}) => {});
    const node = {
      addEventListener: (): void => {},
      focus,
      removeEventListener: (): void => {},
      scrollTo: (): void => {},
      scrollToEnd: (): void => {},
    };
    const {getByLabelText} = render(
      <GPTChat
        currentMessages={[userMessage, askMessage(planAsk())]}
        histories={histories}
        onCreateHistory={() => {}}
        onDeleteHistory={() => {}}
        onSelectHistory={() => {}}
        onSubmit={() => {}}
      />,
      {createNodeMock: () => node, wrapper: ThemeProvider}
    );

    assert.isOk(getByLabelText("Choose a plan"));
    assert.deepEqual(focus.mock.calls, [[{preventScroll: true}]]);
  });
});
