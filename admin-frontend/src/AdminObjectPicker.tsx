import {Box, IconButton, Spinner, Text, TextField} from "@terreno/ui";
import React, {useCallback, useEffect, useRef, useState} from "react";
import {withQueryString} from "./adminRpc";
import {unwrapAdminEnvelope, useAdminRpc, useAdminRpcQuery} from "./useAdminRpc";

/** Generic referenced document — admin can pick from any Mongoose model so the shape varies. */
interface PickerItem {
  _id?: string;
  name?: string;
  title?: string;
  email?: string;
  label?: string;
  displayName?: string;
  [key: string]: unknown;
}

interface AdminObjectPickerProps {
  routePath: string;
  refModelName: string;
  title: string;
  value: string;
  onChange: (value: string) => void;
  errorText?: string;
  helperText?: string;
  readOnly?: boolean;
  /** When true, search as the user types; otherwise prefetch the first page on open. */
  autocomplete?: boolean;
  testID?: string;
}

const DISPLAY_FIELDS = ["name", "title", "email", "label", "displayName"] as const;
type DisplayField = (typeof DISPLAY_FIELDS)[number];

const getDisplayValue = (item: PickerItem): string => {
  for (const field of DISPLAY_FIELDS) {
    const val = item[field];
    if (val) {
      return String(val);
    }
  }
  return item._id ?? String(item);
};

const getSecondaryText = (item: PickerItem, primaryField: string): string | undefined => {
  for (const field of DISPLAY_FIELDS) {
    const val = item[field];
    if (field !== primaryField && val) {
      return String(val);
    }
  }
  return undefined;
};

const getPrimaryField = (item: PickerItem): DisplayField | "_id" => {
  for (const field of DISPLAY_FIELDS) {
    if (item[field]) {
      return field;
    }
  }
  return "_id";
};

