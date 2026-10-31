import {MarkdownEditorField, SelectField, TextField} from "@terreno/ui";
import startCase from "lodash/startCase";
import React from "react";
import {CheckboxListEditor} from "../CheckboxListEditor";
import {LocaleContentEditor} from "../LocaleContentEditor";
import type {AdminFieldValue, AdminFieldWidgetProps} from "../types";

const serializeJsonValue = (val: AdminFieldValue): string => {
  if (val == null) {
    return "";
  }
  if (typeof val === "string") {
    return val;
  }
  return JSON.stringify(val, null, 2);
};

export const MarkdownFieldWidget: React.FC<AdminFieldWidgetProps> = ({
  fieldKey,
  fieldConfig,
  value,
  onChange,
  errorText,
  readOnly,
}) => {
  const label = startCase(fieldKey);
  const isReadOnly = Boolean(readOnly);
  return (
    <MarkdownEditorField
      disabled={isReadOnly}
      errorText={errorText}
      helperText={fieldConfig.description}
      onChange={onChange}
      testID={`admin-field-${fieldKey}`}
      title={label}
      value={typeof value === "string" ? value : ""}
    />
  );
};

/** Markdown editor without the preview pane, for LLM prompts that are read as source. */
export const PromptFieldWidget: React.FC<AdminFieldWidgetProps> = ({
  fieldKey,
  fieldConfig,
  value,
  onChange,
  errorText,
  readOnly,
}) => {
  const label = startCase(fieldKey);
  const isReadOnly = Boolean(readOnly);
  return (
    <MarkdownEditorField
      disabled={isReadOnly}
      errorText={errorText}
      helperText={fieldConfig.description}
      onChange={onChange}
      showPreview={false}
      testID={`admin-field-${fieldKey}`}
      title={label}
      value={typeof value === "string" ? value : ""}
    />
  );
};

export const TextareaFieldWidget: React.FC<AdminFieldWidgetProps> = ({
  fieldKey,
  fieldConfig,
  value,
  onChange,
  errorText,
  readOnly,
}) => {
  const label = startCase(fieldKey);
  const isReadOnly = Boolean(readOnly);
  return (
    <TextField
      disabled={isReadOnly}
      errorText={errorText}
      grow
      helperText={fieldConfig.description}
      multiline
      onChange={onChange}
      rows={6}
      testID={`admin-field-${fieldKey}`}
      title={label}
      value={typeof value === "string" ? value : ""}
    />
  );
};

export const CheckboxListFieldWidget: React.FC<AdminFieldWidgetProps> = ({
  fieldKey,
  fieldConfig,
  value,
  onChange,
  errorText,
  readOnly,
}) => {
  const label = startCase(fieldKey);
  const isReadOnly = Boolean(readOnly);
  if (isReadOnly) {
    return (
      <TextField
        disabled
        grow
        helperText={fieldConfig.description ?? "Read-only"}
        multiline
        onChange={() => {}}
        rows={6}
        testID={`admin-field-${fieldKey}`}
        title={label}
        value={serializeJsonValue(value)}
      />
    );
  }
  return (
    <CheckboxListEditor
      errorText={errorText}
      helperText={fieldConfig.description}
      onChange={onChange}
      title={label}
      value={
        Array.isArray(value)
          ? (value as React.ComponentProps<typeof CheckboxListEditor>["value"])
          : []
      }
    />
  );
};

export const LocaleContentFieldWidget: React.FC<AdminFieldWidgetProps> = ({
  fieldKey,
  fieldConfig,
  value,
  onChange,
  errorText,
  readOnly,
}) => {
  const label = startCase(fieldKey);
  const isReadOnly = Boolean(readOnly);
  const localeValue =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};
  if (isReadOnly) {
    return (
      <TextField
        disabled
        grow
        helperText={fieldConfig.description ?? "Read-only"}
        multiline
        onChange={() => {}}
        rows={8}
        testID={`admin-field-${fieldKey}`}
        title={label}
        value={serializeJsonValue(localeValue)}
      />
    );
  }
  return (
    <LocaleContentEditor
      errorText={errorText}
      helperText={fieldConfig.description}
      onChange={onChange}
      title={label}
      value={localeValue}
    />
  );
};

export const LocaleDefaultFieldWidget: React.FC<AdminFieldWidgetProps> = ({
  fieldKey,
  fieldConfig,
  value,
  onChange,
  errorText,
  readOnly,
  parentFormState,
}) => {
  const label = startCase(fieldKey);
  const isReadOnly = Boolean(readOnly);
  const contentMap = parentFormState?.content;
  const localeKeys =
    contentMap && typeof contentMap === "object" && !Array.isArray(contentMap)
      ? Object.keys(contentMap)
      : [];
  const hasLocales = localeKeys.length > 0;
  const options = localeKeys.map((k) => ({label: k.toUpperCase(), value: k}));
  return (
    <SelectField
      disabled={!hasLocales || isReadOnly}
      errorText={errorText}
      helperText={
        hasLocales
          ? fieldConfig.description
          : "Add at least one locale with content before setting a default locale."
      }
      onChange={onChange}
      options={options}
      title={label}
      value={typeof value === "string" ? value : ""}
    />
  );
};
