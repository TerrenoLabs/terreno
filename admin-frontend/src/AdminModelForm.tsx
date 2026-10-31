import {Accordion, Box, Button, Page, Spinner, Text, useToast} from "@terreno/ui";
import {router, useNavigation} from "expo-router";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {AdminConflictSheet} from "./AdminConflictSheet";
import {AdminFieldRenderer} from "./AdminFieldRenderer";
import {buildNestedObjectDefault, isNestedObjectField} from "./AdminNestedObjectField";
import {useAdminContext} from "./adminContext";
import {isWindowedAdminTable} from "./adminWindowedTable";
import {markAdminWindowMembershipStale} from "./adminWindowRefresh";
import {shouldSkipOrgScopedAdminQuery} from "./orgs/shouldSkipOrgScopedAdminQuery";
import {useOptionalOrgContext} from "./orgs/useOrgContext";
import type {
  AdminFieldConfig,
  AdminFieldValue,
  AdminModelConfig,
  AdminRecordCapabilities,
  RefRendererMap,
} from "./types";
import {resolveAdminBases, SYSTEM_FIELDS} from "./types";
import {useAdminConfig} from "./useAdminConfig";
import {useAdminModelApi} from "./useAdminModelApi";

/** Parameters for {@link AdminModelFormProps.getScreenTitle}. */
export interface AdminModelFormScreenTitleParams {
  mode: "create" | "edit";
  modelConfig: AdminModelConfig;
  formState: Record<string, AdminFieldValue>;
  itemData: Record<string, AdminFieldValue> | undefined;
  itemId?: string;
}

interface AdminModelFormProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  modelName: string;
  mode: "create" | "edit";
  itemId?: string;
  footerContent?: React.ReactNode;
  transformPayload?: (params: {
    mode: "create" | "edit";
    payload: Record<string, AdminFieldValue>;
  }) => Promise<Record<string, AdminFieldValue>> | Record<string, AdminFieldValue>;
  onSaveSuccess?: (params: {
    mode: "create" | "edit";
    payload: Record<string, AdminFieldValue>;
    result: AdminFieldValue;
    itemId?: string;
  }) => Promise<void> | void;
  /**
   * Optional map of custom ref-field renderers keyed by referenced model name. Forwarded
   * to every nested {@link AdminFieldRenderer} so refs in this form (including refs
   * inside nested/primitive arrays) can be rendered with a consumer-provided component.
   */
  refRenderers?: RefRendererMap;
  /** When set, used as the stack / document title as-is (including empty string). */
  screenTitle?: string;
  /**
   * Field key for the edit-mode title. Overrides {@link AdminModelConfig.recordTitleField}
   * from the server config.
   */
  recordTitleField?: string;
  /**
   * Custom title resolver. Return a non-empty string to override defaults; return undefined to
   * fall back to {@link screenTitle}, config, or built-in heuristics.
   */
  getScreenTitle?: (params: AdminModelFormScreenTitleParams) => string | undefined;
}

const getEditableFields = (
  fields: Record<string, AdminFieldConfig>,
  fieldOrder?: string[]
): [string, AdminFieldConfig][] => {
  const entries = Object.entries(fields).filter(([key]) => !SYSTEM_FIELDS.has(key));
  if (!fieldOrder || fieldOrder.length === 0) {
    return entries;
  }
  const entryMap = new Map(entries);
  const ordered: [string, AdminFieldConfig][] = [];
  for (const key of fieldOrder) {
    const config = entryMap.get(key);
    if (config) {
      ordered.push([key, config]);
      entryMap.delete(key);
    }
  }
  // Append any remaining fields not in fieldOrder
  for (const [key, config] of entryMap) {
    ordered.push([key, config]);
  }
  return ordered;
};

