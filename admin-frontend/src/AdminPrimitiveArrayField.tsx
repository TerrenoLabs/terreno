import {
  BooleanField,
  Box,
  Button,
  Heading,
  IconButton,
  SelectField,
  Text,
  TextField,
} from "@terreno/ui";
import startCase from "lodash/startCase";
import React, {useCallback} from "react";
import {AdminRefField} from "./AdminRefField";
import type {RefRendererMap} from "./types";

interface AdminPrimitiveArrayFieldProps {
  title: string;
  helperText?: string;
  errorText?: string;
  itemType: string;
  itemEnum?: string[];
  itemRef?: string;
  value: PrimitiveItem[];
  onChange: (value: PrimitiveItem[]) => void;
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  modelConfigs?: Array<{name: string; routePath: string}>;
  /**
   * Optional map of custom ref-field renderers keyed by referenced model name. When
   * `itemRef` matches a key, the custom component renders in place of the built-in
   * {@link AdminRefField} for each ref item.
   */
  refRenderers?: RefRendererMap;
  readOnly?: boolean;
  /** When true, each ref item uses async search instead of first-page prefetch. */
  autocomplete?: boolean;
}

type PrimitiveItem = string | number | boolean;

const defaultForType = (itemType: string): PrimitiveItem => {
  if (itemType === "boolean") {
    return false;
  }
  if (itemType === "number") {
    return 0;
  }
  return "";
};

/**
 * Renders an editable list of primitive values (string, number, boolean) or ObjectId refs.
 * Used for Mongoose schemas like `tags: [String]`, `scores: [Number]`, `flags: [Boolean]`,
 * or `memberIds: [{type: ObjectId, ref: "User"}]`.
 */
export const AdminPrimitiveArrayField: React.FC<AdminPrimitiveArrayFieldProps> = ({
  title,
  helperText,
  errorText,
  itemType,
  itemEnum,
  itemRef,
  value,
  onChange,
  baseUrl,
  apiBase,
  routeBase,
  modelConfigs,
  refRenderers,
  readOnly,
  autocomplete = false,
}) => {
  const isReadOnly = Boolean(readOnly);
  const arrayValue = Array.isArray(value) ? value : [];

  const handleAdd = useCallback(() => {
    onChange([...arrayValue, defaultForType(itemType)]);
  }, [arrayValue, itemType, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(arrayValue.filter((_, i) => i !== index));
    },
    [arrayValue, onChange]
  );

  const handleUpdate = useCallback(
    (index: number, itemValue: PrimitiveItem) => {
      onChange(arrayValue.map((item, i) => (i === index ? itemValue : item)));
    },
    [arrayValue, onChange]
  );

  const refModel =
    itemType === "objectid" && itemRef && modelConfigs
      ? modelConfigs.find((m) => m.name === itemRef)
      : undefined;

  const renderItemInput = (item: PrimitiveItem, index: number): React.ReactElement => {
    if (itemType === "boolean") {
      return (
        <BooleanField
          disabled={isReadOnly}
          onChange={(val: boolean) => handleUpdate(index, val)}
          title=""
          value={Boolean(item)}
        />
      );
    }
    if (itemEnum && itemEnum.length > 0) {
      return (
        <SelectField
          disabled={isReadOnly}
          onChange={(val: string) => handleUpdate(index, val)}
          options={itemEnum.map((v) => ({label: startCase(v), value: v}))}
          title=""
          value={item != null ? String(item) : ""}
        />
      );
    }
    if (itemType === "objectid" && itemRef) {
      const CustomRenderer = refRenderers?.[itemRef];
      if (CustomRenderer) {
        return (
          <CustomRenderer
            apiBase={apiBase}
            autocomplete={autocomplete}
            baseUrl={baseUrl}
            onChange={(val: string) => handleUpdate(index, val)}
            readOnly={isReadOnly}
            refModelName={itemRef}
            routeBase={routeBase}
            routePath={refModel?.routePath ?? ""}
            title=""
            value={item != null ? String(item) : ""}
          />
        );
      }
      if (refModel) {
        return (
          <AdminRefField
            apiBase={apiBase}
            autocomplete={autocomplete}
            baseUrl={baseUrl}
            onChange={(val: string) => handleUpdate(index, val)}
            readOnly={isReadOnly}
            refModelName={refModel.name}
            routeBase={routeBase}
            routePath={refModel.routePath}
            title=""
            value={item != null ? String(item) : ""}
          />
        );
      }
    }
    if (itemType === "number") {
      return (
        <TextField
          disabled={isReadOnly}
          onChange={(text: string) => {
            const num = Number(text);
            handleUpdate(index, Number.isNaN(num) ? text : num);
          }}
          testID={`admin-array-item-${index}`}
          title=""
          value={item != null ? String(item) : ""}
        />
      );
    }
    // Default: string
    return (
      <TextField
        disabled={isReadOnly}
        onChange={(val: string) => handleUpdate(index, val)}
        testID={`admin-array-item-${index}`}
        title=""
        value={item != null ? String(item) : ""}
      />
    );
  };

  return (
    <Box gap={2}>
      <Box alignItems="center" direction="row" justifyContent="between">
        <Heading size="sm">{title}</Heading>
        {!isReadOnly ? (
          <Button
            iconName="plus"
            onClick={handleAdd}
            testID={`admin-array-add-${title}`}
            text="Add"
            variant="outline"
          />
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
      ) : (
        arrayValue.map((item, index) => (
          <Box alignItems="center" direction="row" gap={2} key={`item-${index}`}>
            <Box flex="grow">{renderItemInput(item, index)}</Box>
            {!isReadOnly ? (
              <IconButton
                accessibilityLabel="Remove item"
                iconName="trash"
                onClick={() => handleRemove(index)}
                testID={`admin-array-remove-${index}`}
                variant="destructive"
              />
            ) : null}
          </Box>
        ))
      )}
    </Box>
  );
};
