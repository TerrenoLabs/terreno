import {
  type AskResponse,
  type AskValidationError,
  type FormField,
  validateAskResponse,
} from "@terreno/blocks";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useMemo, useState} from "react";

import {BooleanField} from "../BooleanField";
import {Box} from "../Box";
import {Button} from "../Button";
import type {DateTimeEntryStatus} from "../Common";
import {DateTimeField} from "../DateTimeField";
import {MultiselectField} from "../MultiselectField";
import {SelectField} from "../SelectField";
import {Text} from "../Text";
import {TextArea} from "../TextArea";
import {TextField} from "../TextField";
import {type AskControlProps, AskErrors, SkipButton, useAnswerButton} from "./askControls";
import {
  type FormDraft,
  type FormDraftValue,
  formatFormValue,
  formDraftValues,
  formFieldErrorText,
  fromPickerValue,
  initialFormDraft,
  isFormFieldError,
  toPickerValue,
  type UnfinishedEntries,
  unfinishedEntryText,
} from "./askFormDraft";
import type {ChatAsk} from "./askTypes";

const SUBMIT_ACTION_ID = "submit";

const TEXT_FIELD_TYPES = {
  email: "email",
  number: "text",
  phone: "phoneNumber",
  text: "text",
  url: "url",
} as const;

export interface AskFormProps extends AskControlProps {
  ask: Extract<ChatAsk, {kind: "form"}>;
}

/** Field ids the user has edited since the host last passed `errors`. */
interface EditedSinceErrors {
  errors?: AskValidationError[];
  ids: Record<string, true>;
}

const fieldTitle = (field: FormField): string =>
  field.required === true ? `${field.label} (required)` : field.label;

const localTimezone = (): string => DateTime.local().zoneName ?? "UTC";

interface FormFieldControlProps {
  disabled: boolean;
  errorText?: string;
  field: FormField;
  onChange: (id: string, value: FormDraftValue) => void;
  onEntryStatusChange: (id: string, status: DateTimeEntryStatus) => void;
  onTimezoneChange: (id: string, timezone: string) => void;
  testID: string;
  timezone: string;
  value: FormDraftValue;
}

/** The `@terreno/ui` control for one field, chosen by its type. */
const FormFieldControl = ({
  disabled,
  errorText,
  field,
  onChange,
  onEntryStatusChange,
  onTimezoneChange,
  testID,
  timezone,
  value,
}: FormFieldControlProps): React.ReactElement => {
  const shared = {
    disabled,
    errorText,
    helperText: field.helperText,
    testID,
    title: fieldTitle(field),
  };
  const handleText = (text: string): void => onChange(field.id, text);

  switch (field.type) {
    case "boolean":
      return (
        <BooleanField
          {...shared}
          onChange={(checked) => onChange(field.id, checked)}
          value={value === true}
        />
      );
    case "select":
      return (
        <SelectField
          {...shared}
          onChange={handleText}
          options={field.options.map((option) => ({label: option.label, value: option.id}))}
          value={typeof value === "string" ? value : ""}
        />
      );
    case "multiselect":
      return (
        <MultiselectField
          {...shared}
          onChange={(selected) => onChange(field.id, selected)}
          options={field.options.map((option) => ({label: option.label, value: option.id}))}
          value={Array.isArray(value) ? value : []}
        />
      );
    case "date":
    case "time":
    case "datetime": {
      const draft = typeof value === "string" ? value : "";
      const pickerValue = toPickerValue({timezone, type: field.type, value: draft});
      // DateTimeField reports a new zone, then in the same call emits the value read in that zone,
      // before this render's `timezone` has updated.
      let activeTimezone = timezone;
      return (
        <DateTimeField
          {...shared}
          onChange={(iso) => {
            if (iso === (pickerValue ?? "")) {
              return;
            }
            onChange(field.id, fromPickerValue({iso, timezone: activeTimezone, type: field.type}));
          }}
          onEntryStatusChange={(status) => onEntryStatusChange(field.id, status)}
          onTimezoneChange={(nextTimezone) => {
            activeTimezone = nextTimezone;
            onTimezoneChange(field.id, nextTimezone);
          }}
          timezone={timezone}
          type={field.type}
          value={pickerValue}
        />
      );
    }
    case "textarea":
      return (
        <TextArea
          {...shared}
          onChange={handleText}
          trimOnBlur={false}
          value={typeof value === "string" ? value : ""}
        />
      );
    default:
      return (
        <TextField
          {...shared}
          onChange={handleText}
          trimOnBlur={false}
          type={TEXT_FIELD_TYPES[field.type]}
          value={typeof value === "string" ? value : ""}
        />
      );
  }
};

/**
 * Fill in a form's fields and submit them at once. Each field uses the `@terreno/ui` control for
 * its type. Submit is enabled once the answer passes the ask's rules and no date field holds an
 * unfinished entry; a field says what is wrong after the user edits it, and the host's `errors`
 * for a field show on that field.
 */
