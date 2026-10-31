import {
  Box,
  Button,
  Card,
  type ColumnSortInterface,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  type DataTableColumnFilter,
  type DataTableCustomComponentMap,
  IconButton,
  Link,
  Page,
  printDateAndTime,
  Spinner,
  Text,
  useToast,
} from "@terreno/ui";
import type {Href} from "expo-router";
import {router, useNavigation} from "expo-router";
import startCase from "lodash/startCase";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {Pressable} from "react-native";
import {AdminActionMenu} from "./AdminActionMenu";
import {AdminConflictSheet} from "./AdminConflictSheet";
import {AdminRefField} from "./AdminRefField";
import {useAdminContext} from "./adminContext";
import {
  ADMIN_LIST_MAX_SELECTION,
  type AdminListFilterState,
  buildAdminListQueryParams,
} from "./adminModelListQueryParams";
import {isWindowedAdminTable, resolveWindowedTableRows} from "./adminWindowedTable";
import {
  clearAdminWindowMembershipStale,
  getAdminWindowMembershipStale,
  subscribeAdminWindowRefresh,
} from "./adminWindowRefresh";
import {ADMIN_SEARCH_DEBOUNCE_MS} from "./Constants";
import {shouldSkipOrgScopedAdminQuery} from "./orgs/shouldSkipOrgScopedAdminQuery";
import {useOptionalOrgContext} from "./orgs/useOrgContext";
import {
  type AdminFieldConfig,
  type AdminFieldValue,
  type AdminModelConfig,
  resolveAdminBases,
} from "./types";
import {useAdminBackgroundTaskMutation} from "./useAdminBackgroundTask";
import {useAdminConfig} from "./useAdminConfig";
import {useAdminModelApi} from "./useAdminModelApi";

interface AdminModelTableProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  modelName: string;
  columns?: string[];
  /**
   * Optional pixel widths for individual list columns, keyed by field name. Falls
   * back to {@link AdminModelConfig.listColumnWidths} from the backend, then to the
   * built-in column-type defaults. Useful when the default heuristics pick the wrong
   * width for a given model.
   */
  columnWidths?: Record<string, number>;
}

const ACTIONS_COLUMN_TYPE = "adminActions";
const LINK_COLUMN_TYPE = "adminLink";
const SELECT_COLUMN_TYPE = "adminSelect";
const INLINE_BOOL_COLUMN_TYPE = "adminInlineBool";

interface RefreshMembershipOptions {
  /** When false, skip the Refresh-failed toast. Settle retries stay silent until the last attempt. */
  reportError?: boolean;
}
const DATE_FIELD_NAMES = new Set(["created", "updated", "deleted"]);

const getRefRoutePath = (
  modelConfigs: Array<{name: string; routePath: string}> | undefined,
  refModelName: string | undefined
): string => {
  if (!refModelName) {
    return "";
  }
  return modelConfigs?.find((m) => m.name === refModelName)?.routePath ?? "";
};

const toColumnFilter = (
  filter: NonNullable<AdminModelConfig["filters"]>[number],
  fields: Record<string, AdminFieldConfig>,
  modelConfigs: Array<{name: string; routePath: string}>
): DataTableColumnFilter | undefined => {
  const label = filter.label ?? startCase(filter.field);
  if (filter.kind === "text") {
    return {field: filter.field, kind: "text", label};
  }
  if (filter.kind === "boolean") {
    return {field: filter.field, kind: "boolean", label};
  }
  if (filter.kind === "dateRange") {
    return {field: filter.field, kind: "dateRange", label};
  }
  if (filter.kind === "choice") {
    return {
      allowEmpty: filter.allowEmpty === true,
      field: filter.field,
      kind: "choice",
      label,
      options: filter.choices ?? [],
    };
  }
  if (filter.kind === "ref") {
    const refModelName =
      (filter as {refModel?: string}).refModel ?? fields[filter.field]?.ref ?? undefined;
    const routePath = getRefRoutePath(modelConfigs, refModelName);
    return {
      field: filter.field,
      kind: "choice",
      label,
      renderFilter: ({onChange, value}) => (
        <AdminRefField
          autocomplete
          onChange={(next: string) => onChange(next)}
          refModelName={refModelName ?? "Unknown"}
          routePath={routePath}
          testID={`admin-filter-${filter.field}`}
          title={label}
          value={String(value ?? "")}
        />
      ),
    };
  }
  return undefined;
};

