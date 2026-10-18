import {Box, Button, Card, DraggableList, Heading, IconButton, Text, useTheme} from "@terreno/ui";
import startCase from "lodash/startCase";
import React, {useCallback, useMemo, useRef} from "react";
import {AdminFieldRendererCore} from "./AdminFieldRendererCore";
import type {AdminFieldConfig, AdminFieldValue, RefRendererMap} from "./types";

const FIELD_HEIGHT_ESTIMATE = 76;
const CARD_HEADER_HEIGHT = 44;
const CARD_PADDING = 24;
const ITEMS_GAP = 8;

interface AdminNestedArrayFieldProps {
  title: string;
  helperText?: string;
  errorText?: string;
  items: Record<string, AdminFieldConfig>;
  value: Record<string, AdminFieldValue>[];
  onChange: (value: Record<string, AdminFieldValue>[]) => void;
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  modelConfigs?: Array<{name: string; routePath: string}>;
  /** Parent document form state, used to derive dynamic options for sub-fields */
  parentFormState?: Record<string, AdminFieldValue>;
  /** Forwarded to nested field renderers so refs in sub-documents can use custom renderers. */
  refRenderers?: RefRendererMap;
  readOnly?: boolean;
}

/**
 * Renders a single sub-field of a nested array item. Nested arrays-of-subdocuments
 * recurse into another {@link AdminNestedArrayField}; everything else is rendered
 * by {@link AdminFieldRendererCore} directly so we avoid a require cycle through
 * the AdminFieldRenderer wrapper.
 */
const renderNestedSubField = ({
  baseUrl,
  apiBase,
  routeBase,
  fieldKey,
  fieldConfig,
  fieldValue,
  index,
  modelConfigs,
  onSubFieldChange,
  parentFormState,
  refRenderers,
  readOnly,
}: {
  baseUrl?: string;
  apiBase?: string;
  routeBase?: string;
  fieldKey: string;
  fieldConfig: AdminFieldConfig;
  fieldValue: AdminFieldValue;
  index: number;
  modelConfigs?: Array<{name: string; routePath: string}>;
  onSubFieldChange: (index: number, fieldKey: string, fieldValue: AdminFieldValue) => void;
  parentFormState?: Record<string, AdminFieldValue>;
  refRenderers?: RefRendererMap;
  readOnly?: boolean;
}): React.ReactElement => {
  if (fieldConfig.type === "array" && fieldConfig.items) {
    return (
      <AdminNestedArrayField
        apiBase={apiBase}
        baseUrl={baseUrl}
        helperText={fieldConfig.description}
        items={fieldConfig.items}
        key={fieldKey}
        modelConfigs={modelConfigs}
        onChange={(val) => onSubFieldChange(index, fieldKey, val)}
        parentFormState={parentFormState}
        readOnly={readOnly}
        refRenderers={refRenderers}
        routeBase={routeBase}
        title={startCase(fieldKey)}
        value={Array.isArray(fieldValue) ? (fieldValue as Record<string, AdminFieldValue>[]) : []}
      />
    );
  }

  return (
    <AdminFieldRendererCore
      apiBase={apiBase}
      baseUrl={baseUrl}
      fieldConfig={fieldConfig}
      fieldKey={fieldKey}
      key={fieldKey}
      modelConfigs={modelConfigs}
      onChange={(val) => onSubFieldChange(index, fieldKey, val)}
      parentFormState={parentFormState}
      readOnly={readOnly}
      refRenderers={refRenderers}
      routeBase={routeBase}
      value={fieldValue}
    />
  );
};

const buildDefaultItem = (
  items: Record<string, AdminFieldConfig>
): Record<string, AdminFieldValue> => {
  const newItem: Record<string, AdminFieldValue> = {};
  for (const [key, config] of Object.entries(items)) {
    if (config.default != null) {
      newItem[key] = config.default;
    } else if (config.type === "boolean") {
      newItem[key] = false;
    } else if (config.type === "number") {
      newItem[key] = 0;
    } else if (config.type === "array") {
      newItem[key] = [];
    } else {
      newItem[key] = "";
    }
  }
  return newItem;
};

/**
 * Renders an editable, drag-and-drop reorderable list of sub-document objects.
 * Each array item is shown as a Card with the standard admin field renderers,
 * and a drag grip for reordering via DraggableList.
 */
