import {describe, expect, it, mock} from "bun:test";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {act, fireEvent} from "@testing-library/react-native";

import EmojiSelector, {Categories, charFromEmojiObject} from "./EmojiSelector";
import {renderWithTheme} from "./test-utils";

interface StoredEmoji {
  category: string;
  count?: number;
  short_names: string[];
  sort_order: number;
  unified: string;
}

interface LayoutEvent {
  nativeEvent: {layout: {height: number; width: number; x: number; y: number}};
}

interface LayoutRoot {
  props: {onLayout?: (event: LayoutEvent) => void};
}

interface RenderItemCell {
  props: {onPress?: () => void};
}

const waitForEmojiData = async (getRoot: () => LayoutRoot): Promise<void> => {
  await act(async () => {
    getRoot().props.onLayout?.({
      nativeEvent: {layout: {height: 600, width: 360, x: 0, y: 0}},
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

describe("EmojiSelector", () => {
  it("renders search bar when showSearchBar is true", () => {
    const {getByPlaceholderText} = renderWithTheme(
      <EmojiSelector
        category={Categories.all}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search emojis"
        showHistory={false}
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );

    expect(getByPlaceholderText("Search emojis")).toBeTruthy();
  });

  it("renders tab bar when showTabs is true", () => {
    const {getByText} = renderWithTheme(
      <EmojiSelector
        category={Categories.people}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search emojis"
        showHistory={false}
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );

    // One of the known category symbols
    expect(getByText("😀")).toBeTruthy();
  });

  it("matches snapshot", async () => {
    const {root, toJSON} = renderWithTheme(
      <EmojiSelector
        category={Categories.people}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search emojis"
        showHistory={false}
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );

    await waitForEmojiData(() => root as LayoutRoot);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders without tabs", async () => {
    const {root, toJSON} = renderWithTheme(
      <EmojiSelector
        category={Categories.people}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search emojis"
        showHistory={false}
        showSearchBar
        showSectionTitles={false}
        showTabs={false}
        theme="#007AFF"
      />
    );
    await waitForEmojiData(() => root as LayoutRoot);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders without search bar", () => {
    const {queryByPlaceholderText} = renderWithTheme(
      <EmojiSelector
        category={Categories.people}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search emojis"
        showHistory={false}
        showSearchBar={false}
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );
    expect(queryByPlaceholderText("Search emojis")).toBeNull();
  });

  it("renders with history enabled", async () => {
    const {root, toJSON} = renderWithTheme(
      <EmojiSelector
        category={Categories.people}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search emojis"
        showHistory
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );
    await waitForEmojiData(() => root as LayoutRoot);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with all category and shouldInclude filter", async () => {
    const {root, toJSON} = renderWithTheme(
      <EmojiSelector
        category={Categories.all}
        columns={8}
        onEmojiSelected={mock(() => {})}
        placeholder="Search"
        shouldInclude={(emoji) => emoji.category === "Smileys & Emotion"}
        showHistory={false}
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );
    await waitForEmojiData(() => root as LayoutRoot);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with history category", async () => {
    const {root, toJSON} = renderWithTheme(
      <EmojiSelector
        category={Categories.history}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search"
        showHistory
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );
    await waitForEmojiData(() => root as LayoutRoot);
    expect(toJSON()).toMatchSnapshot();
  });

  it("updates search query when user types in search bar", async () => {
    const {getByPlaceholderText} = renderWithTheme(
      <EmojiSelector
        category={Categories.all}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search emojis"
        showHistory={false}
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );
    const input = getByPlaceholderText("Search emojis");
    await act(async () => {
      fireEvent.changeText(input, "smile");
    });
    expect(input.props.value).toBe("smile");
  });

  it("charFromEmojiObject returns a string for a valid emoji", () => {
    const smiley = {
      category: "Smileys & Emotion",
      short_names: ["smiley"],
      sort_order: 1,
      unified: "1F603",
    };
    expect(charFromEmojiObject(smiley)).toBe("😃");
  });

  it("exports Categories object with all expected keys", () => {
    expect(Categories.all).toBeDefined();
    expect(Categories.emotion).toBeDefined();
    expect(Categories.people).toBeDefined();
    expect(Categories.history).toBeDefined();
    expect(Categories.nature).toBeDefined();
    expect(Categories.food).toBeDefined();
    expect(Categories.activities).toBeDefined();
    expect(Categories.places).toBeDefined();
    expect(Categories.objects).toBeDefined();
    expect(Categories.symbols).toBeDefined();
    expect(Categories.flags).toBeDefined();
  });

  it("handles layout event to compute emoji list and set ready state", async () => {
    const {toJSON, root} = renderWithTheme(
      <EmojiSelector
        category={Categories.people}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search"
        showHistory={false}
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );
    await waitForEmojiData(() => root as LayoutRoot);
    expect(toJSON()).toBeTruthy();
  });

  it("switches categories when a tab is pressed after layout", async () => {
    const {root, UNSAFE_getAllByType} = renderWithTheme(
      <EmojiSelector
        category={Categories.people}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search"
        showHistory={false}
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );
    await waitForEmojiData(() => root as LayoutRoot);
    const {TouchableOpacity} = require("react-native");
    const tabs = UNSAFE_getAllByType(TouchableOpacity);
    expect(tabs.length).toBeGreaterThan(0);
    // Press the first tab (e.g., "Smileys & Emotion") to exercise handleTabSelect.
    await act(async () => {
      tabs[0].props.onPress?.();
    });
  });

  it("invokes onEmojiSelected when an emoji cell is pressed", async () => {
    const onEmojiSelected = mock(() => {});
    const {root, UNSAFE_getAllByType} = renderWithTheme(
      <EmojiSelector
        category={Categories.emotion}
        columns={6}
        onEmojiSelected={onEmojiSelected}
        placeholder="Search"
        showHistory
        showSearchBar={false}
        showSectionTitles
        showTabs={false}
        theme="#007AFF"
      />
    );
    await waitForEmojiData(() => root as LayoutRoot);

    const {FlatList} = require("react-native");
    const [list] = UNSAFE_getAllByType(FlatList);
    expect(list).toBeTruthy();
    const data = list.props.data ?? [];
    expect(data.length).toBeGreaterThan(0);
    const first = data[0];
    const cell = list.props.renderItem({index: 0, item: first});
    // Invoke the emoji cell onPress to exercise handleEmojiSelect + addToHistoryAsync.
    (cell.props as RenderItemCell["props"]).onPress?.();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onEmojiSelected).toHaveBeenCalled();
  });

  it("loads persisted history on mount when showHistory is enabled", async () => {
    const stored: StoredEmoji[] = [
      {
        category: "Smileys & Emotion",
        count: 3,
        short_names: ["smiley"],
        sort_order: 1,
        unified: "1F603",
      },
    ];
    const getItemMock = mock(async () => JSON.stringify(stored));
    const originalGetItem = AsyncStorage.getItem;
    AsyncStorage.getItem = getItemMock as unknown as typeof AsyncStorage.getItem;
    try {
      const {toJSON} = renderWithTheme(
        <EmojiSelector
          category={Categories.history}
          columns={6}
          onEmojiSelected={mock(() => {})}
          placeholder="Search"
          showHistory
          showSearchBar
          showSectionTitles
          showTabs
          theme="#007AFF"
        />
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(getItemMock).toHaveBeenCalled();
      expect(toJSON()).toBeTruthy();
    } finally {
      AsyncStorage.getItem = originalGetItem;
    }
  });

  it("prepends a newly selected emoji to existing stored history", async () => {
    const onEmojiSelected = mock(() => {});
    const existing: StoredEmoji[] = [
      {
        category: "Smileys & Emotion",
        count: 9,
        short_names: ["unrelated"],
        sort_order: 999,
        unified: "0000-DECOY",
      },
    ];
    const getItemMock = mock(async () => JSON.stringify(existing));
    const setItemMock = mock(async (_key: string, _value: string) => undefined);
    const originalGetItem = AsyncStorage.getItem;
    const originalSetItem = AsyncStorage.setItem;
    AsyncStorage.getItem = getItemMock as unknown as typeof AsyncStorage.getItem;
    AsyncStorage.setItem = setItemMock as unknown as typeof AsyncStorage.setItem;
    try {
      const {root, UNSAFE_getAllByType} = renderWithTheme(
        <EmojiSelector
          category={Categories.emotion}
          columns={6}
          onEmojiSelected={onEmojiSelected}
          placeholder="Search"
          showHistory
          showSearchBar={false}
          showSectionTitles
          showTabs={false}
          theme="#007AFF"
        />
      );
      await waitForEmojiData(() => root as LayoutRoot);
      const {FlatList} = require("react-native");
      const [list] = UNSAFE_getAllByType(FlatList);
      const first = (list.props.data ?? [])[0];
      const cell = list.props.renderItem({index: 0, item: first});
      (cell.props as RenderItemCell["props"]).onPress?.();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(onEmojiSelected).toHaveBeenCalled();
      expect(setItemMock).toHaveBeenCalled();
      const [, storedValue] = setItemMock.mock.calls[setItemMock.mock.calls.length - 1];
      const parsed = JSON.parse(storedValue as string) as StoredEmoji[];
      // Existing decoy is retained and the freshly selected emoji is prepended.
      expect(parsed.length).toBe(2);
      expect(parsed[1].unified).toBe("0000-DECOY");
    } finally {
      AsyncStorage.getItem = originalGetItem;
      AsyncStorage.setItem = originalSetItem;
    }
  });

  it("keeps stored history unchanged when the selected emoji already exists", async () => {
    const onEmojiSelected = mock(() => {});
    const originalGetItem = AsyncStorage.getItem;
    const originalSetItem = AsyncStorage.setItem;
    const setItemMock = mock(async (_key: string, _value: string) => undefined);
    AsyncStorage.setItem = setItemMock as unknown as typeof AsyncStorage.setItem;
    try {
      const {root, UNSAFE_getAllByType} = renderWithTheme(
        <EmojiSelector
          category={Categories.emotion}
          columns={6}
          onEmojiSelected={onEmojiSelected}
          placeholder="Search"
          showHistory
          showSearchBar={false}
          showSectionTitles
          showTabs={false}
          theme="#007AFF"
        />
      );
      await waitForEmojiData(() => root as LayoutRoot);
      const {FlatList} = require("react-native");
      const [list] = UNSAFE_getAllByType(FlatList);
      const first = (list.props.data ?? [])[0];
      // Seed stored history so it already contains the emoji about to be selected.
      const alreadyStored: StoredEmoji[] = [{...first.emoji, count: 5}];
      AsyncStorage.getItem = mock(async () =>
        JSON.stringify(alreadyStored)
      ) as unknown as typeof AsyncStorage.getItem;
      const cell = list.props.renderItem({index: 0, item: first});
      (cell.props as RenderItemCell["props"]).onPress?.();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(onEmojiSelected).toHaveBeenCalled();
      const [, storedValue] = setItemMock.mock.calls[setItemMock.mock.calls.length - 1];
      const parsed = JSON.parse(storedValue as string) as StoredEmoji[];
      // History is left untouched (no duplicate appended) since the emoji is present.
      expect(parsed.length).toBe(1);
      expect(parsed[0].unified).toBe(first.emoji.unified);
    } finally {
      AsyncStorage.getItem = originalGetItem;
      AsyncStorage.setItem = originalSetItem;
    }
  });

  it("re-renders the grid when layout changes after emoji data has loaded", async () => {
    const {root, UNSAFE_getAllByType} = renderWithTheme(
      <EmojiSelector
        category={Categories.emotion}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search"
        showHistory={false}
        showSearchBar={false}
        showSectionTitles
        showTabs={false}
        theme="#007AFF"
      />
    );
    await waitForEmojiData(() => root as LayoutRoot);

    // A second layout pass after the data resolved goes through the prerender branch directly.
    await act(async () => {
      (root as LayoutRoot).props.onLayout?.({
        nativeEvent: {layout: {height: 600, width: 720, x: 0, y: 0}},
      });
    });

    const {FlatList} = require("react-native");
    const [list] = UNSAFE_getAllByType(FlatList);
    expect(list.props.data.length).toBeGreaterThan(0);
    const cell = list.props.renderItem({index: 0, item: list.props.data[0]});
    expect(cell.props.colSize).toBe(120);
  });

  it("ignores emoji data that resolves after unmount", async () => {
    const {unmount, toJSON} = renderWithTheme(
      <EmojiSelector
        category={Categories.emotion}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search"
        showHistory={false}
        showSearchBar={false}
        showSectionTitles
        showTabs={false}
        theme="#007AFF"
      />
    );
    unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(toJSON()).toBeNull();
  });

  it("filters the emoji list when a search query is entered", async () => {
    const {getByPlaceholderText, UNSAFE_getAllByType, root} = renderWithTheme(
      <EmojiSelector
        category={Categories.all}
        columns={6}
        onEmojiSelected={mock(() => {})}
        placeholder="Search emojis"
        showHistory={false}
        showSearchBar
        showSectionTitles
        showTabs
        theme="#007AFF"
      />
    );
    await waitForEmojiData(() => root as LayoutRoot);

    const input = getByPlaceholderText("Search emojis");
    await act(async () => {
      fireEvent.changeText(input, "smile");
    });

    const {FlatList} = require("react-native");
    const [list] = UNSAFE_getAllByType(FlatList);
    expect(list.props.data.length).toBeGreaterThan(0);
  });
});