/** A windowed create is queued in the outbox, so membership may need a few tries to catch up. */
const MEMBERSHIP_SETTLE_ATTEMPTS = 3;
const MEMBERSHIP_SETTLE_RETRY_MS = 700;

interface AdminListEnvelope {
  data: Array<Record<string, AdminFieldValue>>;
  total: number;
}

const getColumnType = (fieldKey: string, fieldConfig?: AdminFieldConfig): string => {
  if (fieldConfig) {
    if (fieldConfig.type === "boolean") {
      return "boolean";
    }
    if (fieldConfig.type === "number") {
      return "number";
    }
    if (fieldConfig.type === "date" || fieldConfig.type === "datetime") {
      return "date";
    }
  }
  if (DATE_FIELD_NAMES.has(fieldKey)) {
    return "date";
  }
  return "text";
};

const getColumnWidth = (fieldKey: string, columnType: string): number => {
  if (columnType === "boolean") {
    return 130;
  }
  if (columnType === "number") {
    return 130;
  }
  if (columnType === "date") {
    return 210;
  }
  if (fieldKey === "_id") {
    return 260;
  }
  if (fieldKey.toLowerCase().endsWith("id")) {
    return 240;
  }
  return 200;
};

const formatCellValue = (value: AdminFieldValue, columnType: string): string => {
  if (value == null) {
    return "";
  }
  if (columnType === "boolean") {
    return value ? "\u2713" : "";
  }
  if (columnType === "date") {
    return printDateAndTime(String(value), {defaultValue: String(value)});
  }
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (typeof value === "object") {
    return (value as {_id?: string})._id ?? JSON.stringify(value);
  }
  return String(value);
};

const buildSortString = (
  sort: ColumnSortInterface | undefined,
  displayFields: string[]
): string | undefined => {
  if (!sort) {
    return undefined;
  }
  const fieldKey = displayFields[sort.column];
  if (!fieldKey) {
    return undefined;
  }
  return sort.direction === "desc" ? `-${fieldKey}` : fieldKey;
};

const AdminLinkCell: React.FC<{column: DataTableColumn; cellData: DataTableCellData}> = ({
  cellData,
}) => {
  const {text, href} = cellData.value as {text: string; href: string};
  return <Link onClick={() => router.push(href as Href)} text={text} />;
};

const AdminActionsCell: React.FC<{column: DataTableColumn; cellData: DataTableCellData}> = ({
  cellData,
}) => {
  const {id, baseUrl, modelName, onDelete, deleteEnabled} = cellData.value as {
    id: string;
    baseUrl: string;
    modelName: string;
    onDelete: (id: string) => void;
    deleteEnabled: boolean;
  };
  const href = `${baseUrl}/${modelName}/${id}`;
  return (
    <Box alignItems="center" direction="row" gap={1} justifyContent="end">
      <IconButton
        accessibilityLabel="View"
        iconName="eye"
        onClick={() => router.push(href as Href)}
        tooltipText="View"
        variant="muted"
      />
      <IconButton
        accessibilityLabel="Edit"
        iconName="pen-to-square"
        onClick={() => router.push(href as Href)}
        tooltipText="Edit"
        variant="muted"
      />
      {deleteEnabled ? (
        <IconButton
          accessibilityLabel="Delete"
          confirmationText="Are you sure you want to delete this item?"
          iconName="trash"
          onClick={() => onDelete(id)}
          tooltipText="Delete"
          variant="destructive"
          withConfirmation
        />
      ) : null}
    </Box>
  );
};