export const AdminObjectPicker: React.FC<AdminObjectPickerProps> = ({
  routePath,
  refModelName,
  title,
  value,
  onChange,
  errorText,
  helperText,
  readOnly,
  autocomplete = false,
  testID,
}) => {
  const [searchText, setSearchText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [selectedDisplay, setSelectedDisplay] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Clear pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const rpc = useAdminRpc();
  const {data: searchData, isFetching: isSearching} = useAdminRpcQuery<
    {data?: PickerItem[]} | PickerItem[]
  >({
    rpc,
    skip: !autocomplete || !debouncedQuery,
    url: withQueryString({params: {q: debouncedQuery}, url: `${routePath}/search`}),
  });
  const {data: listData, isFetching: isListLoading} = useAdminRpcQuery<
    {data?: PickerItem[]} | PickerItem[]
  >({
    rpc,
    skip: autocomplete || !isOpen,
    url: withQueryString({params: {limit: 100, page: 1}, url: routePath}),
  });
  // Fetch the currently selected item to display its name.
  const {data: selectedItem, isLoading: isSelectedLoading} = useAdminRpcQuery<PickerItem>({
    rpc,
    skip: !value,
    transformResponse: unwrapAdminEnvelope,
    url: `${routePath}/${value}`,
  });

  // Update display when selected item loads
  useEffect(() => {
    if (selectedItem && value) {
      setSelectedDisplay(getDisplayValue(selectedItem));
    }
  }, [selectedItem, value]);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    setIsOpen(true);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(text);
    }, 300);
  }, []);

  const handleSelect = useCallback(
    (item: PickerItem) => {
      onChange(item._id ?? "");
      setSelectedDisplay(getDisplayValue(item));
      setSearchText("");
      setDebouncedQuery("");
      setIsOpen(false);
      setIsChanging(false);
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    onChange("");
    setSelectedDisplay("");
    setSearchText("");
    setDebouncedQuery("");
    setIsOpen(false);
    setIsChanging(false);
  }, [onChange]);

  const handleChange = useCallback(() => {
    setSearchText("");
    setDebouncedQuery("");
    setIsChanging(true);
    setIsOpen(true);
  }, []);

  // Search responds with `{data: [...]}`; accept a bare array too.
  const searchResults = Array.isArray(searchData)
    ? searchData
    : ((searchData as {data?: unknown[]} | undefined)?.data ?? []);

  const listPayload = listData as {data?: PickerItem[]} | undefined;
  const listItems: PickerItem[] = listPayload?.data ?? [];

  const normalizedQuery = searchText.trim().toLowerCase();
  const prefetchResults =
    normalizedQuery.length === 0
      ? listItems
      : listItems.filter((item: PickerItem) =>
          getDisplayValue(item).toLowerCase().includes(normalizedQuery)
        );

  const results = autocomplete ? searchResults : prefetchResults;
  const isResultsLoading = autocomplete ? isSearching : isListLoading;

  if (readOnly) {
    const roValue =
      selectedDisplay || (value && isSelectedLoading ? "Loading…" : value ? String(value) : "");
    return (
      <TextField
        disabled
        errorText={errorText}
        helperText={helperText}
        onChange={() => {}}
        testID={`admin-picker-${refModelName}-readonly`}
        title={title}
        value={roValue}
      />
    );
  }

  return (
    <Box gap={1}>
      {value && selectedDisplay && !isChanging ? (
        <Box alignItems="center" direction="row" gap={2}>
          <Box flex="grow">
            <TextField
              disabled
              helperText={helperText}
              onChange={() => {}}
              testID={`admin-picker-${refModelName}-display`}
              title={title}
              value={selectedDisplay}
            />
          </Box>
          <IconButton
            accessibilityHint="Opens search to pick a different value"
            accessibilityLabel="Change selection"
            iconName="pencil"
            onClick={handleChange}
            testID={`admin-picker-${refModelName}-change`}
          />
          <IconButton
            accessibilityHint="Clears the current selection"
            accessibilityLabel="Clear selection"
            iconName="xmark"
            onClick={handleClear}
            testID={`admin-picker-${refModelName}-clear`}
          />
        </Box>
      ) : (
        <TextField
          errorText={errorText}
          helperText={isOpen ? (autocomplete ? "Type to search" : "Pick from list") : helperText}
          onChange={handleSearchChange}
          onFocus={() => setIsOpen(true)}
          testID={testID ?? `admin-picker-${refModelName}-search`}
          title={title}
          value={searchText}
        />
      )}

      {isOpen && (
        <Box border="default" maxHeight={250} overflow="scrollY" rounding="md">
          {isResultsLoading && (
            <Box alignItems="center" padding={3}>
              <Spinner />
            </Box>
          )}

          {!isResultsLoading && autocomplete && debouncedQuery && results.length === 0 && (
            <Box padding={3}>
              <Text color="secondaryDark" size="sm">
                No results found
              </Text>
            </Box>
          )}

          {!isResultsLoading &&
            (results as PickerItem[]).map((item) => {
              const primaryField = getPrimaryField(item);
              const secondary = getSecondaryText(item, primaryField);
              return (
                <Box
                  accessibilityHint={`Selects ${getDisplayValue(item)}`}
                  accessibilityLabel={`Select ${getDisplayValue(item)}`}
                  key={item._id}
                  onClick={() => handleSelect(item)}
                  paddingX={3}
                  paddingY={2}
                  testID={`admin-picker-${refModelName}-result-${item._id}`}
                >
                  <Text size="sm" skipLinking>
                    {getDisplayValue(item)}
                  </Text>
                  {secondary && (
                    <Text color="secondaryDark" size="sm" skipLinking>
                      {secondary}
                    </Text>
                  )}
                </Box>
              );
            })}

          {!isResultsLoading && autocomplete && !debouncedQuery && (
            <Box padding={3}>
              <Text color="secondaryDark" size="sm">
                Start typing to search
              </Text>
            </Box>
          )}

          {!isResultsLoading && !autocomplete && results.length === 0 && (
            <Box padding={3}>
              <Text color="secondaryDark" size="sm">
                No items available
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
