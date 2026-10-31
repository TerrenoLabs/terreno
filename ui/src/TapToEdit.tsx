import {type FC, useEffect, useRef, useState} from "react";
import {Linking, View} from "react-native";

import {Box} from "./Box";
import {Button} from "./Button";
import type {AddressInterface, FieldProps, TapToEditProps} from "./Common";
import {Field} from "./Field";
import {Icon} from "./Icon";
// import {useOpenAPISpec} from "./OpenAPIContext";
import {Text} from "./Text";
import {resolveTestID} from "./testing/resolveTestId";

const TapToEditTitle: FC<{
  onlyShowHelperTextWhileEditing?: boolean;
  title: string;
  helperText?: string;
}> = ({title, helperText, onlyShowHelperTextWhileEditing}) => {
  return (
    <View style={{flex: 1, justifyContent: "center"}}>
      <Text bold>{title}</Text>
      {Boolean(helperText && !onlyShowHelperTextWhileEditing) && (
        <Text color="secondaryLight" size="sm">
          {helperText}
        </Text>
      )}
    </View>
  );
};

export const formatAddress = (address: Partial<AddressInterface>, asString = false): string => {
  let city = "";
  if (address?.city) {
    city = address?.state || address.zipcode ? `${address.city}, ` : `${address.city}`;
  }

  let state = "";
  if (address?.state) {
    state = address?.zipcode ? `${address.state} ` : `${address.state}`;
  }

  const zip = address?.zipcode || "";

  const countyName = address?.countyName ?? "";

  const countyCode = address?.countyCode ?? "";

  const addressLineOne = address?.address1 ?? "";
  const addressLineTwo = address?.address2 ?? "";
  const addressLineThree = `${city}${state}${zip}`;
  const addressLineFour = `${countyName}${address?.countyCode ? ` (${countyCode})` : ""}`;

  if (!asString) {
    return `${addressLineOne}${
      addressLineOne && (addressLineTwo || addressLineThree) ? `\n` : ""
    }${addressLineTwo}${addressLineTwo && addressLineThree ? `\n` : ""}${addressLineThree}${
      addressLineThree && addressLineFour ? `\n` : ""
    }${addressLineFour}`;
  } else {
    return `${addressLineOne}${
      addressLineOne && (addressLineTwo || addressLineThree) ? `, ` : ""
    }${addressLineTwo}${addressLineTwo && addressLineThree ? `, ` : ""}${addressLineThree}${
      addressLineThree && addressLineFour ? `, ` : ""
    }${addressLineFour}`;
  }
};