const AdminSelectCell: React.FC<{column: DataTableColumn; cellData: DataTableCellData}> = ({
  cellData,
}) => {
  const {id, selected, onToggle} = cellData.value as {
    id: string;
    onToggle: (id: string, next: boolean) => void;
    selected: boolean;
  };
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{checked: selected}}
      onPress={() => onToggle(id, !selected)}
      testID={`admin-table-row-checkbox-${id}`}
    >
      <Box alignItems="center" justifyContent="center" padding={1}>
        <Text size="lg">{selected ? "\u2611" : "\u2610"}</Text>
      </Box>
    </Pressable>
  );
};

const AdminInlineBoolCell: React.FC<{column: DataTableColumn; cellData: DataTableCellData}> = ({
  cellData,
}) => {
  const {value, disabled, onToggle} = cellData.value as {
    disabled: boolean;
    onToggle: () => void;
    value: boolean;
  };
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked: Boolean(value), disabled}}
      disabled={disabled}
      onPress={() => !disabled && onToggle()}
    >
      <Box alignItems="center" justifyContent="center" padding={1}>
        <Text color={value ? "success" : "secondaryDark"} size="lg">
          {value ? "\u2713" : "\u2014"}
        </Text>
      </Box>
    </Pressable>
  );
};

const LoadingContent: React.FC = () => (
  <Box alignItems="center" justifyContent="center" padding={6}>
    <Spinner />
  </Box>
);

const EmptyContent: React.FC = () => (
  <Box alignItems="center" padding={6}>
    <Text color="secondaryDark">No items found.</Text>
  </Box>
);

/**
 * Table view for a specific admin model with pagination, sorting, filters, search,
 * optional bulk actions, and CRUD row actions.
 */
