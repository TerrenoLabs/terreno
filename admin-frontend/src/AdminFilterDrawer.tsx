import {
  BooleanField,
  Box,
  Button,
  Card,
  DateTimeField,
  Heading,
  IconButton,
  isSupportedDesktopWidth,
  Modal,
  SelectField,
  Text,
  TextField,
} from "@terreno/ui";
import startCase from "lodash/startCase";
import React, {memo, useCallback, useEffect, useMemo, useState} from "react";
import {useWindowDimensions} from "react-native";
import {AdminRefField} from "./AdminRefField";
import {
  type AdminListFilterState,
  adminFilterStateHasValues,
  areAdminFilterStatesEqual,
} from "./adminModelListQueryParams";
import type {AdminFieldConfig, AdminModelConfig} from "./types";

interface AdminFilterDrawerProps {
  appliedFilterState: AdminListFilterState;
  fields: Record<string, AdminFieldConfig>;
  filters: NonNullable<AdminModelConfig["filters"]>;
  modelConfigs?: Array<{name: string; routePath: string}>;
  onApply: (next: AdminListFilterState) => void;
}

const getRefRoutePath = (
  modelConfigs: Array<{name: string; routePath: string}> | undefined,
  refModelName: string | undefined
): string => {
  if (!refModelName) {
    return "";
  }
  return modelConfigs?.find((m) => m.name === refModelName)?.routePath ?? "";
};

type AdminFilterConfig = NonNullable<AdminModelConfig["filters"]>[number];
type AdminFilterValue = string | boolean | undefined;

interface FilterFieldProps {
  filter: AdminFilterConfig;
  /** Upper bound of a date range; unused by the other filter kinds. */
  lteValue: AdminListFilterState[string];
  onFieldChange: (key: string, value: AdminFilterValue) => void;
  refModelName: string | undefined;
  routePath: string;
  /** The filter's value, or the lower bound of a date range. */
  value: AdminListFilterState[string];
}

const FilterFieldComponent: React.FC<FilterFieldProps> = ({
  filter: f,
  lteValue,
  onFieldChange,
  refModelName,
  routePath,
  value,
}) => {
  const gteKey = `${f.field}_gte`;
  const lteKey = `${f.field}_lte`;
  const handleChange = useCallback(
    (next: string | boolean): void => {
      onFieldChange(f.field, next);
    },
    [f.field, onFieldChange]
  );
  const handleClear = useCallback((): void => {
    onFieldChange(f.field, undefined);
  }, [f.field, onFieldChange]);
  const handleGteChange = useCallback(
    (next: string): void => {
      onFieldChange(gteKey, next);
    },
    [gteKey, onFieldChange]
  );
  const handleLteChange = useCallback(
    (next: string): void => {
      onFieldChange(lteKey, next);
    },
    [lteKey, onFieldChange]
  );
  const handleChoiceChange = useCallback(
    (next: string): void => {
      onFieldChange(f.field, next === "__all__" ? "" : next);
    },
    [f.field, onFieldChange]
  );

  const label = f.label ?? startCase(f.field);
  if (f.kind === "boolean") {
    const boolValue = value === true || value === "true";
    return (
      <Box direction="column" gap={1} width="100%">
        <BooleanField
          helperText={value === undefined ? "All values" : undefined}
          onChange={handleChange}
          testID={`admin-filter-${f.field}`}
          title={label}
          value={boolValue}
        />
        {value !== undefined ? (
          <Button onClick={handleClear} text="Clear filter" variant="ghost" />
        ) : null}
      </Box>
    );
  }
  if (f.kind === "dateRange") {
    return (
      <Box direction="column" gap={2} width="100%">
        <DateTimeField
          onChange={handleGteChange}
          testID={`admin-filter-${f.field}-gte`}
          title={`${label} from`}
          type="datetime"
          value={String(value ?? "")}
        />
        <DateTimeField
          onChange={handleLteChange}
          testID={`admin-filter-${f.field}-lte`}
          title={`${label} to`}
          type="datetime"
          value={String(lteValue ?? "")}
        />
      </Box>
    );
  }
  if (f.kind === "choice") {
    return (
      <Box width="100%">
        <SelectField
          onChange={handleChoiceChange}
          options={[
            {label: "All", value: "__all__"},
            ...((f.choices ?? []) as {label: string; value: string}[]).map((c) => ({
              label: c.label,
              value: c.value,
            })),
          ]}
          testID={`admin-filter-${f.field}`}
          title={label}
          value={String(value ?? "__all__")}
        />
      </Box>
    );
  }
  if (f.kind === "ref") {
    return (
      <Box width="100%">
        <AdminRefField
          autocomplete
          onChange={handleChange}
          refModelName={refModelName ?? "Unknown"}
          routePath={routePath}
          testID={`admin-filter-${f.field}`}
          title={label}
          value={String(value ?? "")}
        />
      </Box>
    );
  }
  return (
    <Box width="100%">
      <TextField
        onChange={handleChange}
        testID={`admin-filter-${f.field}`}
        title={label}
        value={String(value ?? "")}
      />
    </Box>
  );
};

FilterFieldComponent.displayName = "FilterField";

// Memoized with primitive values so a keystroke in one filter re-renders only that filter.
const FilterField = memo(FilterFieldComponent);

interface FilterFieldsProps {
  draftState: AdminListFilterState;
  fields: Record<string, AdminFieldConfig>;
  filters: NonNullable<AdminModelConfig["filters"]>;
  modelConfigs?: Array<{name: string; routePath: string}>;
  onDraftChange: React.Dispatch<React.SetStateAction<AdminListFilterState>>;
}

