import type React from "react";
import {type FC, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Platform} from "react-native";

import {BooleanField} from "./BooleanField";
import {Box} from "./Box";
import {Button} from "./Button";
import type {DataTableColumnFilter} from "./Common";
import {DateTimeField} from "./DateTimeField";
import {DropdownPanel} from "./DropdownPanel";
import {
  DATA_TABLE_CHOICE_EMPTY_LABEL,
  DATA_TABLE_CHOICE_EMPTY_VALUE,
  endOfUtcDay,
  startOfUtcDay,
} from "./dataTableListQuery";
import {MultiselectField} from "./MultiselectField";
import {NumberField} from "./NumberField";
import {TextField} from "./TextField";

export interface DataTableFilterFieldsProps {
  filters: DataTableColumnFilter[];
  onDraftChange: (next: Record<string, unknown>) => void;
  draftValues: Record<string, unknown>;
  search?: string;
  onSearchDraftChange?: (search: string) => void;
  showSearch?: boolean;
  /**
   * Render a per-field clear control for filters whose input cannot express "unset"
   * (booleans). Only needed when one surface hosts several filters, because the
   * surface-level clear would otherwise reset all of them.
   */
  showFieldClear?: boolean;
}

const parseNumberRangeDraft = (value: unknown): {$gte?: number; $lte?: number} => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as {$gte?: unknown; $lte?: unknown; gte?: unknown; lte?: unknown};
  const next: {$gte?: number; $lte?: number} = {};
  const gte = record.$gte ?? record.gte;
  const lte = record.$lte ?? record.lte;
  if (typeof gte === "number" && !Number.isNaN(gte)) {
    next.$gte = gte;
  }
  if (typeof lte === "number" && !Number.isNaN(lte)) {
    next.$lte = lte;
  }
  return next;
};

const toChoiceValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (typeof value === "string" && value.trim() !== "") {
    return [value.trim()];
  }
  return [];
};

