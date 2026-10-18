import React from "react";
import {AdminObjectPicker} from "./AdminObjectPicker";
import type {RefFieldRendererProps} from "./types";

/**
 * Props for the built-in {@link AdminRefField} renderer. Re-exported as the
 * shape custom ref renderers should accept (see {@link RefFieldRendererProps}).
 */
export type AdminRefFieldProps = RefFieldRendererProps;

export const AdminRefField: React.FC<RefFieldRendererProps> = ({
  routePath,
  refModelName,
  title,
  value,
  onChange,
  errorText,
  helperText,
  readOnly,
  autocomplete = false,
  testID,
}) => {
  return (
    <AdminObjectPicker
      autocomplete={autocomplete}
      errorText={errorText}
      helperText={helperText}
      onChange={onChange}
      readOnly={readOnly}
      refModelName={refModelName}
      routePath={routePath}
      testID={testID}
      title={title}
      value={value}
    />
  );
};
