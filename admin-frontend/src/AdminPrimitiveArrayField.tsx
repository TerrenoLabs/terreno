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
import React, {memo, useCallback, useLayoutEffect, useRef} from "react";
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

interface PrimitiveArrayItemProps {
  item: PrimitiveItem;
  index: number;
  itemType: string;
  itemEnum?: string[];
  itemRef?: string;
  /** Name and route of the model `itemRef` resolves to, when it is a configured model. */
  refModelName?: string;
  refRoutePath?: string;
  baseUrl?: string;
  apiBase?: string;
  routeBase?: string;
  refRenderers?: RefRendererMap;
  isReadOnly: boolean;
  autocomplete: boolean;
  onUpdate: (index: number, itemValue: PrimitiveItem) => void;
  onRemove: (index: number) => void;
}

const renderItemInput = ({
  item,
  index,
  itemType,
  itemEnum,
  itemRef,
  refModelName,
  refRoutePath,
  baseUrl,
  apiBase,
  routeBase,
  refRenderers,
  isReadOnly,
  autocomplete,
  onUpdate,
}: Omit<PrimitiveArrayItemProps, "onRemove">): React.ReactElement => {
  if (itemType === "boolean") {
    return (
      <BooleanField
        disabled={isReadOnly}
        onChange={(val: boolean) => onUpdate(index, val)}
        title=""
        value={Boolean(item)}
      />
    );
  }
  if (itemEnum && itemEnum.length > 0) {
    return (
      <SelectField
        disabled={isReadOnly}
        onChange={(val: string) => onUpdate(index, val)}
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
          onChange={(val: string) => onUpdate(index, val)}
          readOnly={isReadOnly}
          refModelName={itemRef}
          routeBase={routeBase}
          routePath={refRoutePath ?? ""}
          title=""
          value={item != null ? String(item) : ""}
        />
      );
    }
    if (refModelName !== undefined && refRoutePath !== undefined) {
      return (
        <AdminRefField
          apiBase={apiBase}
          autocomplete={autocomplete}
          baseUrl={baseUrl}
          onChange={(val: string) => onUpdate(index, val)}
          readOnly={isReadOnly}
          refModelName={refModelName}
          routeBase={routeBase}
          routePath={refRoutePath}
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
          onUpdate(index, Number.isNaN(num) ? text : num);
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
      onChange={(val: string) => onUpdate(index, val)}
      testID={`admin-array-item-${index}`}
      title=""
      value={item != null ? String(item) : ""}
    />
  );
};

/**
 * One row of the list. Memoized with stable handlers so editing one item does not
 * re-render every other row's input.
 */
const PrimitiveArrayItem: React.FC<PrimitiveArrayItemProps> = memo(({onRemove, ...inputProps}) => {
  const {index, isReadOnly} = inputProps;
  return (
    <Box alignItems="center" direction="row" gap={2}>
      <Box flex="grow">{renderItemInput(inputProps)}</Box>
      {!isReadOnly ? (
        <IconButton
          accessibilityLabel="Remove item"
          iconName="trash"
          onClick={() => onRemove(index)}
          testID={`admin-array-remove-${index}`}
          variant="destructive"
        />
      ) : null}
    </Box>
  );
});
PrimitiveArrayItem.displayName = "PrimitiveArrayItem";

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

  // Rows are memoized, so their handlers keep one identity and read the newest list and
  // `onChange` from a ref that is refreshed after every commit.
  const latestRef = useRef({arrayValue, onChange});
  // Point the row handlers at the newest list and `onChange` before any event can fire.
  useLayoutEffect(() => {
    latestRef.current = {arrayValue, onChange};
  });

  const handleRemove = useCallback((index: number): void => {
    const latest = latestRef.current;
    latest.onChange(latest.arrayValue.filter((_, i) => i !== index));
  }, []);

  const handleUpdate = useCallback((index: number, itemValue: PrimitiveItem): void => {
    const latest = latestRef.current;
    latest.onChange(latest.arrayValue.map((item, i) => (i === index ? itemValue : item)));
  }, []);

  const refModel =
    itemType === "objectid" && itemRef && modelConfigs
      ? modelConfigs.find((m) => m.name === itemRef)
      : undefined;

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
          <PrimitiveArrayItem
            apiBase={apiBase}
            autocomplete={autocomplete}
            baseUrl={baseUrl}
            index={index}
            isReadOnly={isReadOnly}
            item={item}
            itemEnum={itemEnum}
            itemRef={itemRef}
            itemType={itemType}
            key={`item-${index}`}
            onRemove={handleRemove}
            onUpdate={handleUpdate}
            refModelName={refModel?.name}
            refRenderers={refRenderers}
            refRoutePath={refModel?.routePath}
            routeBase={routeBase}
          />
        ))
      )}
    </Box>
  );
};