export const AdminModelTable: React.FC<AdminModelTableProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  modelName,
  columns: columnsProp,
  columnWidths,
}) => {
  const {apiBase: resolvedApiBase, routeBase: resolvedRouteBase} = resolveAdminBases({
    apiBase,
    baseUrl,
    routeBase,
  });
  const adminContext = useAdminContext();
  const {config, isLoading: isConfigLoading} = useAdminConfig(resolvedApiBase);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<ColumnSortInterface | undefined>();
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterState, setFilterState] = useState<AdminListFilterState>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const navigation = useNavigation();

  const organizationId = useOptionalOrgContext()?.organizationId;
  const modelConfig: AdminModelConfig | undefined = useMemo(
    () => config?.models.find((m: AdminModelConfig) => m.name === modelName),
    [config, modelName]
  );
  const skipOrgScopedQuery = shouldSkipOrgScopedAdminQuery({
    organizationId,
    organizationScoped: modelConfig?.organizationScoped,
  });
  const isWindowed = isWindowedAdminTable({
    modelConfig,
    syncDb: adminContext?.syncDb,
  });
  const syncCollection = modelConfig?.syncCollection;

  // Debounce search text for list queries.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, ADMIN_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
    };
  }, [searchText]);

  const filterSignature = useMemo(() => JSON.stringify(filterState), [filterState]);
  const sortSignature = useMemo(() => JSON.stringify(sortColumn), [sortColumn]);

  // Clear bulk selection when filters, search, or sort change.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedSearch, filterSignature, sortSignature]);

  // Reset to page 1 when search changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // Reset filter UI when switching models.
  useEffect(() => {
    if (!modelConfig) {
      return;
    }
    const next: AdminListFilterState = {};
    for (const f of modelConfig.filters ?? []) {
      if (f.kind === "boolean") {
        next[f.field] = undefined;
      } else if (f.kind === "dateRange") {
        next[`${f.field}_gte`] = "";
        next[`${f.field}_lte`] = "";
      } else {
        next[f.field] = "";
      }
    }
    setFilterState(next);
    setSelectedIds(new Set());
    setPage(1);
    setSearchText("");
    setDebouncedSearch("");
  }, [modelConfig]);

  const displayFields = useMemo(
    () => columnsProp ?? modelConfig?.listDisplay ?? modelConfig?.listFields ?? [],
    [columnsProp, modelConfig]
  );

  const linkFieldSet = useMemo(() => {
    const links = modelConfig?.listDisplayLinks;
    if (links && links.length > 0) {
      return new Set(links);
    }
    const first = displayFields[0];
    return new Set(first ? [first] : []);
  }, [displayFields, modelConfig?.listDisplayLinks]);

  const sortableFieldSet = useMemo(() => {
    const sf = modelConfig?.sortableFields;
    if (!sf || sf.length === 0) {
      return undefined;
    }
    return new Set(sf);
  }, [modelConfig?.sortableFields]);

  const pageLimit = modelConfig?.pageSize ?? 20;

  const sortString = useMemo(
    () => buildSortString(sortColumn, displayFields) ?? modelConfig?.defaultSort,
    [sortColumn, displayFields, modelConfig]
  );

  const listParams = useMemo(() => {
    if (!modelConfig) {
      return undefined;
    }
    return buildAdminListQueryParams({
      filterState,
      limit: pageLimit,
      modelConfig,
      page,
      searchDebounced: debouncedSearch,
      sort: sortString,
    });
  }, [debouncedSearch, filterState, modelConfig, page, pageLimit, sortString]);

  const {useListQuery, useDeleteMutation, useUpdateMutation, useBulkPatchMutation} =
    useAdminModelApi(modelConfig?.routePath ?? "", modelName);
  const {
    data: listData,
    isLoading: isListLoading,
    refetch,
  } = useListQuery(listParams, {skip: !modelConfig || skipOrgScopedQuery});
  const [storeEpoch, setStoreEpoch] = useState(0);
  const listParamsRef = useRef(listParams);
  listParamsRef.current = listParams;
  const refreshGenerationRef = useRef(0);
  const [deleteItem] = useDeleteMutation();

  // Invalidate in-flight Refresh when membership query params change or the table unmounts.
  useEffect(() => {
    return () => {
      refreshGenerationRef.current += 1;
    };
  }, [listParams]);
  const [patchItem] = useUpdateMutation();
  const [bulkPatch] = useBulkPatchMutation();
  const [enqueueBackground] = useAdminBackgroundTaskMutation(resolvedApiBase);

  const membershipRows = useMemo((): Array<Record<string, AdminFieldValue>> => {
    const envelope = listData as AdminListEnvelope | undefined;
    return (envelope?.data ?? []) as Array<Record<string, AdminFieldValue>>;
  }, [listData]);

  const membershipTotal = useMemo((): number => {
    const envelope = listData as AdminListEnvelope | undefined;
    return (envelope?.total as number | undefined) ?? 0;
  }, [listData]);

  const tableItems = useMemo((): Array<Record<string, AdminFieldValue>> => {
    if (!isWindowed || !adminContext?.syncDb || !syncCollection) {
      return membershipRows;
    }
    const restById = new Map<string, Record<string, AdminFieldValue>>();
    const membershipIds: string[] = [];
    for (const row of membershipRows) {
      const id = String(row._id ?? "");
      if (id.length === 0) {
        continue;
      }
      membershipIds.push(id);
      restById.set(id, row);
    }
    return resolveWindowedTableRows({
      collection: syncCollection,
      getEntity: adminContext.syncDb.store.getEntity,
      membershipIds,
      restById,
    });
  }, [adminContext?.syncDb, isWindowed, membershipRows, storeEpoch, syncCollection]);

  const deleteEnabled = modelConfig?.permissions?.delete !== false;
  const createEnabled = modelConfig?.permissions?.create !== false;
  const visibleActions = useMemo(
    () => (modelConfig?.actions ?? []).filter((action) => action.allowed !== false),
    [modelConfig?.actions]
  );
  const showSelectColumn = visibleActions.length > 0;

  const modelConfigs = useMemo(
    () => config?.models.map((m) => ({name: m.name, routePath: m.routePath})) ?? [],
    [config]
  );

  const handleFilterValuesChange = useCallback((next: Record<string, unknown>) => {
    setFilterState(next as AdminListFilterState);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((next: string) => {
    setSearchText(next);
  }, []);

  // Re-read the TinyBase overlay when known rows receive realtime admin deltas.
  useEffect(() => {
    if (!isWindowed || !adminContext?.syncDb || !syncCollection) {
      return;
    }
    const listenerId = adminContext.syncDb.store.raw.addTableListener(syncCollection, () => {
      setStoreEpoch((current) => current + 1);
    });
    return () => {
      adminContext.syncDb?.store.raw.delListener(listenerId);
    };
  }, [adminContext?.syncDb, isWindowed, syncCollection]);

  // Upsert the REST membership page into TinyBase for windowed admin lists.
  useEffect(() => {
    if (!isWindowed || !adminContext?.syncDb || !syncCollection) {
      return;
    }
    const ids: string[] = [];
    const restRows: Record<string, unknown> = {};
    for (const row of membershipRows) {
      const id = String(row._id ?? "");
      if (id.length === 0) {
        continue;
      }
      ids.push(id);
      restRows[id] = row;
    }
    let cancelled = false;
    void adminContext.syncDb
      .hydrateWindow({collection: syncCollection, ids, restRows})
      .then(() => {
        if (!cancelled) {
          setStoreEpoch((n) => n + 1);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          toastRef.current.catch(err, "Failed to load local rows");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adminContext?.syncDb, isWindowed, membershipRows, syncCollection]);

  /** Resolves to the refetched membership ids, or undefined when the refresh was abandoned. */
  const handleRefresh = useCallback(
    async (options?: RefreshMembershipOptions): Promise<string[] | undefined> => {
      if (!isWindowed || !adminContext?.syncDb || !syncCollection) {
        return undefined;
      }
      const shouldReportError = options?.reportError !== false;
      const generation = refreshGenerationRef.current + 1;
      refreshGenerationRef.current = generation;
      const paramsAtStart = listParamsRef.current;
      try {
        const result = (await refetch()) as
          | {data?: AdminListEnvelope; error?: unknown; isError?: boolean}
          | undefined;
        if (
          generation !== refreshGenerationRef.current ||
          paramsAtStart !== listParamsRef.current
        ) {
          return undefined;
        }
        if (result?.isError || result?.error) {
          if (shouldReportError) {
            toast.catch(result.error ?? new Error("Refresh failed"), "Refresh failed");
          }
          return undefined;
        }
        const rows = (result?.data?.data ?? membershipRows) as Array<
          Record<string, AdminFieldValue>
        >;
        const ids: string[] = [];
        const restRows: Record<string, unknown> = {};
        for (const row of rows) {
          const id = String(row._id ?? "");
          if (id.length === 0) {
            continue;
          }
          ids.push(id);
          restRows[id] = row;
        }
        await adminContext.syncDb.hydrateWindow({collection: syncCollection, ids, restRows});
        if (
          generation !== refreshGenerationRef.current ||
          paramsAtStart !== listParamsRef.current
        ) {
          return undefined;
        }
        setStoreEpoch((n) => n + 1);
        return ids;
      } catch (err) {
        if (
          generation !== refreshGenerationRef.current ||
          paramsAtStart !== listParamsRef.current
        ) {
          return undefined;
        }
        if (shouldReportError) {
          toast.catch(err, "Refresh failed");
        }
        return undefined;
      }
    },
    [adminContext?.syncDb, isWindowed, membershipRows, refetch, syncCollection, toast]
  );

  const handleRefreshRef = useRef(handleRefresh);
  handleRefreshRef.current = handleRefresh;
  const isMountedRef = useRef(true);

  // Stop the membership settle loop from scheduling work after the table goes away.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const membershipStale = useSyncExternalStore(
    subscribeAdminWindowRefresh,
    () => getAdminWindowMembershipStale(syncCollection),
    () => undefined
  );

  // Refetch membership after a windowed create or delete, which never touches the list cache.
  useEffect(() => {
    if (!isWindowed || !membershipStale || !syncCollection) {
      return;
    }
    // Claim the flag before awaiting so a remount does not start a second settle loop.
    clearAdminWindowMembershipStale({collection: syncCollection});
    const awaitId = membershipStale.awaitId;
    const settleMembership = async (): Promise<void> => {
      for (let attempt = 0; attempt < MEMBERSHIP_SETTLE_ATTEMPTS; attempt += 1) {
        const isLastAttempt = attempt === MEMBERSHIP_SETTLE_ATTEMPTS - 1;
        const ids = await handleRefreshRef.current({reportError: isLastAttempt});
        if (ids !== undefined && (!awaitId || ids.includes(awaitId))) {
          return;
        }
        // Failed refreshes and creates that have not appeared yet keep retrying
        // while mounted. An unmount is the only safe signal that this table no
        // longer owns settlement.
        if (!isMountedRef.current) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, MEMBERSHIP_SETTLE_RETRY_MS));
        if (!isMountedRef.current) {
          return;
        }
      }
    };
    void settleMembership();
  }, [isWindowed, membershipStale, syncCollection]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteItem(id).unwrap();
      } catch (err) {
        console.error("Failed to delete:", err);
      }
    },
    [deleteItem]
  );

  const toggleSelected = useCallback(
    (id: string, next: boolean) => {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        if (next) {
          if (n.size >= ADMIN_LIST_MAX_SELECTION) {
            toast.warn(`You can select at most ${ADMIN_LIST_MAX_SELECTION} rows.`);
            return prev;
          }
          n.add(id);
        } else {
          n.delete(id);
        }
        return n;
      });
    },
    [toast]
  );

  const toggleSelectPage = useCallback(() => {
    const ids = tableItems.map((row) => String(row._id));
    const allSelected = ids.length > 0 && ids.every((id: string) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const id of ids) {
          n.delete(id);
        }
        return n;
      });
      return;
    }
    setSelectedIds((prev) => {
      const n = new Set(prev);
      for (const id of ids) {
        if (n.size >= ADMIN_LIST_MAX_SELECTION) {
          break;
        }
        n.add(id);
      }
      if (ids.length > ADMIN_LIST_MAX_SELECTION) {
        toast.warn(`Only the first ${ADMIN_LIST_MAX_SELECTION} rows on this page can be selected.`);
      }
      return n;
    });
  }, [selectedIds, tableItems, toast]);

  // Drop selections a live admin tombstone removed, so bulk actions never target them.
  useEffect(() => {
    const visibleIds = new Set(tableItems.map((row) => String(row._id)));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const row of membershipRows) {
        const id = String(row._id ?? "");
        if (id.length > 0 && !visibleIds.has(id) && next.delete(id)) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [membershipRows, tableItems]);

  const runBulkAction = useCallback(
    async (actionId: string) => {
      if (!modelConfig) {
        return;
      }
      const action = visibleActions.find((a) => a.id === actionId);
      if (!action) {
        return;
      }
      const ids = [...selectedIds];
      if (ids.length === 0) {
        return;
      }
      if (action.background) {
        await enqueueBackground({
          ids,
          kind: action.id,
          metadata: {actionId: action.id},
          resourceRoute: modelConfig.routePath,
        }).unwrap();
        toast.success("Background task queued");
      } else if (action.patchKeys && action.patchKeys.length > 0) {
        const patch: Record<string, unknown> = {};
        for (const k of action.patchKeys) {
          patch[k] = true;
        }
        const result = (await bulkPatch({ids, patch}).unwrap()) as {
          failures?: {id: string; title: string}[];
          updated?: number;
        };
        if (Array.isArray(result.failures) && result.failures.length > 0) {
          toast.error(`Updated ${result.updated ?? 0}; ${result.failures.length} failed`);
          return;
        }
        toast.success("Bulk update applied");
      } else {
        toast.warn("This action has no bulk handler configured.");
      }
      setSelectedIds(new Set());
    },
    [bulkPatch, enqueueBackground, modelConfig, selectedIds, toast, visibleActions]
  );

  const handleInlineBooleanToggle = useCallback(
    async (rowId: string, fieldKey: string, next: boolean) => {
      try {
        await patchItem({body: {[fieldKey]: next}, id: rowId}).unwrap();
      } catch (err) {
        toast.catch(err, "Update failed");
      }
    },
    [patchItem, toast]
  );

  useEffect(() => {
    if (!modelConfig) {
      return;
    }
    navigation.setOptions({title: modelConfig.displayName});
  }, [navigation, modelConfig]);

  const customColumnComponentMap: DataTableCustomComponentMap = useMemo(
    () => ({
      [ACTIONS_COLUMN_TYPE]: AdminActionsCell,
      [INLINE_BOOL_COLUMN_TYPE]: AdminInlineBoolCell,
      [LINK_COLUMN_TYPE]: AdminLinkCell,
      [SELECT_COLUMN_TYPE]: AdminSelectCell,
    }),
    []
  );

  const additionalFilters = useMemo((): DataTableColumnFilter[] => {
    const adminFilters = modelConfig?.filters ?? [];
    return adminFilters
      .filter((filter) => !displayFields.includes(filter.field))
      .map((filter) => toColumnFilter(filter, modelConfig?.fields ?? {}, modelConfigs))
      .filter((filter): filter is DataTableColumnFilter => Boolean(filter));
  }, [displayFields, modelConfig, modelConfigs]);

  if (isConfigLoading || !modelConfig) {
    return (
      <Page color="transparent" maxWidth="100%" padding={0}>
        <LoadingContent />
      </Page>
    );
  }

  const adminFilters = modelConfig.filters ?? [];
  const dataColumns: DataTableColumn[] = displayFields.map((fieldKey) => {
    const fieldConfig = modelConfig.fields[fieldKey];
    const columnType = getColumnType(fieldKey, fieldConfig);
    const widthOverride = columnWidths?.[fieldKey] ?? modelConfig.listColumnWidths?.[fieldKey];
    const sortable =
      sortableFieldSet === undefined ? true : Boolean(sortableFieldSet.has(fieldKey));
    const isLink = linkFieldSet.has(fieldKey);
    const isInlineBool =
      fieldConfig?.type === "boolean" && modelConfig.permissions?.update !== false;
    const declaredFilter = adminFilters.find((filter) => filter.field === fieldKey);
    const filter = declaredFilter
      ? toColumnFilter(declaredFilter, modelConfig.fields, modelConfigs)
      : undefined;
    return {
      columnType: isInlineBool ? INLINE_BOOL_COLUMN_TYPE : isLink ? LINK_COLUMN_TYPE : columnType,
      filter,
      sortable,
      title: startCase(fieldKey),
      width: Math.max(
        widthOverride ?? getColumnWidth(fieldKey, columnType),
        declaredFilter ? 180 : 0
      ),
    };
  });

  const selectColumn: DataTableColumn | null = showSelectColumn
    ? {
        columnType: SELECT_COLUMN_TYPE,
        sortable: false,
        title: "",
        width: 48,
      }
    : null;

  const columns: DataTableColumn[] = [
    ...(selectColumn ? [selectColumn] : []),
    ...dataColumns,
    {
      columnType: ACTIONS_COLUMN_TYPE,
      sortable: false,
      title: "",
      width: deleteEnabled ? 140 : 100,
    },
  ];

  const listItems = tableItems;
  const data = listItems.map((item) => {
    const id = String(item._id ?? "");
    const selected = selectedIds.has(id);
    const selectCell = selectColumn ? [{value: {id, onToggle: toggleSelected, selected}}] : [];

    const fieldCells = displayFields.map((fieldKey) => {
      const fieldConfig = modelConfig.fields[fieldKey];
      const columnType = getColumnType(fieldKey, fieldConfig);
      const formatted = formatCellValue(item[fieldKey], columnType);
      const isLink = linkFieldSet.has(fieldKey);
      const isInlineBool =
        fieldConfig?.type === "boolean" && modelConfig.permissions?.update !== false;

      if (isInlineBool) {
        const recordCapabilities = item._adminCapabilities as {update?: boolean} | undefined;
        return {
          value: {
            disabled:
              recordCapabilities?.update === false || modelConfig.permissions?.update === false,
            onToggle: () => handleInlineBooleanToggle(id, fieldKey, !item[fieldKey]),
            value: Boolean(item[fieldKey]),
          },
        };
      }

      if (isLink) {
        return {
          value: {
            href: `${resolvedRouteBase}/${modelName}/${item._id}`,
            text: formatted,
          },
        };
      }

      return {
        value: formatted,
      };
    });

    const actionsCell = {
      value: {
        baseUrl: resolvedRouteBase,
        deleteEnabled,
        id,
        modelName,
        onDelete: handleDelete,
      },
    };
    return [...selectCell, ...fieldCells, actionsCell];
  });

  const totalPages = membershipTotal ? Math.ceil(membershipTotal / pageLimit) : 1;

  const pageIds = listItems.map((row) => String(row._id));
  const allPageSelected = pageIds.length > 0 && pageIds.every((id: string) => selectedIds.has(id));

  return (
    <Page color="transparent" maxWidth="100%" padding={0}>
      {isWindowed && syncCollection && adminContext?.syncConflicts ? (
        <AdminConflictSheet
          collection={syncCollection}
          conflicts={adminContext.syncConflicts.conflicts}
          loadedIds={pageIds}
          resolve={adminContext.syncConflicts.resolve}
        />
      ) : null}
      <Box gap={3} padding={0} testID={`admin-list-${modelName}`}>
        {createEnabled || isWindowed ? (
          <Box alignItems="center" direction="row" gap={2} wrap>
            {createEnabled ? (
              <Button
                onClick={() => router.push(`${resolvedRouteBase}/${modelName}/create` as Href)}
                testID="admin-create-button"
                text="Create"
                variant="primary"
              />
            ) : null}
            {isWindowed ? (
              <Button
                onClick={() => {
                  void handleRefresh();
                }}
                testID="admin-table-refresh"
                text="Refresh"
                variant="outline"
              />
            ) : null}
          </Box>
        ) : null}

        <Box alignItems="stretch" direction="column" gap={3} width="100%">
          <Box direction="column" flex="grow" gap={3} minWidth={0} width="100%">
            {showSelectColumn ? (
              <Card padding={3}>
                <Box alignItems="center" direction="row" gap={3} wrap>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{checked: allPageSelected}}
                    onPress={toggleSelectPage}
                    testID="admin-table-select-all"
                  >
                    <Box alignItems="center" justifyContent="center" padding={1}>
                      <Text size="lg">{allPageSelected ? "\u2611" : "\u2610"}</Text>
                    </Box>
                  </Pressable>
                  <Text color="secondaryDark" size="sm" testID="admin-table-selection-count">
                    {selectedIds.size} selected
                  </Text>
                  <AdminActionMenu
                    actions={visibleActions}
                    onRunAction={runBulkAction}
                    selectedCount={selectedIds.size}
                  />
                </Box>
              </Card>
            ) : null}

            <Card padding={2}>
              <DataTable
                additionalFilters={additionalFilters}
                columns={columns}
                customColumnComponentMap={customColumnComponentMap}
                data={isListLoading ? [] : data}
                emptyContent={isListLoading ? <LoadingContent /> : <EmptyContent />}
                filterValues={filterState}
                onFilterValuesChange={handleFilterValuesChange}
                onSearchChange={
                  modelConfig.searchFields && modelConfig.searchFields.length > 0
                    ? handleSearchChange
                    : undefined
                }
                page={page}
                pinnedColumns={selectColumn ? 1 : 0}
                search={searchText}
                searchFields={modelConfig.searchFields}
                setPage={setPage}
                setSortColumn={setSortColumn}
                sortColumn={sortColumn}
                totalPages={totalPages}
              />
            </Card>
          </Box>
        </Box>
      </Box>
    </Page>
  );
};
