import {Box, Heading, Text} from "@terreno/ui";
import startCase from "lodash/startCase";
import React, {useCallback, useMemo} from "react";
import type {AdminFieldConfig, AdminFieldValue} from "./types";
import {SYSTEM_FIELDS} from "./types";

export interface AdminNestedObjectSubFieldArgs {
  /** Dotted path of the subfield, e.g. `tasks.enabled`. */
  fieldKey: string;
  /** Humanized label of the subfield's own key. */
  label: string;
  fieldConfig: AdminFieldConfig;
  value: AdminFieldValue;
  onChange: (value: AdminFieldValue) => void;
  readOnly?: boolean;
}

interface AdminNestedObjectFieldProps {
  /** Dotted path of the object field, used as the prefix for subfield keys and test IDs. */
  fieldKey: string;
  title: string;
  helperText?: string;
  errorText?: string;
  fields: Record<string, AdminFieldConfig>;
  value: AdminFieldValue;
  onChange: (value: Record<string, AdminFieldValue>) => void;
  readOnly?: boolean;
  /**
   * Renders one subfield. Passed in by the caller so subfields can use the full renderer
   * (including nested arrays and deeper objects) without a require cycle.
   */
  renderSubField: (args: AdminNestedObjectSubFieldArgs) => React.ReactElement;
}

/** Whether a field config describes a nested object whose subfields can be rendered as a group. */
export const isNestedObjectField = (fieldConfig: AdminFieldConfig): boolean => {
  return (
    fieldConfig.type === "object" &&
    !fieldConfig.widget &&
    fieldConfig.items != null &&
    Object.keys(fieldConfig.items).length > 0
  );
};

/**
 * Initial value for a nested object in a create form: each subfield's schema default, or the
 * same blank value a top-level field of that type starts with. Enums, refs, dates, and Mixed
 * subfields without a default are left out so a blank value never fails a cast or enum check.
 */
export const buildNestedObjectDefault = (
  fields: Record<string, AdminFieldConfig>
): Record<string, AdminFieldValue> => {
  const result: Record<string, AdminFieldValue> = {};
  for (const [key, config] of Object.entries(fields)) {
    if (SYSTEM_FIELDS.has(key)) {
      continue;
    }
    if (config.default !== undefined) {
      result[key] = config.default;
    } else if (isNestedObjectField(config) && config.items) {
      result[key] = buildNestedObjectDefault(config.items);
    } else if (config.type === "boolean") {
      result[key] = false;
    } else if (config.type === "number") {
      result[key] = 0;
    } else if (config.type === "array") {
      result[key] = [];
    } else if (config.type === "string" && !config.ref && !config.enum?.length) {
      result[key] = "";
    }
  }
  return result;
};

const toObjectValue = (value: AdminFieldValue): Record<string, AdminFieldValue> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, AdminFieldValue>;
  }
  return {};
};

/**
 * Renders a nested (non-array) object path as a titled group of its subfields, each with its
 * type-appropriate control. Editing a subfield writes the merged object back to the parent.
 */
export const AdminNestedObjectField: React.FC<AdminNestedObjectFieldProps> = ({
  fieldKey,
  title,
  helperText,
  errorText,
  fields,
  value,
  onChange,
  readOnly,
  renderSubField,
}) => {
  const objectValue = useMemo((): Record<string, AdminFieldValue> => toObjectValue(value), [value]);

  const subFieldEntries = useMemo((): [string, AdminFieldConfig][] => {
    return Object.entries(fields).filter(([key]) => !SYSTEM_FIELDS.has(key));
  }, [fields]);

  const handleSubFieldChange = useCallback(
    (subKey: string, subValue: AdminFieldValue): void => {
      onChange({...objectValue, [subKey]: subValue});
    },
    [objectValue, onChange]
  );

  return (
    <Box
      border="default"
      gap={3}
      padding={3}
      rounding="md"
      testID={`admin-field-group-${fieldKey}`}
    >
      <Box gap={1}>
        <Heading size="sm">{title}</Heading>
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
      </Box>
      {subFieldEntries.map(([subKey, subConfig]) => (
        <React.Fragment key={subKey}>
          {renderSubField({
            fieldConfig: subConfig,
            fieldKey: `${fieldKey}.${subKey}`,
            label: startCase(subKey),
            onChange: (subValue: AdminFieldValue) => handleSubFieldChange(subKey, subValue),
            readOnly,
            value: objectValue[subKey] ?? subConfig.default,
          })}
        </React.Fragment>
      ))}
    </Box>
  );
};
