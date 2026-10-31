import {
  BooleanField,
  Box,
  Button,
  Card,
  FormContainer,
  Heading,
  MarkdownEditorField,
  Page,
  Spinner,
  Text,
  TextField,
  useToast,
} from "@terreno/ui";
import startCase from "lodash/startCase";
import React, {useCallback, useMemo, useState} from "react";
import {useConfigurationApi} from "./useConfigurationApi";

/**
 * Configuration field/section values are heterogeneous across consumer apps — each app
 * registers its own configuration schema with arbitrary field types. We treat them as
 * unknown shapes at this boundary and narrow when rendering individual fields.
 */
type ConfigValue = unknown;

interface ConfigFieldMeta {
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
  default?: ConfigValue;
  secret?: boolean;
  widget?: string;
}

interface ConfigSectionMeta {
  name: string;
  displayName: string;
  description?: string;
  fields: Record<string, ConfigFieldMeta>;
}

interface ConfigurationMetaResponse {
  sections: ConfigSectionMeta[];
}

interface ConfigurationScreenProps {
  /** Base URL for configuration routes (e.g., "/configuration"). */
  basePath?: string;
  /** Optional title override. Defaults to "Configuration". */
  title?: string;
}

/**
 * Renders a single configuration field based on its metadata.
 */
const ConfigField: React.FC<{
  fieldKey: string;
  fieldMeta: ConfigFieldMeta;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  sectionName: string;
}> = ({fieldKey, fieldMeta, value, onChange, sectionName}) => {
  const label = startCase(fieldKey);
  const helperText = fieldMeta.description;
  const testID = `config-${sectionName}-${fieldKey}`;

  if (fieldMeta.type === "boolean") {
    const boolValue =
      typeof value === "boolean" ? value : ((fieldMeta.default as boolean) ?? false);
    return (
      <BooleanField helperText={helperText} onChange={onChange} title={label} value={boolValue} />
    );
  }

  if (fieldMeta.type === "number") {
    return (
      <TextField
        helperText={helperText}
        onChange={(text: string) => {
          if (text === "") {
            onChange("");
            return;
          }
          const num = Number(text);
          if (!Number.isNaN(num)) {
            onChange(num);
          }
        }}
        testID={testID}
        title={label}
        value={value != null ? String(value) : ""}
      />
    );
  }

  if (fieldMeta.widget === "markdown") {
    return (
      <MarkdownEditorField
        helperText={helperText}
        onChange={onChange}
        testID={testID}
        title={label}
        value={typeof value === "string" ? value : ""}
      />
    );
  }

  if (fieldMeta.secret) {
    return (
      <TextField
        accessibilityLabel={`${label} (Secret)`}
        autoComplete="off"
        helperText={helperText ? `${helperText} (secret)` : "Secret value"}
        onChange={onChange}
        testID={testID}
        title={`${label} (Secret)`}
        type="password"
        value={typeof value === "string" ? value : ""}
      />
    );
  }

  return (
    <TextField
      helperText={helperText}
      onChange={onChange}
      testID={testID}
      title={label}
      value={typeof value === "string" ? value : ""}
    />
  );
};

const SectionDescription: React.FC<{description: string}> = ({description}) => (
  <Text color="secondaryDark" size="sm">
    {description}
  </Text>
);

const SectionCard: React.FC<{
  section: ConfigSectionMeta;
  formState: Record<string, ConfigValue>;
  onFieldChange: (sectionName: string, fieldKey: string, value: ConfigValue) => void;
}> = ({section, formState, onFieldChange}) => {
  const sectionValues =
    section.name === "__root__"
      ? formState
      : ((formState[section.name] as Record<string, ConfigValue> | undefined) ?? {});
  return (
    <Card padding={4}>
      <Box gap={3}>
        <Box gap={1}>
          <Heading size="md">{section.displayName}</Heading>
          {section.description && <SectionDescription description={section.description} />}
        </Box>
        {Object.entries(section.fields).map(([fieldKey, fieldMeta]) => (
          <ConfigField
            fieldKey={fieldKey}
            fieldMeta={fieldMeta}
            key={fieldKey}
            onChange={(value: ConfigValue) => onFieldChange(section.name, fieldKey, value)}
            sectionName={section.name}
            value={sectionValues[fieldKey]}
          />
        ))}
      </Box>
    </Card>
  );
};

const EmptySections: React.FC = () => (
  <Text color="secondaryDark">No configuration sections defined.</Text>
);