export const DataTableFilterFields: FC<DataTableFilterFieldsProps> = ({
  draftValues,
  filters,
  onDraftChange,
  onSearchDraftChange,
  search = "",
  showFieldClear = false,
  showSearch = false,
}) => {
  const draftValuesRef = useRef(draftValues);
  draftValuesRef.current = draftValues;

  const setField = useCallback(
    (key: string, value: unknown): void => {
      const next = {...draftValuesRef.current, [key]: value};
      draftValuesRef.current = next;
      onDraftChange(next);
    },
    [onDraftChange]
  );

  const filterFields = useMemo((): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    if (showSearch && onSearchDraftChange) {
      nodes.push(
        <TextField
          key="data-table-filter-search"
          onChange={onSearchDraftChange}
          testID="data-table-filter-search"
          title="Search"
          type="search"
          value={search}
        />
      );
    }
    for (const filter of filters) {
      const field = filter.field;
      const label = filter.label ?? field;
      if (filter.renderFilter) {
        nodes.push(
          <Box key={field} width="100%">
            {filter.renderFilter({
              field,
              onChange: (value) => setField(field, value),
              value: draftValues[field],
            })}
          </Box>
        );
        continue;
      }
      if (filter.kind === "boolean") {
        const raw = draftValues[field];
        const boolValue = raw === true || raw === "true";
        nodes.push(
          <Box direction="column" gap={1} key={field} width="100%">
            <BooleanField
              onChange={(next: boolean) => setField(field, next)}
              testID={`data-table-filter-${field}`}
              title={label}
              value={boolValue}
            />
            {showFieldClear && raw !== undefined ? (
              <Button
                onClick={() => setField(field, undefined)}
                testID={`data-table-filter-${field}-clear`}
                text="Clear filter"
                variant="ghost"
              />
            ) : null}
          </Box>
        );
        continue;
      }
      if (filter.kind === "dateRange") {
        const gteKey = `${field}_gte`;
        const lteKey = `${field}_lte`;
        nodes.push(
          <Box direction="column" gap={2} key={field} width="100%">
            <DateTimeField
              onChange={(next: string) => setField(gteKey, startOfUtcDay(next))}
              testID={`data-table-filter-${field}-gte`}
              title={`${label} from`}
              type="date"
              value={String(draftValues[gteKey] ?? "")}
            />
            <DateTimeField
              onChange={(next: string) => setField(lteKey, endOfUtcDay(next))}
              testID={`data-table-filter-${field}-lte`}
              title={`${label} to`}
              type="date"
              value={String(draftValues[lteKey] ?? "")}
            />
          </Box>
        );
        continue;
      }
      if (filter.kind === "numberRange") {
        const range = parseNumberRangeDraft(draftValues[field]);
        nodes.push(
          <Box direction="column" gap={2} key={field} width="100%">
            <NumberField
              onChange={(next: string) => {
                const parsed = next === "" ? undefined : Number(next);
                const current = parseNumberRangeDraft(draftValues[field]);
                setField(field, {
                  ...current,
                  $gte: parsed === undefined || Number.isNaN(parsed) ? undefined : parsed,
                });
              }}
              testID={`data-table-filter-${field}-gte`}
              title={`${label} min`}
              type="number"
              value={range.$gte === undefined ? "" : String(range.$gte)}
            />
            <NumberField
              onChange={(next: string) => {
                const parsed = next === "" ? undefined : Number(next);
                const current = parseNumberRangeDraft(draftValues[field]);
                setField(field, {
                  ...current,
                  $lte: parsed === undefined || Number.isNaN(parsed) ? undefined : parsed,
                });
              }}
              testID={`data-table-filter-${field}-lte`}
              title={`${label} max`}
              type="number"
              value={range.$lte === undefined ? "" : String(range.$lte)}
            />
          </Box>
        );
        continue;
      }
      if (filter.kind === "choice") {
        const choiceOptions = filter.allowEmpty
          ? [
              {label: DATA_TABLE_CHOICE_EMPTY_LABEL, value: DATA_TABLE_CHOICE_EMPTY_VALUE},
              ...(filter.options ?? []),
            ]
          : (filter.options ?? []);
        nodes.push(
          <Box key={field} width="100%">
            <MultiselectField
              onChange={(next: string[]) => setField(field, next)}
              options={choiceOptions}
              testID={`data-table-filter-${field}`}
              title={label}
              value={toChoiceValue(draftValues[field])}
            />
          </Box>
        );
        continue;
      }
      nodes.push(
        <Box key={field} width="100%">
          <TextField
            onChange={(next: string) => setField(field, next)}
            testID={`data-table-filter-${field}`}
            title={label}
            value={String(draftValues[field] ?? "")}
          />
        </Box>
      );
    }
    return nodes;
  }, [draftValues, filters, onSearchDraftChange, search, setField, showFieldClear, showSearch]);

  return (
    <Box direction="column" gap={3} width="100%">
      {filterFields}
    </Box>
  );
};

const clearFilterKeys = (
  filter: DataTableColumnFilter,
  values: Record<string, unknown>
): Record<string, unknown> => {
  const next = {...values};
  if (filter.kind === "dateRange") {
    delete next[`${filter.field}_gte`];
    delete next[`${filter.field}_lte`];
    return next;
  }
  delete next[filter.field];
  return next;
};

const pickFilterDraft = (
  filter: DataTableColumnFilter,
  values: Record<string, unknown>
): Record<string, unknown> => {
  if (filter.kind === "dateRange") {
    const next: Record<string, unknown> = {};
    const gte = values[`${filter.field}_gte`];
    const lte = values[`${filter.field}_lte`];
    if (gte !== undefined) {
      next[`${filter.field}_gte`] = gte;
    }
    if (lte !== undefined) {
      next[`${filter.field}_lte`] = lte;
    }
    return next;
  }
  const value = values[filter.field];
  if (value === undefined) {
    return {};
  }
  return {[filter.field]: value};
};

const mergeFilterDraft = (
  filter: DataTableColumnFilter,
  applied: Record<string, unknown>,
  draft: Record<string, unknown>
): Record<string, unknown> => {
  const cleared = clearFilterKeys(filter, applied);
  return {...cleared, ...draft};
};

export interface DataTableColumnFilterWebProps {
  columnTitle: string;
  filter: DataTableColumnFilter;
  appliedValues: Record<string, unknown>;
  onApply: (next: Record<string, unknown>) => void;
  testID?: string;
}