export const AskForm: React.FC<AskFormProps> = ({
  ask,
  errors,
  isDisabled,
  onAnswer,
  pendingActionId,
  testID,
}) => {
  const {input} = ask;
  const [draft, setDraft] = useState<FormDraft>(() => initialFormDraft(input));
  const [touched, setTouched] = useState<Record<string, true>>({});
  const [editedSinceErrors, setEditedSinceErrors] = useState<EditedSinceErrors>({ids: {}});
  const [timezones, setTimezones] = useState<Record<string, string>>({});
  const [unfinished, setUnfinished] = useState<UnfinishedEntries>({});
  const isAnswering = pendingActionId !== undefined;
  const renderButton = useAnswerButton({isDisabled, onAnswer, pendingActionId, testID});

  const response = useMemo(
    (): AskResponse => ({action: "accept", content: {values: formDraftValues({draft, input})}}),
    [draft, input]
  );
  const clientErrors = useMemo(
    () => validateAskResponse({input, kind: "form", response}),
    [input, response]
  );
  const editedIds = editedSinceErrors.errors === errors ? editedSinceErrors.ids : {};

  const handleChange = useCallback(
    (id: string, value: FormDraftValue): void => {
      if (isDisabled || isAnswering) {
        return;
      }
      setDraft((previous) => ({...previous, [id]: value}));
      setTouched((previous) => ({...previous, [id]: true}));
      setEditedSinceErrors((previous) => ({
        errors,
        ids: previous.errors === errors ? {...previous.ids, [id]: true} : {[id]: true},
      }));
    },
    [errors, isAnswering, isDisabled]
  );

  const handleEntryStatusChange = useCallback(
    (id: string, status: DateTimeEntryStatus): void => {
      if (isDisabled || isAnswering) {
        return;
      }
      setUnfinished((previous) => {
        if (status === "invalid") {
          return previous[id] ? previous : {...previous, [id]: true};
        }
        if (!previous[id]) {
          return previous;
        }
        const {[id]: _finished, ...rest} = previous;
        return rest;
      });
      if (status === "empty") {
        handleChange(id, "");
      }
    },
    [handleChange, isAnswering, isDisabled]
  );

  const handleTimezoneChange = useCallback((id: string, timezone: string): void => {
    setTimezones((previous) => ({...previous, [id]: timezone}));
  }, []);

  const handleSubmit = useCallback(
    (): void | Promise<void> => onAnswer({actionId: SUBMIT_ACTION_ID, response}),
    [onAnswer, response]
  );

  const fieldErrorText = (field: FormField): string | undefined => {
    if (unfinished[field.id]) {
      return unfinishedEntryText(field);
    }
    if (touched[field.id]) {
      const clientText = formFieldErrorText({errors: clientErrors, field});
      if (clientText) {
        return clientText;
      }
    }
    return editedIds[field.id] ? undefined : formFieldErrorText({errors: errors ?? [], field});
  };

  return (
    <Box gap={3}>
      {input.fields.map((field) => (
        <Box key={field.id} testID={`${testID}-form-field-${field.id}`}>
          <FormFieldControl
            disabled={isDisabled || isAnswering}
            errorText={fieldErrorText(field)}
            field={field}
            onChange={handleChange}
            onEntryStatusChange={handleEntryStatusChange}
            onTimezoneChange={handleTimezoneChange}
            testID={`${testID}-field-${field.id}`}
            timezone={timezones[field.id] ?? localTimezone()}
            value={draft[field.id] ?? ""}
          />
        </Box>
      ))}
      <AskErrors
        errors={errors?.filter((error) => !input.fields.some((f) => isFormFieldError(error, f)))}
        testID={`${testID}-errors`}
      />
      <Box direction="row" gap={2} wrap>
        <Button
          disabled={
            isDisabled ||
            clientErrors.length > 0 ||
            Object.keys(unfinished).length > 0 ||
            (isAnswering && pendingActionId !== SUBMIT_ACTION_ID)
          }
          loading={pendingActionId === SUBMIT_ACTION_ID}
          onClick={handleSubmit}
          testID={`${testID}-submit`}
          text={input.submitLabel ?? "Submit"}
          wrapText
        />
        <SkipButton ask={ask} renderButton={renderButton} />
      </Box>
    </Box>
  );
};

/**
 * The values an answered `form` sent back, under its summary line: one "label: value" row per
 * answered field, in the form's order.
 */
export const AskFormAnswer = ({
  ask,
  testID,
  values,
}: {
  ask: Extract<ChatAsk, {kind: "form"}>;
  testID: string;
  values: Record<string, unknown>;
}): React.ReactElement | null => {
  const rows = ask.input.fields.filter((field) => Object.hasOwn(values, field.id));
  if (rows.length === 0) {
    return null;
  }
  return (
    <Box border="default" gap={2} padding={3} rounding="md" testID={`${testID}-answer`}>
      {rows.map((field) => (
        <Box key={field.id}>
          <Text color="secondaryDark" size="sm">
            {field.label}
          </Text>
          <Text>{formatFormValue({field, value: values[field.id]})}</Text>
        </Box>
      ))}
    </Box>
  );
};