/**
 * Configuration management screen that auto-generates a form from the backend
 * configuration model's schema metadata.
 *
 * Fetches metadata from `{basePath}/meta` and current values from `{basePath}`.
 * Each nested subschema in the configuration model renders as a separate card/section.
 * Supports string, number, boolean, and secret field types.
 *
 * @example
 * ```typescript
 * import {ConfigurationScreen} from "@terreno/admin-frontend";
 *
 * export default function ConfigScreen() {
 *   return <ConfigurationScreen />;
 * }
 * ```
 */
export const ConfigurationScreen: React.FC<ConfigurationScreenProps> = ({
  basePath = "/configuration",
  title = "Configuration",
}) => {
  const {useMetaQuery, useValuesQuery, useUpdateMutation} = useConfigurationApi({basePath});

  const {data: meta, isLoading: isMetaLoading} = useMetaQuery();
  const {data: valuesResponse, isLoading: isValuesLoading} = useValuesQuery();
  const [updateConfig, {isLoading: isSaving}] = useUpdateMutation();

  // Tracks only the fields the user has explicitly edited. null = no edits yet.
  const [userEdits, setUserEdits] = useState<Record<string, ConfigValue> | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const toast = useToast();

  const configMeta = meta as ConfigurationMetaResponse | undefined;
  // The baseQuery in emptyApi.ts unwraps {data: ...} responses, so valuesResponse
  // is already the config document — not a wrapper object.
  const configValues = valuesResponse as Record<string, ConfigValue> | undefined;

  // Derived synchronously so the form is never blank when data is already cached.
  const serverValues = useMemo((): Record<string, ConfigValue> => {
    if (!configValues || !configMeta) return {};
    const emptyDefault = (fieldMeta: ConfigFieldMeta) =>
      fieldMeta.type === "boolean" ? false : "";
    const initial: Record<string, ConfigValue> = {};
    for (const section of configMeta.sections) {
      if (section.name === "__root__") {
        for (const [key, fieldMeta] of Object.entries(section.fields)) {
          initial[key] = configValues[key] ?? fieldMeta.default ?? emptyDefault(fieldMeta);
        }
      } else {
        const nestedInitial: Record<string, ConfigValue> = {};
        const sectionValues =
          (configValues[section.name] as Record<string, ConfigValue> | undefined) ?? {};
        for (const [key, fieldMeta] of Object.entries(section.fields)) {
          nestedInitial[key] = sectionValues[key] ?? fieldMeta.default ?? emptyDefault(fieldMeta);
        }
        initial[section.name] = nestedInitial;
      }
    }
    return initial;
  }, [configValues, configMeta]);

  const formState = userEdits ?? serverValues;

  const handleFieldChange = useCallback(
    (sectionName: string, fieldKey: string, value: ConfigValue) => {
      setIsDirty(true);
      setUserEdits((prev) => {
        const base = prev ?? serverValues;
        if (sectionName === "__root__") {
          return {...base, [fieldKey]: value};
        }
        return {
          ...base,
          [sectionName]: {
            ...(base[sectionName] as Record<string, ConfigValue>),
            [fieldKey]: value,
          },
        };
      });
    },
    [serverValues]
  );

  const handleSave = useCallback(async () => {
    try {
      await updateConfig(formState).unwrap();
      // Keep userEdits so the form continues to show the saved values while
      // the cache invalidation refetch runs in the background.
      setIsDirty(false);
      toast.success("Configuration saved");
    } catch (err) {
      toast.catch(err, "Failed to save configuration");
    }
  }, [formState, updateConfig, toast]);

  const sections = useMemo(() => configMeta?.sections ?? [], [configMeta]);

  // Only block rendering on the very first load (no cached data yet).
  // Background refetches (e.g. after a save) should not show a spinner.
  const isInitialLoading = (isMetaLoading && !configMeta) || (isValuesLoading && !configValues);
  if (isInitialLoading) {
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title={title}>
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  if (!configMeta) {
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title={title}>
        <Box padding={4}>
          <Text color="secondaryDark">No configuration metadata available.</Text>
        </Box>
      </Page>
    );
  }

  return (
    <Page
      color="transparent"
      footer={
        <Box direction="row" justifyContent="end" padding={2}>
          <Button
            disabled={!isDirty}
            loading={isSaving}
            onClick={handleSave}
            testID="config-save-button"
            text="Save Configuration"
            variant="primary"
          />
        </Box>
      }
      maxWidth={800}
      padding={0}
      scroll
      title={title}
    >
      {/* A form holds the secret (password-type) fields, so browsers do not warn about them. */}
      <FormContainer gap={4} padding={4} testID="config-form">
        {sections.length === 0 ? (
          <EmptySections />
        ) : (
          sections.map((section) => (
            <SectionCard
              formState={formState}
              key={section.name}
              onFieldChange={handleFieldChange}
              section={section}
            />
          ))
        )}
      </FormContainer>
    </Page>
  );
};
