import {Box, Button, CheckBox, Heading, SelectField, Text, TextArea, TextField} from "@terreno/ui";
import React, {memo, useCallback, useLayoutEffect, useRef, useState} from "react";
import {
  appendListItem,
  type FormFieldNode,
  type FormGroupNode,
  type FormNode,
  readPath,
  removeAtIndex,
  setAtPath,
  type ValuePath,
} from "./expectedOutputModel";

export interface ExpectedOutputFormProps {
  disabled?: boolean;
  idPrefix: string;
  node: FormNode;
  onChange: (value: unknown) => void;
  value: unknown;
}

const pathKey = (path: ValuePath): string => {
  if (path.length === 0) {
    return "root";
  }
  return path.map((segment) => String(segment)).join(".");
};

const fieldTestId = (prefix: string, path: ValuePath): string => {
  return `${prefix}-${pathKey(path)}`;
};

const NumberField: React.FC<{
  description?: string;
  disabled?: boolean;
  label: string;
  onCommit: (next: number | null) => void;
  testID: string;
  value: unknown;
}> = ({description, disabled, label, onCommit, testID, value}) => {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const shown = draft !== undefined ? draft : typeof value === "number" ? String(value) : "";

  const handleChange = useCallback(
    (text: string): void => {
      setDraft(text);
      if (text.trim() === "") {
        onCommit(null);
        return;
      }
      if (!/^-?\d*\.?\d*$/.test(text) || text === "-" || text.endsWith(".")) {
        return;
      }
      const parsed = Number(text);
      if (Number.isNaN(parsed)) {
        return;
      }
      onCommit(parsed);
    },
    [onCommit]
  );

  const handleBlur = useCallback((): void => {
    setDraft(undefined);
  }, []);

  return (
    <TextField
      disabled={disabled}
      helperText={description}
      onBlur={handleBlur}
      onChange={handleChange}
      testID={testID}
      title={label}
      value={shown}
    />
  );
};

interface FieldInputProps {
  current: unknown;
  description?: string;
  disabled?: boolean;
  enumValues?: string[];
  kind: FormFieldNode["kind"];
  label: string;
  multiline: boolean;
  onCommit: (next: unknown) => void;
  testID: string;
}

/**
 * The control for one field. It takes the field's own value and a stable commit handler, so
 * typing in one field does not re-render the controls of every other field in the form.
 */
const FieldInput: React.FC<FieldInputProps> = memo(
  ({current, description, disabled, enumValues, kind, label, multiline, onCommit, testID}) => {
    if (kind === "boolean") {
      const selected = current === true;
      const handleToggle = (): void => {
        onCommit(!selected);
      };
      return (
        <Box gap={1}>
          <Box
            accessibilityHint="Toggles this expected value"
            accessibilityLabel={label}
            accessibilityRole="checkbox"
            alignItems="center"
            direction="row"
            gap={2}
            onClick={disabled ? undefined : handleToggle}
            testID={testID}
          >
            <CheckBox selected={selected} />
            <Text>{label}</Text>
          </Box>
          {description ? (
            <Text color="secondaryDark" size="sm">
              {description}
            </Text>
          ) : null}
        </Box>
      );
    }

    if (enumValues) {
      return (
        <SelectField
          disabled={disabled}
          helperText={description}
          onChange={(next) => {
            onCommit(next);
          }}
          options={enumValues.map((option) => ({label: option, value: option}))}
          testID={testID}
          title={label}
          value={typeof current === "string" ? current : ""}
        />
      );
    }

    if (kind === "number") {
      return (
        <NumberField
          description={description}
          disabled={disabled}
          label={label}
          onCommit={onCommit}
          testID={testID}
          value={current}
        />
      );
    }

    const text = typeof current === "string" ? current : current == null ? "" : String(current);
    if (multiline) {
      return (
        <TextArea
          disabled={disabled}
          helperText={description}
          onChange={(next) => {
            onCommit(next);
          }}
          rows={6}
          testID={testID}
          title={label}
          value={text}
        />
      );
    }
    return (
      <TextField
        disabled={disabled}
        helperText={description}
        onChange={(next) => {
          onCommit(next);
        }}
        testID={testID}
        title={label}
        value={text}
      />
    );
  }
);
FieldInput.displayName = "FieldInput";