/** Non-system fields minus `hiddenFields` (still includes readonly keys for display). */
const getVisibleFieldEntries = (
  fields: Record<string, AdminFieldConfig>,
  fieldOrder: string[] | undefined,
  hiddenFields: string[] | undefined
): [string, AdminFieldConfig][] => {
  const hidden = new Set(hiddenFields ?? []);
  return getEditableFields(fields, fieldOrder).filter(([key]) => !hidden.has(key));
};

const getFieldDefault = (fieldConfig: AdminFieldConfig): AdminFieldValue => {
  if (fieldConfig.default !== undefined) {
    return fieldConfig.default;
  }
  if (isNestedObjectField(fieldConfig) && fieldConfig.items) {
    return buildNestedObjectDefault(fieldConfig.items);
  }
  if (fieldConfig.type === "boolean") {
    return false;
  }
  if (fieldConfig.type === "number") {
    return 0;
  }
  return "";
};

const sanitizePayloadValue = (value: AdminFieldValue): AdminFieldValue => {
  if (value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayloadValue(item)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const nextValue: Record<string, AdminFieldValue> = {};
    for (const [key, childValue] of Object.entries(value)) {
      const sanitizedChild = sanitizePayloadValue(childValue);
      if (sanitizedChild !== undefined) {
        nextValue[key] = sanitizedChild;
      }
    }
    return nextValue;
  }
  return value;
};

const omitBlankOptionalEnums = (
  payload: Record<string, AdminFieldValue>,
  fields: Record<string, AdminFieldConfig>
): Record<string, AdminFieldValue> => {
  const nextPayload = {...payload};
  for (const [fieldKey, fieldConfig] of Object.entries(fields)) {
    if (
      nextPayload[fieldKey] === "" &&
      !fieldConfig.required &&
      fieldConfig.enum &&
      fieldConfig.enum.length > 0
    ) {
      Reflect.deleteProperty(nextPayload, fieldKey);
    }
  }
  return nextPayload;
};

const DeleteButton: React.FC<{loading: boolean; onDelete: () => void}> = ({loading, onDelete}) => (
  <Button
    confirmationText="Are you sure you want to delete this item?"
    loading={loading}
    onClick={onDelete}
    testID="admin-delete-button"
    text="Delete"
    variant="destructive"
    withConfirmation
  />
);

const EmptyFields: React.FC = () => <Text color="secondaryDark">No editable fields.</Text>;

const TITLE_PREFERENCE_KEYS = ["name", "title", "label", "email", "username", "displayName"];

/** Debounce dynamic getScreenTitle updates so setOptions does not rerender parents per keystroke. */
const NAVIGATION_TITLE_DEBOUNCE_MS = 300;

const readScalarTitleFromRecord = (
  record: Record<string, unknown>,
  fieldKey: string
): string | undefined => {
  const fieldValue = record[fieldKey];
  if (fieldValue == null || typeof fieldValue === "object") {
    return undefined;
  }
  const s = String(fieldValue).trim();
  if (s.length === 0) {
    return undefined;
  }
  return s;
};

const inferEditRecordTitle = (params: {
  displayName: string;
  explicitField: string | undefined;
  fieldKeys: Set<string>;
  itemId: string | undefined;
  listFields: string[];
  record: Record<string, unknown>;
}): string => {
  const {displayName, explicitField, fieldKeys, itemId, listFields, record} = params;
  if (explicitField) {
    const fromExplicit = readScalarTitleFromRecord(record, explicitField);
    if (fromExplicit) {
      return fromExplicit;
    }
  }
  for (const key of TITLE_PREFERENCE_KEYS) {
    if (!fieldKeys.has(key)) {
      continue;
    }
    const fromPreferred = readScalarTitleFromRecord(record, key);
    if (fromPreferred) {
      return fromPreferred;
    }
  }
  for (const key of listFields) {
    const fromList = readScalarTitleFromRecord(record, key);
    if (fromList) {
      return fromList;
    }
  }
  if (itemId) {
    const short = itemId.length > 12 ? `${itemId.slice(0, 8)}…` : itemId;
    return `${displayName} · ${short}`;
  }
  return displayName;
};

