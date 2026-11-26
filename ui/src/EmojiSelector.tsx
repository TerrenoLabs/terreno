/**
 * The MIT License (MIT)
 *
 * Copyright © 2019 Arron Hunt <arronjhunt@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the “Software”), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following
 * conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {FlatListProps, LayoutChangeEvent} from "react-native";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export {Categories} from "./emojiCategories";

import {Categories} from "./emojiCategories";
import {useStableCallback} from "./useStableCallback";

interface Emoji {
  unified: string;
  short_names: string[];
  category: string;
  sort_order: number;
  obsoleted_by?: string;
  [key: string]: unknown;
}

type CategoryKey = keyof typeof Categories;
type Category = (typeof Categories)[CategoryKey];

const charFromUtf16 = (utf16: string): string =>
  String.fromCodePoint(...utf16.split("-").map((u) => Number(`0x${u}`)));

export const charFromEmojiObject = (obj: Emoji): string => charFromUtf16(obj.unified);

let emojiDataPromise: Promise<Emoji[]> | undefined;

const loadEmojiData = (): Promise<Emoji[]> => {
  if (!emojiDataPromise) {
    emojiDataPromise = import("emoji-datasource").then((moduleNamespace) =>
      (moduleNamespace.default as Emoji[]).filter((entry) => !entry.obsoleted_by)
    );
  }

  return emojiDataPromise;
};

const emojiByCategory = (emojis: Emoji[], category: string): Emoji[] =>
  emojis.filter((entry) => entry.category === category);

const sortEmoji = (list: Emoji[]): Emoji[] => list.sort((a, b) => a.sort_order - b.sort_order);

const categoryKeys = Object.keys(Categories) as CategoryKey[];

interface TabBarProps {
  theme: string;
  activeCategory: Category;
  onPress: (category: Category) => void;
  width: number;
}

// Memoized so typing in the search box does not re-render every category tab.
const TabBar = memo(({theme, activeCategory, onPress, width}: TabBarProps) => {
  const tabSize = width / categoryKeys.length;

  return categoryKeys.map((c) => {
    if (c === "all") {
      return null;
    }
    const category = Categories[c];
    return (
      <TouchableOpacity
        key={category.name}
        onPress={() => onPress(category)}
        style={{
          alignItems: "center",
          borderBottomWidth: 2,
          borderColor: category === activeCategory ? theme : "#EEEEEE",
          flex: 1,
          justifyContent: "center",
          maxHeight: 60,
          minHeight: 44,
        }}
      >
        <Text
          style={{
            fontSize: Math.max(tabSize - 24, 18),
            paddingBottom: 8,
            textAlign: "center",
          }}
        >
          {category.symbol}
        </Text>
      </TouchableOpacity>
    );
  });
});
TabBar.displayName = "TabBar";

interface EmojiSelectorProps {
  theme: string;
  category: Category;
  showTabs: boolean;
  showSearchBar: boolean;
  showHistory: boolean;
  showSectionTitles: boolean;
  columns: number;
  placeholder: string;
  onEmojiSelected: (emoji: string) => void;
  shouldInclude?: (emoji: Emoji) => boolean;
  [key: string]: unknown;
}

interface EmojiListByCategory {
  [name: string]: Emoji[];
}

interface EmojiItem {
  key: string;
  emoji: Emoji;
}

interface EmojiCellProps {
  emoji: Emoji;
  colSize: number;
  onSelect: (emoji: Emoji) => void;
}

// Memoized so a parent re-render or a search keystroke does not re-render every emoji in the grid.
const EmojiCell = memo(({emoji, colSize, onSelect}: EmojiCellProps) => {
  const handlePress = useCallback((): void => {
    onSelect(emoji);
  }, [emoji, onSelect]);

  return (
    <TouchableOpacity
      activeOpacity={0.5}
      onPress={handlePress}
      style={{
        alignItems: "center",
        height: colSize,
        justifyContent: "center",
        width: colSize,
      }}
    >
      <Text style={{color: "#FFFFFF", fontSize: Math.max(colSize - 12, 6)}}>
        {charFromEmojiObject(emoji)}
      </Text>
    </TouchableOpacity>
  );
});
EmojiCell.displayName = "EmojiCell";

const storage_key = "@react-native-emoji-selector:HISTORY";

const EmojiSelector = (props: EmojiSelectorProps) => {
  const {
    theme,
    columns,
    placeholder,
    showHistory,
    showSearchBar,
    showSectionTitles,
    showTabs,
    category: initialCategory,
    shouldInclude,
    onEmojiSelected,
    ...other
  } = props;

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [category, setCategory] = useState<Category>(initialCategory);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [history, setHistory] = useState<Emoji[]>([]);
  const [filteredEmojis, setFilteredEmojis] = useState<Emoji[] | null>(null);
  const [emojiList, setEmojiList] = useState<EmojiListByCategory | null>(null);
  const [colSize, setColSize] = useState<number>(0);
  const [width, setWidth] = useState<number>(0);
  const scrollview = useRef<FlatList<EmojiItem> | null>(null);

  //
  //  HANDLER METHODS
  //
  const handleTabSelect = useCallback(
    (nextCategory: Category) => {
      if (isReady) {
        if (scrollview.current) {
          scrollview.current.scrollToOffset({animated: false, offset: 0});
        }
        setSearchQuery("");
        setCategory(nextCategory);
      }
    },
    [isReady]
  );

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const addToHistoryAsync = useCallback(async (selectedEmoji: Emoji) => {
    const stored = await AsyncStorage.getItem(storage_key);

    let value: Emoji[] = [];
    if (!stored) {
      // no history
      const record = Object.assign({}, selectedEmoji, {count: 1});
      value.push(record);
    } else {
      const json: Emoji[] = JSON.parse(stored);
      if (json.filter((r) => r.unified === selectedEmoji.unified).length > 0) {
        value = json;
      } else {
        const record = Object.assign({}, selectedEmoji, {count: 1});
        value = [record, ...json];
      }
    }

    AsyncStorage.setItem(storage_key, JSON.stringify(value));
    setHistory(value);
  }, []);

  // Stable identity so a new `onEmojiSelected` from the caller does not re-render the grid.
  const handleEmojiSelect = useStableCallback((selectedEmoji: Emoji): void => {
    if (showHistory) {
      void addToHistoryAsync(selectedEmoji);
    }
    onEmojiSelected(charFromEmojiObject(selectedEmoji));
  });

  const loadHistoryAsync = useCallback(async () => {
    const result = await AsyncStorage.getItem(storage_key);
    if (result) {
      const parsed: Emoji[] = JSON.parse(result);
      setHistory(parsed);
    }
  }, []);

  //
  //  RENDER METHODS
  //
  const renderEmojiCell: FlatListProps<EmojiItem>["renderItem"] = useCallback(
    ({item}: {item: EmojiItem}) => (
      <EmojiCell colSize={colSize} emoji={item.emoji} key={item.key} onSelect={handleEmojiSelect} />
    ),
    [handleEmojiSelect, colSize]
  );

  const returnSectionData = useCallback((): EmojiItem[] => {
    const currentEmojiList = emojiList;
    if (!currentEmojiList) {
      return [];
    }

    const currentCategory = category;
    const currentSearchQuery = searchQuery;
    const currentHistory = history;
    const currentFilteredEmojis = filteredEmojis;
    let emojiData: EmojiItem[];

    if (!currentFilteredEmojis) {
      return [];
    }

    if (currentCategory === Categories.all && currentSearchQuery === "") {
      //TODO: OPTIMIZE THIS
      const largeList: Emoji[] = [];
      for (const c of categoryKeys) {
        const name = Categories[c].name;
        const list =
          name === Categories.history.name ? currentHistory : currentEmojiList[name] || [];
        if (c !== "all" && c !== "history") {
          largeList.push(...list);
        }
      }

      emojiData = largeList.map((e) => ({emoji: e, key: e.unified}));
    } else {
      let list: Emoji[];
      const hasSearchQuery = currentSearchQuery !== "";
      const name = currentCategory.name;
      if (hasSearchQuery) {
        const filtered = currentFilteredEmojis.filter((entry) => {
          let display = false;
          for (const shortName of entry.short_names) {
            if (shortName.includes(currentSearchQuery.toLowerCase())) {
              display = true;
              break;
            }
          }
          return display;
        });
        list = sortEmoji(filtered);
      } else if (name === Categories.history.name) {
        list = currentHistory;
      } else {
        list = currentEmojiList[name] || [];
      }
      emojiData = list.map((e) => ({emoji: e, key: e.unified}));
    }

    return shouldInclude ? emojiData.filter((e) => shouldInclude(e.emoji)) : emojiData;
  }, [category, emojiList, filteredEmojis, history, searchQuery, shouldInclude]);

  const sectionData = useMemo((): EmojiItem[] => returnSectionData(), [returnSectionData]);
  const listContentStyle = useMemo(() => ({paddingBottom: colSize}), [colSize]);

  const prerenderEmojis = useCallback(
    (emojis: Emoji[], callback?: () => void) => {
      const listByCategory: EmojiListByCategory = {};
      for (const c of categoryKeys) {
        const name = Categories[c].name;
        listByCategory[name] = sortEmoji(emojiByCategory(emojis, name));
      }

      setEmojiList(listByCategory);
      setColSize(Math.max(Math.floor(width / columns), 32));
      if (callback) {
        callback();
      }
    },
    [columns, width]
  );

  const handleLayout = useCallback(
    ({nativeEvent: {layout}}: LayoutChangeEvent) => {
      setWidth(layout.width);
      if (!filteredEmojis) {
        return;
      }

      prerenderEmojis(filteredEmojis, () => {
        setIsReady(true);
      });
    },
    [filteredEmojis, prerenderEmojis]
  );

  //
  //  LIFECYCLE METHODS
  //
  useEffect(() => {
    setCategory(initialCategory);
    if (showHistory) {
      void loadHistoryAsync();
    }
  }, [initialCategory, loadHistoryAsync, showHistory]);

  // Load emoji metadata on first mount so emoji-datasource stays off cold import paths.
  useEffect(() => {
    let isCancelled = false;

    void loadEmojiData().then((emojis) => {
      if (isCancelled) {
        return;
      }

      setFilteredEmojis(emojis);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!filteredEmojis || width === 0) {
      return;
    }

    prerenderEmojis(filteredEmojis, () => {
      setIsReady(true);
    });
  }, [filteredEmojis, prerenderEmojis, width]);

  const Searchbar = (
    <View style={styles.searchbar_container}>
      <TextInput
        autoCorrect={false}
        clearButtonMode="always"
        onChangeText={handleSearch}
        placeholder={placeholder}
        returnKeyType="done"
        style={styles.search}
        underlineColorAndroid={theme}
        value={searchQuery}
      />
    </View>
  );

  const title = searchQuery !== "" ? "Search Results" : category.name;

  return (
    <View style={styles.frame} {...other} onLayout={handleLayout}>
      <View style={styles.tabBar}>
        {showTabs && (
          <TabBar activeCategory={category} onPress={handleTabSelect} theme={theme} width={width} />
        )}
      </View>
      <View style={{flex: 1}}>
        {showSearchBar && Searchbar}
        {isReady ? (
          <View style={{flex: 1}}>
            <View style={styles.container}>
              {showSectionTitles && <Text style={styles.sectionHeader}>{title}</Text>}
              <FlatList
                contentContainerStyle={listContentStyle}
                data={sectionData}
                horizontal={false}
                keyboardShouldPersistTaps={"always"}
                numColumns={columns}
                ref={scrollview}
                removeClippedSubviews
                renderItem={renderEmojiCell}
                style={styles.scrollview}
              />
            </View>
          </View>
        ) : (
          <View style={styles.loader} {...other}>
            <ActivityIndicator
              color={Platform.OS === "android" ? theme : "#000000"}
              size={"large"}
            />
          </View>
        )}
      </View>
    </View>
  );
};

EmojiSelector.defaultProps = {
  category: Categories.all,
  columns: 6,
  placeholder: "Search...",
  showHistory: false,
  showSearchBar: true,
  showSectionTitles: true,
  showTabs: true,
  theme: "#007AFF",
};

export default EmojiSelector;

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-start",
    flex: 1,
    flexDirection: "column",
    overflow: "hidden",
  },
  frame: {
    flex: 1,
    width: "100%",
  },
  loader: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  scrollview: {
    flex: 1,
    overflow: "hidden",
  },
  search: {
    ...Platform.select({
      ios: {
        backgroundColor: "#E5E8E9",
        borderRadius: 10,
        height: 36,
        paddingLeft: 8,
      },
    }),
    margin: 8,
  },
  searchbar_container: {
    backgroundColor: "rgba(255,255,255,0.75)",
    width: "100%",
    zIndex: 1,
  },
  sectionHeader: {
    color: "#8F8F8F",
    fontSize: 17,
    margin: 8,
    width: "100%",
  },
  tabBar: {
    flexDirection: "row",
    maxHeight: 60,
    minHeight: 44,
  },
});