export const AdminNestedArrayField: React.FC<AdminNestedArrayFieldProps> = ({
  title,
  helperText,
  errorText,
  items,
  value,
  onChange,
  baseUrl,
  apiBase,
  routeBase,
  modelConfigs,
  parentFormState,
  refRenderers,
  readOnly,
}) => {
  const {theme} = useTheme();
  const isReadOnly = Boolean(readOnly);
  const arrayValue = useMemo((): Record<string, AdminFieldValue>[] => {
    return Array.isArray(value) ? value : [];
  }, [value]);

  const subFieldCount = Object.keys(items).length;
  const itemHeight = CARD_HEADER_HEIGHT + subFieldCount * FIELD_HEIGHT_ESTIMATE + CARD_PADDING;

  // Stable ID counter so new items get unique IDs across the component lifetime
  const nextIdRef = useRef(arrayValue.length);

  // Maintain a parallel array of stable string IDs for DraggableList
  const itemIdsRef = useRef<string[]>(arrayValue.map((_, i) => String(i)));
  if (itemIdsRef.current.length !== arrayValue.length) {
    // Sync length if external changes happened (e.g., undo)
    while (itemIdsRef.current.length < arrayValue.length) {
      itemIdsRef.current.push(String(nextIdRef.current++));
    }
    if (itemIdsRef.current.length > arrayValue.length) {
      itemIdsRef.current = itemIdsRef.current.slice(0, arrayValue.length);
    }
  }

  // Map from stable ID to current index in arrayValue
  const idToIndexMap = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {};
    for (let i = 0; i < itemIdsRef.current.length; i++) {
      map[itemIdsRef.current[i]] = i;
    }
    return map;
  }, [arrayValue.length]);

  const handleAddItem = useCallback((): void => {
    const newItem = buildDefaultItem(items);
    const newId = String(nextIdRef.current++);
    itemIdsRef.current = [...itemIdsRef.current, newId];
    onChange([...arrayValue, newItem]);
  }, [arrayValue, items, onChange]);

  const handleRemoveItem = useCallback(
    (index: number): void => {
      const nextData = [...arrayValue];
      nextData.splice(index, 1);
      const nextIds = [...itemIdsRef.current];
      nextIds.splice(index, 1);
      itemIdsRef.current = nextIds;
      onChange(nextData);
    },
    [arrayValue, onChange]
  );

  const handleSubFieldChange = useCallback(
    (index: number, fieldKey: string, fieldValue: AdminFieldValue): void => {
      const next = arrayValue.map((item, i) => {
        if (i !== index) {
          return item;
        }
        return {...item, [fieldKey]: fieldValue};
      });
      onChange(next);
    },
    [arrayValue, onChange]
  );

  const handleReorder = useCallback(
    (newIds: string[]): void => {
      const reorderedData = newIds.map((id) => {
        const idx = idToIndexMap[id];
        return arrayValue[idx];
      });
      itemIdsRef.current = newIds;
      onChange(reorderedData);
    },
    [arrayValue, idToIndexMap, onChange]
  );

  const subFieldEntries = useMemo((): [string, AdminFieldConfig][] => {
    return Object.entries(items);
  }, [items]);

  const renderItem = useCallback(
    ({item: id}: {item: string}): React.ReactElement => {
      const index = idToIndexMap[id] ?? 0;
      const itemData = arrayValue[index];
      if (!itemData) {
        return <Box />;
      }
      const subFieldParentFormState = {
        ...(parentFormState ?? {}),
        ...itemData,
      };

      return (
        <Card padding={3}>
          <Box gap={2}>
            <Box alignItems="center" direction="row" justifyContent="between">
              <Text bold size="sm">
                Item {index + 1}
              </Text>
              {!isReadOnly ? (
                <IconButton
                  accessibilityLabel="Remove item"
                  iconName="trash"
                  onClick={() => handleRemoveItem(index)}
                  tooltipText="Remove"
                  variant="destructive"
                />
              ) : null}
            </Box>
            {subFieldEntries.map(([fieldKey, fieldConfig]) =>
              renderNestedSubField({
                apiBase,
                baseUrl,
                fieldConfig,
                fieldKey,
                fieldValue: itemData[fieldKey],
                index,
                modelConfigs,
                onSubFieldChange: handleSubFieldChange,
                parentFormState: subFieldParentFormState,
                readOnly: isReadOnly,
                refRenderers,
                routeBase,
              })
            )}
          </Box>
        </Card>
      );
    },
    [
      arrayValue,
      idToIndexMap,
      subFieldEntries,
      apiBase,
      baseUrl,
      routeBase,
      modelConfigs,
      parentFormState,
      refRenderers,
      handleRemoveItem,
      handleSubFieldChange,
      isReadOnly,
    ]
  );

  const dataIDs = itemIdsRef.current;

  return (
    <Box gap={2}>
      <Box alignItems="center" direction="row" justifyContent="between">
        <Heading size="sm">{title}</Heading>
        {!isReadOnly ? (
          <Button iconName="plus" onClick={handleAddItem} text="Add" variant="outline" />
        ) : null}
      </Box>
      {helperText ? (
        <Text color="secondaryDark" size="sm">
          {helperText}
        </Text>
      ) : null}
      {errorText ? (
        <Text color="error" size="sm">
          {errorText}
        </Text>
      ) : null}

      {arrayValue.length === 0 ? (
        <Box alignItems="center" padding={3}>
          <Text color="secondaryDark">
            {isReadOnly ? "No items." : 'No items. Click "Add" to create one.'}
          </Text>
        </Box>
      ) : isReadOnly ? (
        <Box gap={2}>
          {arrayValue.map((itemData, index) => {
            const subFieldParentFormState = {
              ...(parentFormState ?? {}),
              ...itemData,
            };
            return (
              <Card key={`ro-${index}`} padding={3}>
                <Box gap={2}>
                  <Text bold size="sm">
                    Item {index + 1}
                  </Text>
                  {subFieldEntries.map(([fieldKey, fieldConfig]) =>
                    renderNestedSubField({
                      apiBase,
                      baseUrl,
                      fieldConfig,
                      fieldKey,
                      fieldValue: itemData[fieldKey],
                      index,
                      modelConfigs,
                      onSubFieldChange: handleSubFieldChange,
                      parentFormState: subFieldParentFormState,
                      readOnly: true,
                      refRenderers,
                      routeBase,
                    })
                  )}
                </Box>
              </Card>
            );
          })}
        </Box>
      ) : (
        <DraggableList
          backgroundOnHold={theme.surface.neutralLight}
          callbackNewDataIds={handleReorder}
          dataIDs={dataIDs}
          itemHeight={itemHeight}
          itemsGap={ITEMS_GAP}
          renderItem={renderItem}
        />
      )}
    </Box>
  );
};