/**
 * Form screen for creating or editing a model instance in the admin panel.
 *
 * Auto-generates form fields based on the model schema from the backend configuration.
 * Handles field validation, type-specific inputs (text, boolean, select, date, reference fields),
 * and save/cancel actions. System fields (_id, __v, created, updated, deleted) are automatically
 * excluded from the form.
 *
 * @param props - Component props
 * @param props.baseUrl - Base URL for admin routes (e.g., "/admin")
 * @param props.modelName - Name of the model to create/edit (e.g., "User")
 * @param props.mode - Form mode: "create" for new items, "edit" for existing items
 * @param props.itemId - ID of the item to edit (required when mode is "edit")
 * @param props.screenTitle - Optional fixed stack / document title (overrides all title logic)
 * @param props.recordTitleField - Optional field key for edit-mode title (overrides server `recordTitleField`)
 * @param props.getScreenTitle - Optional callback to derive the title; return undefined to use defaults
 *
 * @example
 * ```typescript
 * import {AdminModelForm} from "@terreno/admin-frontend";
 * import {useLocalSearchParams} from "expo-router";
 *
 * function AdminCreateScreen() {
 *   const {modelName} = useLocalSearchParams();
 *   return (
 *     <AdminModelForm
 *       baseUrl="/admin"
 *
 *       modelName={modelName as string}
 *       mode="create"
 *     />
 *   );
 * }
 *
 * function AdminEditScreen() {
 *   const {modelName, id} = useLocalSearchParams();
 *   return (
 *     <AdminModelForm
 *       baseUrl="/admin"
 *
 *       modelName={modelName as string}
 *       mode="edit"
 *       itemId={id as string}
 *     />
 *   );
 * }
 * ```
 *
 * @see AdminFieldRenderer for field type rendering
 * @see AdminModelTable for the list view
 * @see SYSTEM_FIELDS for excluded fields
 */
