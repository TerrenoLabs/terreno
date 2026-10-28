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
import React, {useCallback, useEffect, useMemo, useState} from "react";
import {useWindowDimensions} from "react-native";
import {AdminRefField} from "./AdminRefField";
import {
  type AdminListFilterState,
  adminFilterStateHasValues,
  areAdminFilterStatesEqual,
} from "./adminModelListQueryParams";
import type {AdminApi, AdminFieldConfig, AdminModelConfig} from "./types";

interface AdminFilterDrawerProps {
  api: AdminApi;
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

interface FilterFieldsProps {
  api: AdminApi;
  draftState: AdminListFilterState;
  fields: Record<string, AdminFieldConfig>;
  filters: NonNullable<AdminModelConfig["filters"]>;
  modelConfigs?: Array<{name: string; routePath: string}>;
  onDraftChange: (next: AdminListFilterState) => void;
}

const FilterFields: React.FC<FilterFieldsProps> = ({
  api,
  draftState,
  fields,
  filters,
  modelConfigs,
  onDraftChange,
}) => {
  const setField = useCallback(
    (key: string, value: string | boolean | undefined) => {
      onDraftChange({...draftState, [key]: value});
    },
    [draftState, onDraftChange]
  );

  return (
    <Box direction="column" gap={3} width="100%">
      {filters.map((f) => {
        const label = f.label ?? startCase(f.field);
        if (f.kind === "boolean") {
          const raw = draftState[f.field];
          const boolValue = raw === true || raw === "true";
          return (
            <Box direction="column" gap={1} key={f.field} width="100%">
              <BooleanField
                helperText={raw === undefined ? "All values" : undefined}
                onChange={(next: boolean) => {
                  setField(f.field, next);
                }}
                testID={`admin-filter-${f.field}`}
                title={label}
                value={boolValue}
              />
              {raw !== undefined ? (
                <Button
                  onClick={() => {
                    setField(f.field, undefined);
                  }}
                  text="Clear filter"
                  variant="ghost"
                />
              ) : null}
            </Box>
          );
        }
        if (f.kind === "dateRange") {
          const gteKey = `${f.field}_gte`;
          const lteKey = `${f.field}_lte`;
          return (
            <Box direction="column" gap={2} key={f.field} width="100%">
              <DateTimeField
                onChange={(next: string) => {
                  setField(gteKey, next);
                }}
                testID={`admin-filter-${f.field}-gte`}
                title={`${label} from`}
                type="datetime"
                value={String(draftState[gteKey] ?? "")}
              />
              <DateTimeField
                onChange={(next: string) => {
                  setField(lteKey, next);
                }}
                testID={`admin-filter-${f.field}-lte`}
                title={`${label} to`}
                type="datetime"
                value={String(draftState[lteKey] ?? "")}
              />
            </Box>
          );
        }
        if (f.kind === "choice") {
          return (
            <Box key={f.field} width="100%">
              <SelectField
                onChange={(next: string) => {
                  setField(f.field, next === "__all__" ? "" : next);
                }}
                options={[
                  {label: "All", value: "__all__"},
                  ...((f.choices ?? []) as {label: string; value: string}[]).map((c) => ({
                    label: c.label,
                    value: c.value,
                  })),
                ]}
                testID={`admin-filter-${f.field}`}
                title={label}
                value={String(draftState[f.field] ?? "__all__")}
              />
            </Box>
          );
        }
        if (f.kind === "ref") {
          const refModelName =
            (f as {refModel?: string}).refModel ?? fields[f.field]?.ref ?? undefined;
          const routePath = getRefRoutePath(modelConfigs, refModelName);
          return (
            <Box key={f.field} width="100%">
              <AdminRefField
                api={api}
                autocomplete
                onChange={(next: string) => {
                  setField(f.field, next);
                }}
                refModelName={refModelName ?? "Unknown"}
                routePath={routePath}
                testID={`admin-filter-${f.field}`}
                title={label}
                value={String(draftState[f.field] ?? "")}
              />
            </Box>
          );
        }
        return (
          <Box key={f.field} width="100%">
            <TextField
              onChange={(next: string) => {
                setField(f.field, next);
              }}
              testID={`admin-filter-${f.field}`}
              title={label}
              value={String(draftState[f.field] ?? "")}
            />
          </Box>
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
  api,
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
        api={api}
        draftState={draftState}
        fields={fields}
        filters={filters}
        modelConfigs={modelConfigs}
        onDraftChange={setDraftState}
      />
    ),
    [api, draftState, fields, filters, modelConfigs]
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
