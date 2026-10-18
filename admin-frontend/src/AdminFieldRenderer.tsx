import startCase from "lodash/startCase";
import React from "react";
import {AdminFieldRendererCore, type AdminFieldRendererCoreProps} from "./AdminFieldRendererCore";
import {AdminNestedArrayField} from "./AdminNestedArrayField";
import type {AdminFieldValue} from "./types";

export type AdminFieldRendererProps = AdminFieldRendererCoreProps;

/**
 * Renders an appropriate input field for a given model field in the admin form.
 *
 * Delegates arrays of sub-documents to {@link AdminNestedArrayField}; all other
 * field types are rendered by {@link AdminFieldRendererCore}.
 *
 * @see AdminFieldRendererCore for supported field type mappings
 * @see AdminModelForm for form usage
 */
export const AdminFieldRenderer: React.FC<AdminFieldRendererProps> = ({
  fieldKey,
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
  if (fieldConfig.type === "array" && fieldConfig.items) {
    return (
      <AdminNestedArrayField
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
        title={startCase(fieldKey)}
        value={Array.isArray(value) ? (value as Record<string, AdminFieldValue>[]) : []}
      />
    );
  }

  return (
    <AdminFieldRendererCore
      apiBase={apiBase}
      autocompleteFields={autocompleteFields}
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
};