export const AdminModelForm: React.FC<AdminModelFormProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  modelName,
  mode,
  itemId,
  footerContent,
  transformPayload,
  onSaveSuccess,
  refRenderers,
  screenTitle,
  recordTitleField: recordTitleFieldProp,
  getScreenTitle,
}) => {
  const {apiBase: resolvedApiBase, routeBase: resolvedRouteBase} = resolveAdminBases({
    apiBase,
    baseUrl,
    routeBase,
  });
  const {config, isLoading: isConfigLoading} = useAdminConfig(resolvedApiBase);
  const adminContext = useAdminContext();
  const organizationId = useOptionalOrgContext()?.organizationId;
  const [formState, setFormState] = useState<Record<string, AdminFieldValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isInitialized, setIsInitialized] = useState(false);
  const [isWindowMutationPending, setIsWindowMutationPending] = useState(false);
  const windowMutationPendingRef = useRef(false);
  const navigation = useNavigation();
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const prevNavigationTitleRef = useRef<string | undefined>(undefined);
  const hasAppliedNavigationTitleRef = useRef(false);
  const navigationTitleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modelConfig: AdminModelConfig | undefined = useMemo(
    () => config?.models.find((m: AdminModelConfig) => m.name === modelName),
    [config, modelName]
  );

  const toast = useToast();

  const {useReadQuery, useCreateMutation, useUpdateMutation, useDeleteMutation} = useAdminModelApi(
    modelConfig?.routePath ?? "",
    modelName
  );

  const skipOrgScopedQuery = shouldSkipOrgScopedAdminQuery({
    organizationId,
    organizationScoped: modelConfig?.organizationScoped,
  });

  const {data: itemData, isLoading: isItemLoading} = useReadQuery(itemId ?? "", {
    skip: mode !== "edit" || !itemId || !modelConfig || skipOrgScopedQuery,
  });

  const [createItem, {isLoading: isCreating}] = useCreateMutation();
  const [updateItem, {isLoading: isUpdating}] = useUpdateMutation();
  const [deleteItem, {isLoading: isDeleting}] = useDeleteMutation();
  const isWindowed = isWindowedAdminTable({
    modelConfig,
    syncDb: adminContext?.syncDb,
  });

  // Initialize form state from fetched item data in edit mode
  useEffect(() => {
    if (mode === "edit" && itemData && !isInitialized) {
      const initial: Record<string, AdminFieldValue> = {};
      if (modelConfig) {
        for (const [key, fieldConfig] of getVisibleFieldEntries(
          modelConfig.fields,
          modelConfig.fieldOrder,
          modelConfig.hiddenFields
        )) {
          const raw = itemData[key];
          initial[key] = raw ?? getFieldDefault(fieldConfig);
        }
      }
      setFormState(initial);
      setIsInitialized(true);
    }
  }, [mode, itemData, modelConfig, isInitialized]);

  // Initialize form state with defaults in create mode
  useEffect(() => {
    if (mode === "create" && modelConfig && !isInitialized) {
      const initial: Record<string, AdminFieldValue> = {};
      for (const [key, fieldConfig] of getVisibleFieldEntries(
        modelConfig.fields,
        modelConfig.fieldOrder,
        modelConfig.hiddenFields
      )) {
        initial[key] = getFieldDefault(fieldConfig);
      }
      setFormState(initial);
      setIsInitialized(true);
    }
  }, [mode, modelConfig, isInitialized]);

  const handleFieldChange = useCallback((fieldKey: string, value: AdminFieldValue) => {
    setFormState((prev) => {
      if (prev[fieldKey] === value) {
        return prev;
      }
      return {...prev, [fieldKey]: value};
    });
    setErrors((prev) => {
      if (!Object.hasOwn(prev, fieldKey)) {
        return prev;
      }
      const next = {...prev};
      delete next[fieldKey];
      return next;
    });
  }, []);

  const handleFieldChangeRef = useRef(handleFieldChange);
  handleFieldChangeRef.current = handleFieldChange;

  const stableFieldChangeHandlersRef = useRef(new Map<string, (value: AdminFieldValue) => void>());

  const getStableFieldChangeHandler = useCallback(
    (fieldKey: string): ((value: AdminFieldValue) => void) => {
      const cached = stableFieldChangeHandlersRef.current.get(fieldKey);
      if (cached) {
        return cached;
      }
      const handler = (value: AdminFieldValue): void => {
        handleFieldChangeRef.current(fieldKey, value);
      };
      stableFieldChangeHandlersRef.current.set(fieldKey, handler);
      return handler;
    },
    []
  );

  const validate = useCallback((): boolean => {
    if (!modelConfig) {
      return false;
    }
    const newErrors: Record<string, string> = {};
    for (const [key, fieldConfig] of getVisibleFieldEntries(
      modelConfig.fields,
      modelConfig.fieldOrder,
      modelConfig.hiddenFields
    )) {
      if (fieldConfig.required && (formState[key] == null || formState[key] === "")) {
        newErrors[key] = `${key} is required`;
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [modelConfig, formState]);

  const handleSave = useCallback(async () => {
    if (!modelConfig) {
      return;
    }
    if (windowMutationPendingRef.current) {
      return;
    }
    if (!validate()) {
      return;
    }
    if (isWindowed) {
      windowMutationPendingRef.current = true;
      setIsWindowMutationPending(true);
    }
    try {
      const sanitizedPayload = omitBlankOptionalEnums(
        sanitizePayloadValue(formState) as Record<string, AdminFieldValue>,
        modelConfig.fields
      );
      const readonlyKeys = new Set(modelConfig.readonlyFields ?? []);
      const stripped: Record<string, AdminFieldValue> = {};
      for (const [k, v] of Object.entries(sanitizedPayload)) {
        if (!readonlyKeys.has(k)) {
          stripped[k] = v;
        }
      }
      const payload = transformPayload
        ? await transformPayload({mode, payload: stripped})
        : stripped;
      let result: AdminFieldValue;
      if (isWindowed && modelConfig.syncCollection && adminContext?.syncDb) {
        if (mode === "edit" && itemId) {
          await adminContext.syncDb.hydrateWindow({
            collection: modelConfig.syncCollection,
            ids: [itemId],
            restRows:
              itemData && typeof itemData === "object"
                ? {[itemId]: itemData as Record<string, unknown>}
                : undefined,
          });
        }
        const mutation = adminContext.syncDb.mutate({
          collection: modelConfig.syncCollection,
          data: payload,
          ...(itemId ? {id: itemId} : {}),
          operation: mode === "create" ? "create" : "update",
        });
        result = {...payload, _id: mutation.id};
        if (mode === "create") {
          markAdminWindowMembershipStale({
            awaitId: mutation.id,
            collection: modelConfig.syncCollection,
          });
        }
      } else if (mode === "create") {
        result = await createItem(payload).unwrap();
      } else if (itemId) {
        result = await updateItem({body: payload, id: itemId}).unwrap();
      }
      if (onSaveSuccess) {
        await onSaveSuccess({itemId, mode, payload, result});
      }
      router.back();
    } catch (err) {
      toast.catch(err, `Failed to ${mode === "create" ? "create" : "update"} ${modelName}`);
    } finally {
      windowMutationPendingRef.current = false;
      setIsWindowMutationPending(false);
    }
  }, [
    mode,
    formState,
    itemId,
    itemData,
    modelConfig,
    adminContext?.syncDb,
    createItem,
    isWindowed,
    updateItem,
    validate,
    toast,
    modelName,
    transformPayload,
    onSaveSuccess,
  ]);

  const handleDelete = useCallback(async () => {
    if (!itemId) {
      return;
    }
    if (windowMutationPendingRef.current) {
      return;
    }
    if (isWindowed) {
      windowMutationPendingRef.current = true;
      setIsWindowMutationPending(true);
    }
    try {
      if (isWindowed && modelConfig?.syncCollection && adminContext?.syncDb) {
        await adminContext.syncDb.hydrateWindow({
          collection: modelConfig.syncCollection,
          ids: [itemId],
          restRows:
            itemData && typeof itemData === "object"
              ? {[itemId]: itemData as Record<string, unknown>}
              : undefined,
        });
        adminContext.syncDb.mutate({
          collection: modelConfig.syncCollection,
          id: itemId,
          operation: "delete",
        });
        markAdminWindowMembershipStale({collection: modelConfig.syncCollection});
      } else {
        await deleteItem(itemId).unwrap();
      }
      router.back();
    } catch (err) {
      toast.catch(err, `Failed to delete ${modelName}`);
    } finally {
      windowMutationPendingRef.current = false;
      setIsWindowMutationPending(false);
    }
  }, [
    adminContext?.syncDb,
    deleteItem,
    isWindowed,
    itemId,
    itemData,
    modelConfig?.syncCollection,
    modelName,
    toast,
  ]);

  const isSaving = isCreating || isUpdating || isWindowMutationPending;
  const isDeletePending = isDeleting || isWindowMutationPending;
  const recordCapabilities = (
    itemData as {_adminCapabilities?: AdminRecordCapabilities} | undefined
  )?._adminCapabilities;
  const isFormWritable =
    mode === "create"
      ? modelConfig?.permissions?.create !== false
      : (recordCapabilities?.update ?? modelConfig?.permissions?.update !== false);
  const canDeleteRecord = recordCapabilities?.delete ?? modelConfig?.permissions?.delete !== false;

  const navigationTitle = useMemo((): string => {
    if (!modelConfig) {
      return "";
    }
    if (screenTitle !== undefined) {
      return screenTitle;
    }
    const fromCallback = getScreenTitle?.({
      formState,
      itemData: itemData as Record<string, AdminFieldValue> | undefined,
      itemId,
      mode,
      modelConfig,
    });
    if (typeof fromCallback === "string" && fromCallback.trim().length > 0) {
      return fromCallback.trim();
    }
    if (mode === "create") {
      return `New ${modelConfig.displayName}`;
    }
    if (isItemLoading) {
      return modelConfig.displayName;
    }
    const explicitField = recordTitleFieldProp ?? modelConfig.recordTitleField;
    const fieldKeys = new Set(Object.keys(modelConfig.fields));
    // Use persisted item data only — not live formState — so typing the title field does not
    // call navigation.setOptions on every keystroke (RN Web rerenders parents and corrupts input).
    const record =
      itemData && typeof itemData === "object" && !Array.isArray(itemData)
        ? (itemData as Record<string, unknown>)
        : {};
    return inferEditRecordTitle({
      displayName: modelConfig.displayName,
      explicitField,
      fieldKeys,
      itemId,
      listFields: modelConfig.listFields ?? [],
      record,
    });
  }, [
    formState,
    getScreenTitle,
    itemData,
    itemId,
    isItemLoading,
    mode,
    modelConfig,
    recordTitleFieldProp,
    screenTitle,
  ]);

  // Reset navigation title bookkeeping when the edited record changes.
  useEffect(() => {
    hasAppliedNavigationTitleRef.current = false;
    prevNavigationTitleRef.current = undefined;
  }, [itemId, mode, modelName]);

  // Set stack / document title. Save and delete live in the form chrome because
  // admin Expo stacks use headerShown: false (same as Create on the table).
  // navigation is read from a ref so unstable useNavigation() identities cannot
  // retrigger setOptions and feed back into controlled field inputs.
  useEffect(() => {
    if (!modelConfig) {
      return;
    }

    const applyNavigationTitle = (title: string): void => {
      if (prevNavigationTitleRef.current === title) {
        return;
      }
      prevNavigationTitleRef.current = title;
      navigationRef.current.setOptions({title});
    };

    const shouldDebounceDynamicTitle = screenTitle === undefined && getScreenTitle !== undefined;

    if (!shouldDebounceDynamicTitle) {
      applyNavigationTitle(navigationTitle);
      hasAppliedNavigationTitleRef.current = true;
      return;
    }

    if (!hasAppliedNavigationTitleRef.current) {
      applyNavigationTitle(navigationTitle);
      hasAppliedNavigationTitleRef.current = true;
      return;
    }

    if (navigationTitleDebounceRef.current) {
      clearTimeout(navigationTitleDebounceRef.current);
    }
    navigationTitleDebounceRef.current = setTimeout(() => {
      navigationTitleDebounceRef.current = null;
      applyNavigationTitle(navigationTitle);
    }, NAVIGATION_TITLE_DEBOUNCE_MS);

    return () => {
      if (navigationTitleDebounceRef.current) {
        clearTimeout(navigationTitleDebounceRef.current);
        navigationTitleDebounceRef.current = null;
      }
    };
  }, [getScreenTitle, modelConfig, navigationTitle, screenTitle]);

  // Flush a pending debounced title when the form unmounts.
  useEffect(() => {
    return () => {
      if (navigationTitleDebounceRef.current) {
        clearTimeout(navigationTitleDebounceRef.current);
        navigationTitleDebounceRef.current = null;
      }
    };
  }, []);

  const visibleFields = useMemo((): [string, AdminFieldConfig][] => {
    if (!modelConfig) {
      return [];
    }
    return getVisibleFieldEntries(
      modelConfig.fields,
      modelConfig.fieldOrder,
      modelConfig.hiddenFields
    );
  }, [modelConfig]);

  const readonlyKeySet = useMemo(() => {
    if (!modelConfig) {
      return new Set<string>();
    }
    if (!isFormWritable) {
      return new Set(Object.keys(modelConfig.fields));
    }
    return new Set(modelConfig.readonlyFields ?? []);
  }, [isFormWritable, modelConfig]);

  const fieldSections = useMemo(() => {
    if (!modelConfig?.fieldsets?.length) {
      return null;
    }
    const visibleMap = new Map(visibleFields);
    const used = new Set<string>();
    const sections: {title: string; entries: [string, AdminFieldConfig][]}[] = [];
    for (const fs of modelConfig.fieldsets) {
      const entries: [string, AdminFieldConfig][] = [];
      for (const key of fs.fields) {
        const cfg = visibleMap.get(key);
        if (cfg) {
          entries.push([key, cfg]);
          used.add(key);
        }
      }
      if (entries.length > 0) {
        sections.push({entries, title: fs.title});
      }
    }
    const remaining = visibleFields.filter(([k]) => !used.has(k));
    if (remaining.length > 0) {
      sections.push({entries: remaining, title: "Other"});
    }
    return sections;
  }, [modelConfig?.fieldsets, visibleFields]);

  if (isConfigLoading || !modelConfig) {
    return (
      <Page color="transparent" maxWidth="100%" padding={0}>
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  if (mode === "edit" && isItemLoading) {
    return (
      <Page color="transparent" maxWidth="100%" padding={0}>
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  const modelConfigs =
    config?.models.map((m: AdminModelConfig) => ({name: m.name, routePath: m.routePath})) ?? [];

  return (
    <Page color="transparent" maxWidth="100%" padding={0} scroll>
      {isWindowed && itemId && modelConfig.syncCollection && adminContext?.syncConflicts ? (
        <AdminConflictSheet
          collection={modelConfig.syncCollection}
          conflicts={adminContext.syncConflicts.conflicts}
          loadedIds={[itemId]}
          resolve={adminContext.syncConflicts.resolve}
        />
      ) : null}
      <Box gap={3} padding={4}>
        {isFormWritable || (mode === "edit" && canDeleteRecord) ? (
          <Box alignItems="center" direction="row" gap={2} wrap>
            {isFormWritable ? (
              <Button
                loading={isSaving}
                onClick={handleSave}
                testID="admin-save-button"
                text={mode === "create" ? "Create" : "Save"}
                variant="primary"
              />
            ) : null}
            {mode === "edit" && canDeleteRecord ? (
              <DeleteButton loading={isDeletePending} onDelete={handleDelete} />
            ) : null}
          </Box>
        ) : null}
        {fieldSections
          ? fieldSections.map((section, sectionIndex) => (
              <Accordion
                key={`admin-fieldset-${sectionIndex}-${section.title}`}
                title={section.title}
              >
                <Box gap={3}>
                  {section.entries.map(([fieldKey, fieldConfig]) => (
                    <AdminFieldRenderer
                      apiBase={resolvedApiBase}
                      autocompleteFields={modelConfig.autocompleteFields}
                      errorText={errors[fieldKey]}
                      fieldConfig={fieldConfig}
                      fieldKey={fieldKey}
                      key={fieldKey}
                      modelConfigs={modelConfigs}
                      onChange={getStableFieldChangeHandler(fieldKey)}
                      parentFormState={formState}
                      readOnly={readonlyKeySet.has(fieldKey)}
                      refRenderers={refRenderers}
                      routeBase={resolvedRouteBase}
                      value={formState[fieldKey]}
                    />
                  ))}
                </Box>
              </Accordion>
            ))
          : visibleFields.map(([fieldKey, fieldConfig]) => (
              <AdminFieldRenderer
                apiBase={resolvedApiBase}
                autocompleteFields={modelConfig.autocompleteFields}
                errorText={errors[fieldKey]}
                fieldConfig={fieldConfig}
                fieldKey={fieldKey}
                key={fieldKey}
                modelConfigs={modelConfigs}
                onChange={getStableFieldChangeHandler(fieldKey)}
                parentFormState={formState}
                readOnly={readonlyKeySet.has(fieldKey)}
                refRenderers={refRenderers}
                routeBase={resolvedRouteBase}
                value={formState[fieldKey]}
              />
            ))}
        {visibleFields.length === 0 && <EmptyFields />}
        {footerContent}
      </Box>
    </Page>
  );
};
