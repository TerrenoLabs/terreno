import {BooleanField, Box, Button, IconButton, Text, TextField} from "@terreno/ui";
import React, {memo, useCallback, useRef} from "react";

interface CheckboxItem {
  label: string;
  required: boolean;
  confirmationPrompt?: string;
}

interface CheckboxListEditorProps {
  value: CheckboxItem[];
  onChange: (value: CheckboxItem[]) => void;
  title?: string;
  helperText?: string;
  errorText?: string;
}

interface CheckboxItemEditorProps {
  index: number;
  label: string;
  required: boolean;
  confirmationPrompt: string;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof CheckboxItem, fieldValue: string | boolean) => void;
}

/** One checkbox's fields. Memoized so typing in one checkbox leaves the others alone. */
const CheckboxItemEditor = memo(
  ({
    index,
    label,
    required,
    confirmationPrompt,
    onRemove,
    onUpdate,
  }: CheckboxItemEditorProps): React.ReactElement => {
    const handleRemove = useCallback((): void => {
      onRemove(index);
    }, [index, onRemove]);

    const handleLabelChange = useCallback(
      (val: string): void => {
        onUpdate(index, "label", val);
      },
      [index, onUpdate]
    );

    const handleRequiredChange = useCallback(
      (val: boolean): void => {
        onUpdate(index, "required", val);
      },
      [index, onUpdate]
    );

    const handlePromptChange = useCallback(
      (val: string): void => {
        onUpdate(index, "confirmationPrompt", val);
      },
      [index, onUpdate]
    );

    return (
      <Box border="default" gap={2} padding={3} rounding="md">
        <Box alignItems="center" direction="row" justifyContent="between">
          <Text bold size="sm">
            Checkbox {index + 1}
          </Text>
          <IconButton
            accessibilityLabel="Remove checkbox"
            iconName="trash"
            onClick={handleRemove}
            testID={`checkbox-remove-${index}`}
            variant="destructive"
          />
        </Box>
        <TextField
          onChange={handleLabelChange}
          placeholder="Checkbox label"
          testID={`checkbox-label-${index}`}
          title="Label"
          value={label}
        />
        <BooleanField onChange={handleRequiredChange} title="Required" value={required} />
        <TextField
          onChange={handlePromptChange}
          placeholder="Optional confirmation prompt"
          testID={`checkbox-prompt-${index}`}
          title="Confirmation Prompt"
          value={confirmationPrompt}
        />
      </Box>
    );
  }
);
CheckboxItemEditor.displayName = "CheckboxItemEditor";

export const CheckboxListEditor: React.FC<CheckboxListEditorProps> = ({
  value = [],
  onChange,
  title,
  helperText,
  errorText,
}) => {
  const items: CheckboxItem[] = Array.isArray(value) ? value : [];

  // The handlers read the newest list and `onChange` through refs so their identity, and so
  // the memoized rows, stay stable while the caller passes a new array on every edit.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleAdd = useCallback((): void => {
    onChangeRef.current([...itemsRef.current, {label: "", required: false}]);
  }, []);

  const handleRemove = useCallback((index: number): void => {
    onChangeRef.current(itemsRef.current.filter((_, i) => i !== index));
  }, []);

  const handleUpdate = useCallback(
    (index: number, field: keyof CheckboxItem, fieldValue: string | boolean): void => {
      const updated = itemsRef.current.map((item, i) =>
        i === index ? {...item, [field]: fieldValue} : item
      );
      onChangeRef.current(updated);
    },
    []
  );

  return (
    <Box gap={2}>
      {title && (
        <Text bold size="md">
          {title}
        </Text>
      )}
      {helperText && (
        <Text color="secondaryDark" size="sm">
          {helperText}
        </Text>
      )}
      {items.map((item, index) => (
        <CheckboxItemEditor
          confirmationPrompt={item.confirmationPrompt ?? ""}
          index={index}
          key={`checkbox-${index}`}
          label={item.label}
          onRemove={handleRemove}
          onUpdate={handleUpdate}
          required={item.required}
        />
      ))}
      <Button
        iconName="plus"
        onClick={handleAdd}
        testID="checkbox-add-button"
        text="Add Checkbox"
        variant="outline"
      />
      {errorText && (
        <Text color="error" size="sm">
          {errorText}
        </Text>
      )}
    </Box>
  );
};
