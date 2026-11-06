import {BooleanField, DateTimeField, SelectField, TextField} from "@terreno/ui";
import startCase from "lodash/startCase";
import React from "react";
import {AdminPrimitiveArrayField} from "./AdminPrimitiveArrayField";
import {useFieldWidget} from "./AdminProvider";
import {AdminRefField} from "./AdminRefField";
import {AdminRolesField} from "./AdminRolesField";
import type {AdminFieldConfig, AdminFieldValue, AdminScreenProps, RefRendererMap} from "./types";

const USER_REF_MODEL_NAME = "User";
const USER_TARGET_FIELD_KEYS = new Set([
  "_id",
  "createdBy",
  "id",
  "ownerId",
  "sub",
  "updatedBy",
  "user._id",
  "user.id",
  "userId",
]);
const MULTI_VALUE_USER_OPERATORS = new Set(["in", "nin", "$in", "$nin"]);
const SINGLE_VALUE_USER_OPERATORS = new Set(["eq", "neq", "$eq", "$ne"]);

// Attempts to parse a string as JSON, returning the parsed value or the raw string
const parseJsonValue = (text: string): AdminFieldValue => {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

// Serializes any value to a display string for the JSON editor
const serializeJsonValue = (val: AdminFieldValue): string => {
  if (val == null) {
    return "";
  }
  if (typeof val === "string") {
    return val;
  }
  return JSON.stringify(val, null, 2);
};

const isUserTargetingValueField = (
  fieldKey: string,
  parentFormState?: Record<string, AdminFieldValue>
): boolean => {
  if (fieldKey !== "value") {
    return false;
  }
  const targetField = parentFormState?.field;
  return typeof targetField === "string" && USER_TARGET_FIELD_KEYS.has(targetField);
};

const getRefModel = (
  modelConfigs: Array<{name: string; routePath: string}> | undefined,
  refModelName: string
): {name: string; routePath: string} | undefined => {
  return modelConfigs?.find((m) => m.name === refModelName);
};

export interface AdminFieldRendererCoreProps extends AdminScreenProps {
  fieldKey: string;
  /** Field label. Defaults to the humanized `fieldKey`; nested subfields pass their own key's label. */
  label?: string;
  fieldConfig: AdminFieldConfig;
  value: AdminFieldValue;
  onChange: (value: AdminFieldValue) => void;
  errorText?: string;
  modelConfigs?: Array<{name: string; routePath: string}>;
  /** Parent document form state, used to derive dynamic options for sub-fields */
  parentFormState?: Record<string, AdminFieldValue>;
  /**
   * Optional map of custom ref-field renderers keyed by referenced model name.
   * Forwarded to {@link AdminPrimitiveArrayField} so nested fields participate in the override.
   */
  refRenderers?: RefRendererMap;
  /** When true, inputs are disabled and ref fields do not open the picker. */
  readOnly?: boolean;
  /** Field keys that should use async autocomplete for ref pickers. */
  autocompleteFields?: string[];
}

/**
 * Renders admin form fields for all types except arrays of sub-documents and nested objects
 * with subfield metadata. Those are handled by {@link AdminNestedArrayField} and
 * {@link AdminNestedObjectField} via {@link AdminFieldRenderer} to avoid a circular import.
 * Objects without `items` (Mixed, Map) fall back to the JSON editor.
 */
export const AdminFieldRendererCore: React.FC<AdminFieldRendererCoreProps> = ({
  fieldKey,
  label: labelProp,
  fieldConfig,
  value,
  onChange,
  errorText,
  baseUrl,
  apiBase,
  routeBase,
  modelConfigs,
  parentFormState,
  refRenderers,
  readOnly,
  autocompleteFields,
}) => {
  const label = labelProp ?? startCase(fieldKey);
  // Name heuristics read the subfield's own key: a dotted path also carries its parents' names.
  const leafKey = fieldKey.split(".").pop() ?? fieldKey;
  const helperText = fieldConfig.description;
  const refModel = getRefModel(modelConfigs, USER_REF_MODEL_NAME);
  const isReadOnly = Boolean(readOnly);
  const useAutocomplete = Boolean(autocompleteFields?.includes(fieldKey));
  const FieldWidget = useFieldWidget(fieldConfig.widget);

  if (FieldWidget && fieldConfig.widget) {
    return (
      <FieldWidget
        apiBase={apiBase}
        baseUrl={baseUrl}
        errorText={errorText}
        fieldConfig={fieldConfig}
        fieldKey={fieldKey}
        modelConfigs={modelConfigs}
        onChange={onChange}
        parentFormState={parentFormState}
        readOnly={readOnly}
        refRenderers={refRenderers}
        routeBase={routeBase}
        value={value}
      />
    );
  }

  if (fieldKey === "roles" && fieldConfig.type === "array" && fieldConfig.itemType === "string") {
    return (
      <AdminRolesField
        apiBase={apiBase}
        baseUrl={baseUrl}
        errorText={errorText}
        fieldConfig={fieldConfig}
        fieldKey={fieldKey}
        modelConfigs={modelConfigs}
        onChange={onChange}
        parentFormState={parentFormState}
        readOnly={readOnly}
        refRenderers={refRenderers}
        routeBase={routeBase}
        value={value}
      />
    );
  }

  if (isUserTargetingValueField(fieldKey, parentFormState)) {
    const operator = parentFormState?.operator;
    if (typeof operator === "string" && MULTI_VALUE_USER_OPERATORS.has(operator)) {
      const arrayValue = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : typeof value === "string" && value
          ? [value]
          : [];
      return (
        <AdminPrimitiveArrayField
          apiBase={apiBase}
          autocomplete={useAutocomplete}
          baseUrl={baseUrl}
          errorText={errorText}
          helperText={helperText ?? "Select users to target for this rule."}
          itemRef={USER_REF_MODEL_NAME}
          itemType="objectid"
          modelConfigs={modelConfigs}
          onChange={onChange}
          readOnly={isReadOnly}
          refRenderers={refRenderers}
          routeBase={routeBase}
          title={label}
          value={arrayValue}
        />
      );
    }
    if (typeof operator === "string" && SINGLE_VALUE_USER_OPERATORS.has(operator)) {
      const CustomRenderer = refRenderers?.[USER_REF_MODEL_NAME];
      const stringValue = typeof value === "string" ? value : "";
      if (CustomRenderer) {
        return (
          <CustomRenderer
            autocomplete={useAutocomplete}
            baseUrl={baseUrl}
            errorText={errorText}
            helperText={helperText ?? "Select the user to target for this rule."}
            onChange={onChange}
            readOnly={isReadOnly}
            refModelName={USER_REF_MODEL_NAME}
            routePath={refModel?.routePath ?? ""}
            title={label}
            value={stringValue}
          />
        );
      }
      if (refModel) {
        return (
          <AdminRefField
            autocomplete={useAutocomplete}
            baseUrl={baseUrl}
            errorText={errorText}
            helperText={helperText ?? "Select the user to target for this rule."}
            onChange={onChange}
            readOnly={isReadOnly}
            refModelName={USER_REF_MODEL_NAME}
            routePath={refModel.routePath}
            title={label}
            value={stringValue}
          />
        );
      }
    }
  }

  // Dynamic enum: look for a sibling array field whose items have a `key` property.
  if (!fieldConfig.enum && parentFormState && fieldConfig.type === "string") {
    const pluralKey = `${fieldKey}s`;
    const siblingArray = parentFormState[pluralKey];
    if (Array.isArray(siblingArray) && siblingArray.length > 0 && siblingArray[0]?.key != null) {
      const dynamicOptions = (siblingArray as Array<{key?: string}>)
        .map((item) => item.key)
        .filter(Boolean)
        .map((k) => ({label: k as string, value: k as string}));
      if (dynamicOptions.length > 0) {
        return (
          <SelectField
            disabled={isReadOnly}
            errorText={errorText}
            helperText={helperText}
            onChange={onChange}
            options={dynamicOptions}
            title={label}
            value={typeof value === "string" ? value : ""}
          />
        );
      }
    }
  }

  // ObjectId with ref -> reference field (skip arrays — those go to AdminPrimitiveArrayField)
  if (fieldConfig.ref && fieldConfig.type !== "array") {
    const CustomRenderer = refRenderers?.[fieldConfig.ref];
    const refModel = getRefModel(modelConfigs, fieldConfig.ref);
    if (CustomRenderer) {
      return (
        <CustomRenderer
          apiBase={apiBase}
          autocomplete={useAutocomplete}
          baseUrl={baseUrl}
          errorText={errorText}
          helperText={helperText}
          onChange={onChange}
          readOnly={isReadOnly}
          refModelName={fieldConfig.ref}
          routeBase={routeBase}
          routePath={refModel?.routePath ?? ""}
          title={label}
          value={typeof value === "string" ? value : ""}
        />
      );
    }
    if (refModel) {
      return (
        <AdminRefField
          apiBase={apiBase}
          autocomplete={useAutocomplete}
          baseUrl={baseUrl}
          errorText={errorText}
          helperText={helperText}
          onChange={onChange}
          readOnly={isReadOnly}
          refModelName={fieldConfig.ref}
          routeBase={routeBase}
          routePath={refModel.routePath}
          title={label}
          value={typeof value === "string" ? value : ""}
        />
      );
    }
  }

  if (fieldConfig.type === "boolean") {
    return (
      <BooleanField
        disabled={isReadOnly}
        errorText={errorText}
        helperText={helperText}
        onChange={onChange}
        testID={`admin-field-${fieldKey}`}
        title={label}
        value={typeof value === "boolean" ? value : false}
      />
    );
  }

  if (fieldConfig.enum && fieldConfig.enum.length > 0) {
    const includesNullOption = fieldConfig.enum.some((enumValue) => enumValue == null);
    const enumOptions = fieldConfig.enum
      .filter((enumValue): enumValue is string => typeof enumValue === "string")
      .map((v: string) => ({label: startCase(v), value: v}));
    const options = includesNullOption ? [{label: "None", value: ""}, ...enumOptions] : enumOptions;
    return (
      <SelectField
        disabled={isReadOnly}
        errorText={errorText}
        helperText={helperText}
        onChange={(nextValue: string) => onChange(nextValue === "" ? undefined : nextValue)}
        options={options}
        title={label}
        value={typeof value === "string" ? value : ""}
      />
    );
  }

  if (
    fieldConfig.type === "date" ||
    fieldConfig.type === "datetime" ||
    (fieldConfig.type === "string" && leafKey.toLowerCase().includes("date"))
  ) {
    return (
      <DateTimeField
        disabled={isReadOnly}
        errorText={errorText}
        helperText={helperText}
        onChange={onChange}
        testID={`admin-field-${fieldKey}`}
        title={label}
        type="datetime"
        value={typeof value === "string" ? value : ""}
      />
    );
  }

  if (fieldConfig.type === "number") {
    return (
      <TextField
        disabled={isReadOnly}
        errorText={errorText}
        helperText={helperText}
        onChange={(text: string) => {
          const num = Number(text);
          onChange(Number.isNaN(num) ? text : num);
        }}
        testID={`admin-field-${fieldKey}`}
        title={label}
        value={value != null ? String(value) : ""}
      />
    );
  }

  if (fieldConfig.type === "object" || fieldConfig.type === "mixed") {
    const displayValue = serializeJsonValue(value);
    return (
      <TextField
        disabled={isReadOnly}
        errorText={errorText}
        helperText={helperText ?? "JSON value (string, number, boolean, object, or array)"}
        onChange={(text: string) => {
          onChange(parseJsonValue(text));
        }}
        testID={`admin-field-${fieldKey}`}
        title={label}
        value={displayValue}
      />
    );
  }

  if (fieldConfig.type === "array" && fieldConfig.itemType && !fieldConfig.items) {
    return (
      <AdminPrimitiveArrayField
        apiBase={apiBase}
        autocomplete={useAutocomplete}
        baseUrl={baseUrl}
        errorText={errorText}
        helperText={helperText}
        itemEnum={fieldConfig.itemEnum}
        itemRef={fieldConfig.itemRef}
        itemType={fieldConfig.itemType}
        modelConfigs={modelConfigs}
        onChange={onChange}
        readOnly={isReadOnly}
        refRenderers={refRenderers}
        routeBase={routeBase}
        title={label}
        value={Array.isArray(value) ? value : []}
      />
    );
  }

  if (fieldConfig.type === "array") {
    const jsonValue =
      value != null ? (typeof value === "string" ? value : JSON.stringify(value, null, 2)) : "[]";
    return (
      <TextField
        disabled={isReadOnly}
        errorText={errorText}
        grow
        helperText={helperText ?? "Enter valid JSON array"}
        multiline
        onChange={(text: string) => {
          try {
            onChange(JSON.parse(text));
          } catch {
            onChange(text);
          }
        }}
        rows={4}
        testID={`admin-field-${fieldKey}`}
        title={label}
        value={jsonValue}
      />
    );
  }

  // Default: string -> TextField
  return (
    <TextField
      disabled={isReadOnly}
      errorText={errorText}
      helperText={helperText}
      onChange={onChange}
      testID={`admin-field-${fieldKey}`}
      title={label}
      value={typeof value === "string" ? value : ""}
    />
  );
};
