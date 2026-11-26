import type React from "react";
import {type FC, memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
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
import {useStableCallback} from "./useStableCallback";

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

type SetFilterField = (key: string, value: unknown) => void;

// Each filter kind is its own memoized field, so typing in one filter re-renders that
// filter only, not every field in the panel.

interface CustomFilterFieldProps {
  filter: DataTableColumnFilter;
  setField: SetFilterField;
  value: unknown;
}

const CustomFilterField: FC<CustomFilterFieldProps> = memo(({filter, setField, value}) => {
  const field = filter.field;
  return (
    <Box width="100%">
      {filter.renderFilter?.({
        field,
        onChange: (next) => setField(field, next),
        value,
      })}
    </Box>
  );
});
CustomFilterField.displayName = "CustomFilterField";

interface BooleanFilterFieldProps {
  field: string;
  label: string;
  setField: SetFilterField;
  showFieldClear: boolean;
  value: unknown;
}

const BooleanFilterField: FC<BooleanFilterFieldProps> = memo(
  ({field, label, setField, showFieldClear, value}) => {
    const boolValue = value === true || value === "true";
    return (
      <Box direction="column" gap={1} width="100%">
        <BooleanField
          onChange={(next: boolean) => setField(field, next)}
          testID={`data-table-filter-${field}`}
          title={label}
          value={boolValue}
        />
        {showFieldClear && value !== undefined ? (
          <Button
            onClick={() => setField(field, undefined)}
            testID={`data-table-filter-${field}-clear`}
            text="Clear filter"
            variant="ghost"
          />
        ) : null}
      </Box>
    );
  }
);
BooleanFilterField.displayName = "BooleanFilterField";

interface DateRangeFilterFieldProps {
  field: string;
  gteValue: string;
  label: string;
  lteValue: string;
  setField: SetFilterField;
}

const DateRangeFilterField: FC<DateRangeFilterFieldProps> = memo(
  ({field, gteValue, label, lteValue, setField}) => (
    <Box direction="column" gap={2} width="100%">
      <DateTimeField
        onChange={(next: string) => setField(`${field}_gte`, startOfUtcDay(next))}
        testID={`data-table-filter-${field}-gte`}
        title={`${label} from`}
        type="date"
        value={gteValue}
      />
      <DateTimeField
        onChange={(next: string) => setField(`${field}_lte`, endOfUtcDay(next))}
        testID={`data-table-filter-${field}-lte`}
        title={`${label} to`}
        type="date"
        value={lteValue}
      />
    </Box>
  )
);
DateRangeFilterField.displayName = "DateRangeFilterField";

interface NumberRangeFilterFieldProps {
  field: string;
  label: string;
  setField: SetFilterField;
  value: unknown;
}

const NumberRangeFilterField: FC<NumberRangeFilterFieldProps> = memo(
  ({field, label, setField, value}) => {
    const range = parseNumberRangeDraft(value);
    return (
      <Box direction="column" gap={2} width="100%">
        <NumberField
          onChange={(next: string) => {
            const parsed = next === "" ? undefined : Number(next);
            const current = parseNumberRangeDraft(value);
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
            const current = parseNumberRangeDraft(value);
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
  }
);
NumberRangeFilterField.displayName = "NumberRangeFilterField";

interface ChoiceFilterFieldProps {
  allowEmpty: boolean;
  field: string;
  label: string;
  options?: DataTableColumnFilter["options"];
  setField: SetFilterField;
  value: unknown;
}

const ChoiceFilterField: FC<ChoiceFilterFieldProps> = memo(
  ({allowEmpty, field, label, options, setField, value}) => {
    const choiceOptions = useMemo(
      () =>
        allowEmpty
          ? [
              {label: DATA_TABLE_CHOICE_EMPTY_LABEL, value: DATA_TABLE_CHOICE_EMPTY_VALUE},
              ...(options ?? []),
            ]
          : (options ?? []),
      [allowEmpty, options]
    );
    const handleChange = useCallback(
      (next: string[]): void => setField(field, next),
      [field, setField]
    );
    return (
      <Box width="100%">
        <MultiselectField
          onChange={handleChange}
          options={choiceOptions}
          testID={`data-table-filter-${field}`}
          title={label}
          value={toChoiceValue(value)}
        />
      </Box>
    );
  }
);
ChoiceFilterField.displayName = "ChoiceFilterField";

interface TextFilterFieldProps {
  field: string;
  label: string;
  setField: SetFilterField;
  value: string;
}

const TextFilterField: FC<TextFilterFieldProps> = memo(({field, label, setField, value}) => (
  <Box width="100%">
    <TextField
      onChange={(next: string) => setField(field, next)}
      testID={`data-table-filter-${field}`}
      title={label}
      value={value}
    />
  </Box>
));
TextFilterField.displayName = "TextFilterField";

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

  // One identity for the life of the panel, so an inline `onDraftChange` from the caller does
  // not re-render every memoized field.
  const setField = useStableCallback((key: string, value: unknown): void => {
    const next = {...draftValuesRef.current, [key]: value};
    draftValuesRef.current = next;
    onDraftChange(next);
  });

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
          <CustomFilterField
            filter={filter}
            key={field}
            setField={setField}
            value={draftValues[field]}
          />
        );
        continue;
      }
      if (filter.kind === "boolean") {
        nodes.push(
          <BooleanFilterField
            field={field}
            key={field}
            label={label}
            setField={setField}
            showFieldClear={showFieldClear}
            value={draftValues[field]}
          />
        );
        continue;
      }
      if (filter.kind === "dateRange") {
        nodes.push(
          <DateRangeFilterField
            field={field}
            gteValue={String(draftValues[`${field}_gte`] ?? "")}
            key={field}
            label={label}
            lteValue={String(draftValues[`${field}_lte`] ?? "")}
            setField={setField}
          />
        );
        continue;
      }
      if (filter.kind === "numberRange") {
        nodes.push(
          <NumberRangeFilterField
            field={field}
            key={field}
            label={label}
            setField={setField}
            value={draftValues[field]}
          />
        );
        continue;
      }
      if (filter.kind === "choice") {
        nodes.push(
          <ChoiceFilterField
            allowEmpty={filter.allowEmpty === true}
            field={field}
            key={field}
            label={label}
            options={filter.options}
            setField={setField}
            value={draftValues[field]}
          />
        );
        continue;
      }
      nodes.push(
        <TextFilterField
          field={field}
          key={field}
          label={label}
          setField={setField}
          value={String(draftValues[field] ?? "")}
        />
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