const FieldControl: React.FC<{
  disabled?: boolean;
  field: FormFieldNode;
  idPrefix: string;
  onChange: (value: unknown) => void;
  value: unknown;
}> = ({disabled, field, idPrefix, onChange, value}) => {
  const current = readPath(value, field.path);
  const testID = fieldTestId(idPrefix, field.path);

  // Every edit replaces the root value and rebuilds the form nodes. The commit handler reads them
  // through a ref so its identity stays the same and the memoized control can skip the render.
  const latestRef = useRef({onChange, path: field.path, value});

  // Point at the newest value, path and handler after every commit, before any event can fire.
  useLayoutEffect(() => {
    latestRef.current = {onChange, path: field.path, value};
  });

  const commit = useCallback((next: unknown): void => {
    const latest = latestRef.current;
    latest.onChange(setAtPath(latest.value, latest.path, next));
  }, []);

  return (
    <FieldInput
      current={current}
      description={field.description}
      disabled={disabled}
      enumValues={field.enumValues}
      kind={field.kind}
      label={field.label}
      multiline={field.multiline}
      onCommit={commit}
      testID={testID}
    />
  );
};

const EmptyObjectFields: React.FC<{
  idPrefix: string;
  onChange: (value: unknown) => void;
  path: ValuePath;
  value: unknown;
}> = ({idPrefix, onChange, path, value}) => {
  const [name, setName] = useState("");
  const handleAdd = useCallback((): void => {
    const key = name.trim();
    if (key.length === 0) {
      return;
    }
    onChange(setAtPath(value, [...path, key], ""));
    setName("");
  }, [name, onChange, path, value]);

  return (
    <Box alignItems="end" direction="row" gap={2} wrap>
      <Box flex="grow" minWidth={200}>
        <TextField
          onChange={setName}
          testID={`${idPrefix}-add-field-name`}
          title="Field name"
          value={name}
        />
      </Box>
      <Button
        onClick={handleAdd}
        testID={`${idPrefix}-add-field`}
        text="Add field"
        variant="secondary"
      />
    </Box>
  );
};

const GroupControl: React.FC<{
  disabled?: boolean;
  idPrefix: string;
  node: FormGroupNode;
  onChange: (value: unknown) => void;
  value: unknown;
}> = ({disabled, idPrefix, node, onChange, value}) => {
  const handleAdd = useCallback((): void => {
    onChange(appendListItem(value, node.path, node.itemSchema));
  }, [node.itemSchema, node.path, onChange, value]);

  const handleRemove = useCallback(
    (index: number): void => {
      onChange(removeAtIndex(value, node.path, index));
    },
    [node.path, onChange, value]
  );

  return (
    <Box gap={3}>
      {node.title ? <Heading size="sm">{node.title}</Heading> : null}
      {node.children.map((child, index) => (
        <Box gap={2} key={pathKey(child.path)}>
          <FormNodeView
            disabled={disabled}
            idPrefix={idPrefix}
            node={child}
            onChange={onChange}
            value={value}
          />
          {node.type === "list" && !disabled ? (
            <Button
              onClick={() => {
                handleRemove(index);
              }}
              testID={`${fieldTestId(idPrefix, child.path)}-remove`}
              text="Remove"
              variant="outline"
            />
          ) : null}
        </Box>
      ))}
      {node.type === "list" && !disabled ? (
        <Button
          onClick={handleAdd}
          testID={`${fieldTestId(idPrefix, node.path)}-add`}
          text="Add entry"
          variant="secondary"
        />
      ) : null}
      {node.type === "group" && node.children.length === 0 && !disabled ? (
        <EmptyObjectFields
          idPrefix={`${fieldTestId(idPrefix, node.path)}`}
          onChange={onChange}
          path={node.path}
          value={value}
        />
      ) : null}
    </Box>
  );
};

const FormNodeView: React.FC<ExpectedOutputFormProps> = ({
  disabled,
  idPrefix,
  node,
  onChange,
  value,
}) => {
  if (node.type === "field") {
    return (
      <FieldControl
        disabled={disabled}
        field={node}
        idPrefix={idPrefix}
        onChange={onChange}
        value={value}
      />
    );
  }
  return (
    <GroupControl
      disabled={disabled}
      idPrefix={idPrefix}
      node={node}
      onChange={onChange}
      value={value}
    />
  );
};

/** Fields for one JSON value. A schema supplies missing keys, choices, and helper text. */
export const ExpectedOutputForm: React.FC<ExpectedOutputFormProps> = memo((props) => {
  return <FormNodeView {...props} />;
});
ExpectedOutputForm.displayName = "ExpectedOutputForm";
