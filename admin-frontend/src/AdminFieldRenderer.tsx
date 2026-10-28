import startCase from "lodash/startCase";
import React from "react";
import {AdminFieldRendererCore, type AdminFieldRendererCoreProps} from "./AdminFieldRendererCore";
import {AdminNestedArrayField} from "./AdminNestedArrayField";
import {
  AdminNestedObjectField,
  type AdminNestedObjectSubFieldArgs,
  isNestedObjectField,
} from "./AdminNestedObjectField";
import type {AdminFieldValue} from "./types";

export type AdminFieldRendererProps = AdminFieldRendererCoreProps;

/**
 * Renders an appropriate input field for a given model field in the admin form.
 *
 * Delegates arrays of sub-documents to {@link AdminNestedArrayField} and nested objects with
 * subfield metadata to {@link AdminNestedObjectField}; all other field types are rendered by
 * {@link AdminFieldRendererCore}.
 *
 * @see AdminFieldRendererCore for supported field type mappings
 * @see AdminModelForm for form usage
 */
export const AdminFieldRenderer: React.FC<AdminFieldRendererProps> = ({
  fieldKey,
  label,
  fieldConfig,
  value,
  onChange,
  errorText,
  baseUrl,
  apiBase,
  routeBase,
  api,
  modelConfigs,
  parentFormState,
  refRenderers,
  readOnly,
  autocompleteFields,
}) => {
  const title = label ?? startCase(fieldKey);

  if (fieldConfig.type === "array" && fieldConfig.items) {
    return (
      <AdminNestedArrayField
        api={api}
        apiBase={apiBase}
        baseUrl={baseUrl}
        errorText={errorText}
        helperText={fieldConfig.description}
        items={fieldConfig.items}
        modelConfigs={modelConfigs}
        onChange={onChange}
        parentFormState={parentFormState}
        readOnly={readOnly}
        refRenderers={refRenderers}
        routeBase={routeBase}
        title={title}
        value={Array.isArray(value) ? (value as Record<string, AdminFieldValue>[]) : []}
      />
    );
  }

  if (isNestedObjectField(fieldConfig) && fieldConfig.items) {
    const renderSubField = (sub: AdminNestedObjectSubFieldArgs): React.ReactElement => (
      <AdminFieldRenderer
        api={api}
        apiBase={apiBase}
        autocompleteFields={autocompleteFields}
        baseUrl={baseUrl}
        fieldConfig={sub.fieldConfig}
        fieldKey={sub.fieldKey}
        label={sub.label}
        modelConfigs={modelConfigs}
        onChange={sub.onChange}
        parentFormState={parentFormState}
        readOnly={sub.readOnly}
        refRenderers={refRenderers}
        routeBase={routeBase}
        value={sub.value}
      />
    );
    return (
      <AdminNestedObjectField
        errorText={errorText}
        fieldKey={fieldKey}
        fields={fieldConfig.items}
        helperText={fieldConfig.description}
        onChange={onChange}
        readOnly={readOnly}
        renderSubField={renderSubField}
        title={title}
        value={value}
      />
    );
  }

  return (
    <AdminFieldRendererCore
      api={api}
      apiBase={apiBase}
      autocompleteFields={autocompleteFields}
      baseUrl={baseUrl}
      errorText={errorText}
      fieldConfig={fieldConfig}
      fieldKey={fieldKey}
      label={label}
      modelConfigs={modelConfigs}
      onChange={onChange}
      parentFormState={parentFormState}
      readOnly={readOnly}
      refRenderers={refRenderers}
      routeBase={routeBase}
      value={value}
    />
  );
};