export const TapToEdit: FC<TapToEditProps> = ({
  value,
  setValue,
  title,
  onSave,
  editable = true,
  isEditing = false,
  transform,
  withConfirmation = false,
  confirmationText = "Are you sure you want to save your changes?",
  confirmationTitle = "Confirm",
  helperText: propsHelperText,
  onlyShowHelperTextWhileEditing = true,
  showClearButton = false,
  testID,
  ...fieldProps
}) => {
  const [editing, setEditing] = useState(false);
  const initialValueRef = useRef<unknown>(undefined);
  const helperText: string | undefined = propsHelperText;

  // TODO: Auto focus on input when editing for field types other than text for accessibility
  interface FocusableInput {
    focus?: () => void;
  }
  const inputRef = useRef<FocusableInput | null>(null);

  // bring the bring the input into focus when editing from within the component,
  // but not when editing from outside
  useEffect(() => {
    if (editable && editing && !isEditing) {
      inputRef.current?.focus?.();
    }
  }, [editable, editing, isEditing]);

  if (editable && !setValue) {
    throw new Error("setValue is required if editable is true");
  }

  if (editable && (editing || isEditing)) {
    const editableFieldProps = {
      grow: fieldProps?.type === "textarea" ? (fieldProps.grow ?? true) : undefined,
      helperText,
      inputRef: ["text", "textarea", "url", "email", "number"].includes(fieldProps?.type)
        ? (ref: unknown): void => {
            inputRef.current = ref as FocusableInput | null;
          }
        : undefined,
      onChange: setValue as NonNullable<typeof setValue>,
      row: fieldProps?.type === "textarea" ? 5 : undefined,
      value,
      ...fieldProps,
      testID,
      type: (fieldProps?.type ?? "text") as NonNullable<FieldProps["type"]>,
    } as unknown as FieldProps;

    return (
      <View style={{flexDirection: "column", width: "100%"}}>
        <View style={{flex: 1, justifyContent: "center"}}>
          <Text bold>{title}</Text>
        </View>
        <View style={{gap: 16}}>
          <Field {...editableFieldProps} />
          {editing && !isEditing && (
            <View style={{flexDirection: "row", gap: 16, justifyContent: "flex-end"}}>
              <Button
                onClick={(): void => {
                  if (setValue) {
                    setValue(initialValueRef.current);
                  }
                  setEditing(false);
                }}
                testID={resolveTestID(testID, "cancel")}
                text="Cancel"
                variant="muted"
              />
              {(showClearButton || ["date", "datetime", "time"].includes(fieldProps?.type)) && (
                <Button
                  onClick={(): void => {
                    if (setValue) {
                      setValue("");
                    }
                    if (onSave) {
                      onSave("");
                    }
                    setEditing(false);
                  }}
                  testID={resolveTestID(testID, "clear")}
                  text="Clear"
                  variant="muted"
                />
              )}
              <View style={{marginLeft: 8}}>
                <Button
                  confirmationText={confirmationText}
                  modalTitle={confirmationTitle}
                  onClick={async (): Promise<void> => {
                    if (!onSave) {
                      console.error("No onSave provided for editable TapToEdit");
                    } else {
                      await onSave(value);
                    }
                    setEditing(false);
                  }}
                  testID={resolveTestID(testID, "save")}
                  text="Save"
                  withConfirmation={withConfirmation}
                />
              </View>
            </View>
          )}
        </View>
      </View>
    );
  } else {
    let displayValue = value;
    // If a transform props is present, that takes priority
    if (transform) {
      displayValue = transform(value);
    } else {
      // If no transform, try and display the value reasonably.
      if (fieldProps?.type === "boolean") {
        displayValue = value ? "Yes" : "No";
        // TODO: put transform back in after field types are updated
        // } else if (fieldProps?.type === "percent") {
        //   // Prevent floating point errors from showing up by using parseFloat and precision.
        //   // Pass through parseFloat again to trim off insignificant zeroes.
        //   displayValue = `${parseFloat(parseFloat(String(value * 100)).toPrecision(7))}%`;
        // } else if (fieldProps?.type === "currency") {
        //   // TODO: support currencies other than USD in Field and related components.
        //   const formatter = new Intl.NumberFormat("en-US", {
        //     style: "currency",
        //     currency: "USD",
        //     minimumFractionDigits: 2, // (this suffices for whole numbers, but will print 2500.10 as $2,500.1)
        //   });
        //   displayValue = formatter.format(value);
      } else if (fieldProps?.type === "multiselect") {
        // ???
        displayValue = value.join(", ");
      } else if (fieldProps?.type === "url") {
        // Show only the domain, full links are likely too long.
        try {
          const url = new URL(value);
          displayValue = url?.hostname ?? value;
        } catch (_error) {
          // Don't print an error message for empty values.
          if (value) {
            console.debug(`Invalid URL: $value`);
          }
          displayValue = value;
        }
      } else if (fieldProps?.type === "address") {
        displayValue = formatAddress(value);
      }
    }

    const openLink = async (): Promise<void> => {
      if (fieldProps?.type === "url") {
        await Linking.openURL(value);
      } else if (fieldProps?.type === "address") {
        await Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            formatAddress(value, true)
          )}`
        );
      }
    };
    const isClickable = fieldProps?.type === "url" || fieldProps?.type === "address";

    // For textarea to display correctly, we place the title on its own line, then the text
    // on the next line. This is because the textarea will take up the full width of the row.
    return (
      <View
        style={{
          alignItems: fieldProps?.type === "textarea" ? "flex-start" : "center",
          flexDirection: fieldProps?.type === "textarea" ? "column" : "row",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <View style={{flexDirection: "row", gap: 16, width: "100%"}}>
          <TapToEditTitle
            helperText={helperText}
            onlyShowHelperTextWhileEditing={onlyShowHelperTextWhileEditing}
            title={title}
          />
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              justifyContent: "flex-end",
            }}
          >
            <Box
              accessibilityHint=""
              accessibilityLabel="Link"
              justifyContent="start"
              onClick={isClickable ? openLink : undefined}
            >
              {Boolean(fieldProps?.type !== "textarea") && (
                <Text align="right" skipLinking underline={isClickable}>
                  {displayValue}
                </Text>
              )}
            </Box>
            {editable && (
              <Box
                accessibilityHint=""
                accessibilityLabel="Edit"
                marginLeft={2}
                onClick={(): void => {
                  initialValueRef.current = value;
                  setEditing(true);
                }}
                testID={resolveTestID(testID, "edit")}
                width={16}
              >
                <Icon iconName="pencil" size="md" />
              </Box>
            )}
          </View>
        </View>
        {fieldProps?.type === "textarea" && (
          <View style={{marginTop: 8, paddingVertical: 8, width: "100%"}}>
            <Text align="left" underline={isClickable}>
              {displayValue}
            </Text>
          </View>
        )}
      </View>
    );
  }
};