/** Per-column web filter popover wired to DataTable controlled filter state. */
export const DataTableColumnFilterWeb: FC<DataTableColumnFilterWebProps> = ({
  appliedValues,
  columnTitle,
  filter,
  onApply,
  testID,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});
  const draftValuesRef = useRef(draftValues);
  draftValuesRef.current = draftValues;

  const setDraftValuesSync = useCallback((next: Record<string, unknown>): void => {
    draftValuesRef.current = next;
    setDraftValues(next);
  }, []);

  const wasOpenRef = useRef(false);
  // Seed draft only on closed → open so parent rerenders do not wipe in-progress input.
  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!justOpened) {
      return;
    }
    const next = pickFilterDraft(filter, appliedValues);
    draftValuesRef.current = next;
    setDraftValues(next);
  }, [appliedValues, filter, isOpen]);

  const handleApply = useCallback((): void => {
    onApply(mergeFilterDraft(filter, appliedValues, draftValuesRef.current));
  }, [appliedValues, filter, onApply]);

  const handleClear = useCallback((): void => {
    const next = clearFilterKeys(filter, draftValuesRef.current);
    draftValuesRef.current = next;
    setDraftValues(next);
  }, [filter]);

  if (Platform.OS !== "web") {
    return null;
  }

  return (
    <DropdownPanel
      iconName="filter"
      iconOnly
      isOpen={isOpen}
      label=""
      onApply={handleApply}
      onCancel={() => setIsOpen(false)}
      onClear={handleClear}
      onOpenChange={setIsOpen}
      testID={testID}
      triggerAccessibilityLabel={`Filter ${columnTitle}`}
      variant="secondary"
    >
      <DataTableFilterFields
        draftValues={draftValues}
        filters={[filter]}
        onDraftChange={setDraftValuesSync}
      />
    </DropdownPanel>
  );
};

export interface DataTableAdditionalFiltersWebProps {
  appliedValues: Record<string, unknown>;
  filters: DataTableColumnFilter[];
  onApply: (next: Record<string, unknown>) => void;
}

/** Web toolbar filter for definitions that are not attached to visible columns. */
export const DataTableAdditionalFiltersWeb: FC<DataTableAdditionalFiltersWebProps> = ({
  appliedValues,
  filters,
  onApply,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});
  const draftValuesRef = useRef(draftValues);
  draftValuesRef.current = draftValues;

  const setDraftValuesSync = useCallback((next: Record<string, unknown>): void => {
    draftValuesRef.current = next;
    setDraftValues(next);
  }, []);

  const wasOpenRef = useRef(false);
  // Seed drafts only on closed → open. Recreated `filters` arrays must not reset typing.
  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!justOpened) {
      return;
    }
    const next: Record<string, unknown> = {};
    for (const filter of filters) {
      Object.assign(next, pickFilterDraft(filter, appliedValues));
    }
    draftValuesRef.current = next;
    setDraftValues(next);
  }, [appliedValues, filters, isOpen]);

  const handleApply = useCallback((): void => {
    let next = {...appliedValues};
    for (const filter of filters) {
      next = clearFilterKeys(filter, next);
    }
    onApply({...next, ...draftValuesRef.current});
  }, [appliedValues, filters, onApply]);

  const handleClear = useCallback((): void => {
    let next = {...draftValuesRef.current};
    for (const filter of filters) {
      next = clearFilterKeys(filter, next);
    }
    draftValuesRef.current = next;
    setDraftValues(next);
  }, [filters]);

  const handleCancel = useCallback((): void => {
    setIsOpen(false);
  }, []);

  if (Platform.OS !== "web") {
    return null;
  }

  return (
    <DropdownPanel
      iconName="filter"
      isOpen={isOpen}
      label="More filters"
      onApply={handleApply}
      onCancel={handleCancel}
      onClear={handleClear}
      onOpenChange={setIsOpen}
      testID="data-table-additional-filters"
      variant="secondary"
    >
      <DataTableFilterFields
        draftValues={draftValues}
        filters={filters}
        onDraftChange={setDraftValuesSync}
        showFieldClear
      />
    </DropdownPanel>
  );
};
