import {Box, Button, Card, DraggableList, Heading, IconButton, Text, useTheme} from "@terreno/ui";
import startCase from "lodash/startCase";
import React, {useCallback, useMemo, useRef} from "react";
import {AdminFieldRendererCore} from "./AdminFieldRendererCore";
import {
  AdminNestedObjectField,
  buildNestedObjectDefault,
  isNestedObjectField,
} from "./AdminNestedObjectField";
import type {AdminFieldConfig, AdminFieldValue, RefRendererMap} from "./types";
import {SYSTEM_FIELDS} from "./types";

const FIELD_HEIGHT_ESTIMATE = 76;
const CARD_HEADER_HEIGHT = 44;
const CARD_PADDING = 24;
const ITEMS_GAP = 8;
/** Border, padding, heading, and helper text of a nested object group. */
const NESTED_GROUP_CHROME_HEIGHT = 84;

interface AdminNestedArrayFieldProps {
  title: string;
  /** Dotted path of the array field; prefixes nested object group test IDs inside items. */
  fieldKey?: string;
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

interface ItemFieldArgs {
  baseUrl?: string;
  apiBase?: string;
  routeBase?: string;
  fieldKey: string;
  /**
   * Prefix for nested object group keys, e.g. `servers.0`, so test IDs stay unique per item.
   * Leaf fields directly on the item keep their bare key.
   */
  groupKeyPrefix?: string;
  label: string;
  fieldConfig: AdminFieldConfig;
  fieldValue: AdminFieldValue;
  modelConfigs?: Array<{name: string; routePath: string}>;
  onChange: (fieldValue: AdminFieldValue) => void;
  parentFormState?: Record<string, AdminFieldValue>;
  refRenderers?: RefRendererMap;
  readOnly?: boolean;
}

/**
 * Renders one field inside a nested array item. Nested arrays-of-subdocuments recurse into
 * another {@link AdminNestedArrayField} and nested objects into {@link AdminNestedObjectField};
 * everything else is rendered by {@link AdminFieldRendererCore} directly so we avoid a require
 * cycle through the AdminFieldRenderer wrapper.
 */
const renderItemField = (args: ItemFieldArgs): React.ReactElement => {
  const {
    baseUrl,
    apiBase,
    routeBase,
    fieldKey,
    groupKeyPrefix,
    label,
    fieldConfig,
    fieldValue,
    modelConfigs,
    onChange,
    parentFormState,
    refRenderers,
    readOnly,
  } = args;
  if (fieldConfig.type === "array" && fieldConfig.items) {
    return (
      <AdminNestedArrayField
        apiBase={apiBase}
        baseUrl={baseUrl}
        fieldKey={groupKeyPrefix ? `${groupKeyPrefix}.${fieldKey}` : fieldKey}
        helperText={fieldConfig.description}
        items={fieldConfig.items}
        key={fieldKey}
        modelConfigs={modelConfigs}
        onChange={onChange}
        parentFormState={parentFormState}
        readOnly={readOnly}
        refRenderers={refRenderers}
        routeBase={routeBase}
        title={label}
        value={Array.isArray(fieldValue) ? (fieldValue as Record<string, AdminFieldValue>[]) : []}
      />
    );
  }

  if (isNestedObjectField(fieldConfig) && fieldConfig.items) {
    return (
      <AdminNestedObjectField
        fieldKey={groupKeyPrefix ? `${groupKeyPrefix}.${fieldKey}` : fieldKey}
        fields={fieldConfig.items}
        helperText={fieldConfig.description}
        key={fieldKey}
        onChange={onChange}
        readOnly={readOnly}
        renderSubField={(sub) =>
          renderItemField({
            ...args,
            fieldConfig: sub.fieldConfig,
            fieldKey: sub.fieldKey,
            fieldValue: sub.value,
            groupKeyPrefix: undefined,
            label: sub.label,
            onChange: sub.onChange,
            readOnly: sub.readOnly,
          })
        }
        title={label}
        value={fieldValue}
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
      label={label}
      modelConfigs={modelConfigs}
      onChange={onChange}
      parentFormState={parentFormState}
      readOnly={readOnly}
      refRenderers={refRenderers}
      routeBase={routeBase}
      value={fieldValue}
    />
  );
};

const renderNestedSubField = ({
  index,
  itemKeyPrefix,
  onSubFieldChange,
  ...rest
}: Omit<ItemFieldArgs, "groupKeyPrefix" | "label" | "onChange"> & {
  index: number;
  itemKeyPrefix: string;
  onSubFieldChange: (index: number, fieldKey: string, fieldValue: AdminFieldValue) => void;
}): React.ReactElement => {
  return renderItemField({
    ...rest,
    groupKeyPrefix: `${itemKeyPrefix}.${index}`,
    label: startCase(rest.fieldKey),
    onChange: (val) => onSubFieldChange(index, rest.fieldKey, val),
  });
};

/**
 * Estimated rendered height of an item's subfields. DraggableList positions rows at a fixed
 * height, so nested object groups count their own subfields plus the group's chrome.
 */
const estimateSubFieldsHeight = (
  items: Record<string, AdminFieldConfig>,
  isNestedGroup = false
): number => {
  let height = 0;
  for (const [key, config] of Object.entries(items)) {
    if (isNestedGroup && SYSTEM_FIELDS.has(key)) {
      continue;
    }
    if (isNestedObjectField(config) && config.items) {
      height += NESTED_GROUP_CHROME_HEIGHT + estimateSubFieldsHeight(config.items, true);
    } else {
      height += FIELD_HEIGHT_ESTIMATE;
    }
  }
  return height;
};

/**
 * Renders an editable, drag-and-drop reorderable list of sub-document objects.
 * Each array item is shown as a Card with the standard admin field renderers,
 * and a drag grip for reordering via DraggableList.
 */
export const AdminNestedArrayField: React.FC<AdminNestedArrayFieldProps> = ({
  title,
  fieldKey: arrayFieldKey,
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

  const itemKeyPrefix = arrayFieldKey ?? "item";
  const itemHeight = CARD_HEADER_HEIGHT + estimateSubFieldsHeight(items) + CARD_PADDING;

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
    const newItem = buildNestedObjectDefault(items);
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
                itemKeyPrefix,
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
      itemKeyPrefix,
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
                      itemKeyPrefix,
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