const FilterFields: React.FC<FilterFieldsProps> = ({
  draftState,
  fields,
  filters,
  modelConfigs,
  onDraftChange,
}) => {
  const setField = useCallback(
    (key: string, value: AdminFilterValue): void => {
      onDraftChange((prev) => ({...prev, [key]: value}));
    },
    [onDraftChange]
  );

  return (
    <Box direction="column" gap={3} width="100%">
      {filters.map((f) => {
        const isDateRange = f.kind === "dateRange";
        const refModelName =
          f.kind === "ref" ? (f.refModel ?? fields[f.field]?.ref ?? undefined) : undefined;
        return (
          <FilterField
            filter={f}
            key={f.field}
            lteValue={isDateRange ? draftState[`${f.field}_lte`] : undefined}
            onFieldChange={setField}
            refModelName={refModelName}
            routePath={f.kind === "ref" ? getRefRoutePath(modelConfigs, refModelName) : ""}
            value={draftState[isDateRange ? `${f.field}_gte` : f.field]}
          />
        );
      })}
    </Box>
  );
};

/**
 * Collapsible filter drawer (desktop) or bottom sheet (mobile) for admin model lists.
 * Uses draft/apply so list queries update only when the user clicks Apply.
 */
export const AdminFilterDrawer: React.FC<AdminFilterDrawerProps> = ({
  appliedFilterState,
  fields,
  filters,
  modelConfigs,
  onApply,
}) => {
  const {width: windowWidth} = useWindowDimensions();
  const isMobileLayout = !isSupportedDesktopWidth({width: windowWidth});
  const [isExpanded, setIsExpanded] = useState(true);
  const [draftState, setDraftState] = useState<AdminListFilterState>(appliedFilterState);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Sync draft when applied filters change externally (e.g. model switch).
  useEffect(() => {
    setDraftState(appliedFilterState);
  }, [appliedFilterState]);

  const handleApply = useCallback(() => {
    if (areAdminFilterStatesEqual(draftState, appliedFilterState)) {
      return;
    }
    onApply(draftState);
    if (isMobileLayout) {
      setIsSheetOpen(false);
    }
  }, [appliedFilterState, draftState, isMobileLayout, onApply]);

  const handleClearAll = useCallback(() => {
    const emptyState: AdminListFilterState = {};
    if (!adminFilterStateHasValues(draftState) && !adminFilterStateHasValues(appliedFilterState)) {
      return;
    }
    setDraftState(emptyState);
    onApply(emptyState);
    if (isMobileLayout) {
      setIsSheetOpen(false);
    }
  }, [appliedFilterState, draftState, isMobileLayout, onApply]);

  const handleOpenSheet = useCallback(() => {
    setDraftState(appliedFilterState);
    setIsSheetOpen(true);
  }, [appliedFilterState]);

  const handleDismissSheet = useCallback(() => {
    setDraftState(appliedFilterState);
    setIsSheetOpen(false);
  }, [appliedFilterState]);

  const filterContent = useMemo(
    () => (
      <FilterFields
        draftState={draftState}
        fields={fields}
        filters={filters}
        modelConfigs={modelConfigs}
        onDraftChange={setDraftState}
      />
    ),
    [draftState, fields, filters, modelConfigs]
  );

  const hasDraftChanges = !areAdminFilterStatesEqual(draftState, appliedFilterState);
  const canClearFilters =
    adminFilterStateHasValues(draftState) || adminFilterStateHasValues(appliedFilterState);

  const filterActions = (
    <Box direction="row" gap={2} wrap>
      <Button
        disabled={!hasDraftChanges}
        onClick={handleApply}
        testID="admin-filter-apply"
        text="Apply filters"
        variant="primary"
      />
      <Button
        disabled={!canClearFilters}
        onClick={handleClearAll}
        testID="admin-filter-clear-all"
        text="Clear all"
        variant="outline"
      />
    </Box>
  );

  if (isMobileLayout) {
    return (
      <Box testID="admin-filter-drawer">
        <Button
          onClick={handleOpenSheet}
          testID="admin-filter-open"
          text="Filters"
          variant="outline"
        />
        <Modal
          onDismiss={handleDismissSheet}
          primaryButtonDisabled={!hasDraftChanges}
          primaryButtonOnClick={handleApply}
          primaryButtonText="Apply filters"
          secondaryButtonOnClick={handleDismissSheet}
          secondaryButtonText="Cancel"
          title="Filters"
          visible={isSheetOpen}
        >
          <Box direction="column" gap={3} testID="admin-filter-sheet">
            {filterContent}
            {filterActions}
          </Box>
        </Modal>
      </Box>
    );
  }

  return (
    <Box alignSelf="stretch" maxWidth={360} minWidth={260} testID="admin-filter-drawer">
      <Card padding={3}>
        <Box alignItems="center" direction="row" justifyContent="between">
          <Heading size="sm">Filters</Heading>
          <IconButton
            accessibilityLabel={isExpanded ? "Collapse filters" : "Expand filters"}
            iconName={isExpanded ? "chevron-up" : "chevron-down"}
            onClick={() => {
              setIsExpanded((prev) => !prev);
            }}
            variant="muted"
          />
        </Box>
        {isExpanded ? (
          <Box direction="column" gap={3} marginTop={2} width="100%">
            {filterContent}
            {filterActions}
          </Box>
        ) : (
          <Box marginTop={2}>
            <Text color="secondaryDark" size="sm">
              Filters collapsed
            </Text>
          </Box>
        )}
      </Card>
    </Box>
  );
};
