import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {type FC, type ReactElement, useState} from "react";
import {Platform as ImportedPlatform, Text, View} from "react-native";

import {
  DataTableAdditionalFiltersWeb,
  DataTableColumnFilterWeb,
  DataTableFilterFields,
} from "./dataTableFilters";
import {renderWithTheme} from "./test-utils";

const enableWebPlatform = (): void => {
  const globalScope = globalThis as {document?: unknown; HTMLElement?: unknown};
  (ImportedPlatform as {OS: string}).OS = "web";
  globalScope.HTMLElement = class FakeHTMLElement {};
  globalScope.document = {body: {}};
};

const DraftHarness: FC<{
  filters: Parameters<typeof DataTableFilterFields>[0]["filters"];
  onDraftChange: (next: Record<string, unknown>) => void;
  showSearch?: boolean;
}> = ({filters, onDraftChange, showSearch = false}) => {
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});
  const [search, setSearch] = useState("");
  return (
    <DataTableFilterFields
      draftValues={draftValues}
      filters={filters}
      onDraftChange={(next) => {
        setDraftValues(next);
        onDraftChange(next);
      }}
      onSearchDraftChange={
        showSearch
          ? (next) => {
              setSearch(next);
            }
          : undefined
      }
      search={search}
      showSearch={showSearch}
    />
  );
};

describe("DataTableFilterFields", () => {
  it("updates text, boolean, date, number, and choice drafts", () => {
    const onDraftChange = mock(() => {});
    const {getByLabelText, getByTestId} = renderWithTheme(
      <DraftHarness
        filters={[
          {field: "name", kind: "text", label: "Name"},
          {field: "active", kind: "boolean", label: "Active"},
          {field: "created", kind: "dateRange", label: "Created"},
          {field: "age", kind: "numberRange", label: "Age"},
          {
            field: "role",
            kind: "choice",
            label: "Role",
            options: [
              {label: "Staff", value: "staff"},
              {label: "Admin", value: "admin"},
            ],
          },
        ]}
        onDraftChange={onDraftChange}
      />
    );

    fireEvent.changeText(getByTestId("data-table-filter-name"), "alice");
    expect(onDraftChange).toHaveBeenLastCalledWith({name: "alice"});

    fireEvent.press(getByTestId("data-table-filter-active.switch"));
    expect(onDraftChange).toHaveBeenLastCalledWith({active: true, name: "alice"});

    expect(getByTestId("data-table-filter-created-gte")).toBeTruthy();
    expect(getByTestId("data-table-filter-created-lte")).toBeTruthy();

    fireEvent.changeText(getByTestId("data-table-filter-age-gte"), "3");
    fireEvent.changeText(getByTestId("data-table-filter-age-lte"), "9");
    expect(onDraftChange).toHaveBeenLastCalledWith({
      active: true,
      age: {$gte: 3, $lte: 9},
      name: "alice",
    });

    fireEvent.press(getByLabelText("Staff"));
    expect(onDraftChange).toHaveBeenLastCalledWith({
      active: true,
      age: {$gte: 3, $lte: 9},
      name: "alice",
      role: ["staff"],
    });
  });

  it("emits a date range draft from a calendar date alone", () => {
    const onDraftChange = mock(() => {});
    const {getAllByPlaceholderText} = renderWithTheme(
      <DraftHarness
        filters={[{field: "created", kind: "dateRange", label: "Created"}]}
        onDraftChange={onDraftChange}
      />
    );

    const [fromMonth] = getAllByPlaceholderText("MM");
    const [fromDay] = getAllByPlaceholderText("DD");
    const [fromYear] = getAllByPlaceholderText("YYYY");
    fireEvent.changeText(fromMonth, "01");
    fireEvent.changeText(fromDay, "15");
    fireEvent.changeText(fromYear, "2026");

    expect(onDraftChange).toHaveBeenLastCalledWith({
      created_gte: "2026-01-15T00:00:00.000Z",
    });
  });

  it("emits an end-of-day upper bound so the chosen day is included", () => {
    const onDraftChange = mock(() => {});
    const {getAllByPlaceholderText} = renderWithTheme(
      <DraftHarness
        filters={[{field: "created", kind: "dateRange", label: "Created"}]}
        onDraftChange={onDraftChange}
      />
    );

    const toMonth = getAllByPlaceholderText("MM")[1];
    const toDay = getAllByPlaceholderText("DD")[1];
    const toYear = getAllByPlaceholderText("YYYY")[1];
    fireEvent.changeText(toMonth, "01");
    fireEvent.changeText(toDay, "15");
    fireEvent.changeText(toYear, "2026");

    expect(onDraftChange).toHaveBeenLastCalledWith({
      created_lte: "2026-01-15T23:59:59.999Z",
    });
  });

  it("clears a boolean filter and hosts a custom renderFilter", async () => {
    const onDraftChange = mock(() => {});
    const {getByTestId, rerender} = renderWithTheme(
      <DataTableFilterFields
        draftValues={{active: true}}
        filters={[{field: "active", kind: "boolean", label: "Active"}]}
        onDraftChange={onDraftChange}
        showFieldClear
      />
    );
    fireEvent.press(getByTestId("data-table-filter-active-clear"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onDraftChange).toHaveBeenCalledWith({active: undefined});

    rerender(
      <DataTableFilterFields
        draftValues={{owner: "abc"}}
        filters={[
          {
            field: "owner",
            kind: "choice",
            label: "Owner",
            renderFilter: ({onChange, value}) => (
              <View testID="custom-ref-filter">
                <Text>{String(value ?? "")}</Text>
                <Text
                  onPress={() => {
                    onChange("xyz");
                  }}
                  testID="custom-ref-set"
                >
                  set
                </Text>
              </View>
            ),
          },
        ]}
        onDraftChange={onDraftChange}
      />
    );
    expect(getByTestId("custom-ref-filter")).toBeTruthy();
    fireEvent.press(getByTestId("custom-ref-set"));
    expect(onDraftChange).toHaveBeenCalledWith({owner: "xyz"});
  });

  it("reads number range aliases without dollar prefixes", () => {
    const onDraftChange = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <DataTableFilterFields
        draftValues={{age: {gte: 1, lte: 2}}}
        filters={[{field: "age", kind: "numberRange", label: "Age"}]}
        onDraftChange={onDraftChange}
      />
    );
    expect(getByTestId("data-table-filter-age-gte").props.value).toBe("1");
    expect(getByTestId("data-table-filter-age-lte").props.value).toBe("2");
  });

  it("clears number range bounds when the inputs are emptied", async () => {
    const onDraftChange = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <DraftHarness
        filters={[{field: "age", kind: "numberRange", label: "Age"}]}
        onDraftChange={onDraftChange}
      />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("data-table-filter-age-gte"), "3");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("data-table-filter-age-lte"), "9");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 510));
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("data-table-filter-age-gte"), "");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("data-table-filter-age-lte"), "");
    });
    expect(onDraftChange).toHaveBeenLastCalledWith({age: {}});
  });

  it("maps a string choice draft onto MultiselectField", () => {
    const onDraftChange = mock(() => {});
    const {getByLabelText} = renderWithTheme(
      <DataTableFilterFields
        draftValues={{role: "staff"}}
        filters={[
          {
            field: "role",
            kind: "choice",
            label: "Role",
            options: [
              {label: "Staff", value: "staff"},
              {label: "Admin", value: "admin"},
            ],
          },
        ]}
        onDraftChange={onDraftChange}
      />
    );
    fireEvent.press(getByLabelText("Staff"));
    expect(onDraftChange).toHaveBeenCalledWith({role: []});
  });

  it("forwards search drafts when showSearch is enabled", () => {
    const onDraftChange = mock(() => {});
    const onSearchDraftChange = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <DataTableFilterFields
        draftValues={{}}
        filters={[]}
        onDraftChange={onDraftChange}
        onSearchDraftChange={onSearchDraftChange}
        search=""
        showSearch
      />
    );
    fireEvent.changeText(getByTestId("data-table-filter-search"), "bob");
    expect(onSearchDraftChange).toHaveBeenCalledWith("bob");
  });
});

describe("DataTableColumnFilterWeb", () => {
  const globalScope = globalThis as {document?: unknown; HTMLElement?: unknown};
  const originalDocument = globalScope.document;
  const originalHTMLElement = globalScope.HTMLElement;
  const originalPlatformOS = ImportedPlatform.OS;

  beforeEach(() => {
    enableWebPlatform();
  });

  afterEach(() => {
    (ImportedPlatform as {OS: string}).OS = originalPlatformOS;
    globalScope.document = originalDocument;
    globalScope.HTMLElement = originalHTMLElement;
  });

  it("calls onApply with merged filter values when Apply is pressed", async () => {
    const onApply = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <DataTableColumnFilterWeb
        appliedValues={{}}
        columnTitle="Name"
        filter={{field: "name", kind: "text"}}
        onApply={onApply}
        testID="name-filter"
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("name-filter.trigger"));
    });
    await waitFor(() => {
      expect(getByTestId("name-filter.apply")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("data-table-filter-name"), "alice");
    });
    await act(async () => {
      fireEvent.press(getByTestId("name-filter.apply"));
    });
    expect(onApply).toHaveBeenCalledWith({name: "alice"});
  });

  it("calls onApply with a single selected choice value", async () => {
    const onApply = mock(() => {});
    const {getByLabelText, getByTestId} = renderWithTheme(
      <DataTableColumnFilterWeb
        appliedValues={{}}
        columnTitle="Role"
        filter={{
          field: "role",
          kind: "choice",
          options: [
            {label: "Staff", value: "staff"},
            {label: "Admin", value: "admin"},
          ],
        }}
        onApply={onApply}
        testID="role-filter"
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("role-filter.trigger"));
    });
    await waitFor(() => {
      expect(getByLabelText("Staff")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByLabelText("Staff"));
      fireEvent.press(getByTestId("role-filter.apply"));
    });
    expect(onApply).toHaveBeenCalledWith({role: ["staff"]});
  });

  it("seeds date range drafts from applied values on open", async () => {
    const onApply = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <DataTableColumnFilterWeb
        appliedValues={{
          created_gte: "2024-01-01T00:00:00.000Z",
          created_lte: "2024-02-01T00:00:00.000Z",
        }}
        columnTitle="Created"
        filter={{field: "created", kind: "dateRange", label: "Created"}}
        onApply={onApply}
        testID="created-filter"
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("created-filter.trigger"));
    });
    await waitFor(() => {
      expect(getByTestId("data-table-filter-created-gte")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId("created-filter.apply"));
    });
    expect(onApply).toHaveBeenCalledWith({
      created_gte: "2024-01-01T00:00:00.000Z",
      created_lte: "2024-02-01T00:00:00.000Z",
    });
  });

  it("relies on the popover clear instead of a per-field clear", async () => {
    const onApply = mock(() => {});
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DataTableColumnFilterWeb
        appliedValues={{admin: true}}
        columnTitle="Admin user"
        filter={{field: "admin", kind: "boolean", label: "Admin user"}}
        onApply={onApply}
        testID="admin-filter"
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("admin-filter.trigger"));
    });
    await waitFor(() => {
      expect(getByTestId("admin-filter.clear")).toBeTruthy();
    });
    expect(queryByTestId("data-table-filter-admin-clear")).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId("admin-filter.clear"));
      fireEvent.press(getByTestId("admin-filter.apply"));
    });
    expect(onApply).toHaveBeenCalledWith({});
  });

  it("returns null on native platforms", () => {
    (ImportedPlatform as {OS: string}).OS = "ios";
    const {toJSON} = renderWithTheme(
      <DataTableColumnFilterWeb
        appliedValues={{}}
        columnTitle="Name"
        filter={{field: "name", kind: "text"}}
        onApply={() => {}}
        testID="name-filter"
      />
    );
    expect(toJSON()).toBeNull();
  });

  it("clears a text draft before Apply", async () => {
    const onApply = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <DataTableColumnFilterWeb
        appliedValues={{name: "bob"}}
        columnTitle="Name"
        filter={{field: "name", kind: "text"}}
        onApply={onApply}
        testID="name-filter"
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("name-filter.trigger"));
    });
    await waitFor(() => {
      expect(getByTestId("name-filter.clear")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId("name-filter.clear"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("name-filter.apply"));
    });
    expect(onApply).toHaveBeenCalledWith({});
  });
});

describe("DataTableAdditionalFiltersWeb", () => {
  const globalScope = globalThis as {document?: unknown; HTMLElement?: unknown};
  const originalDocument = globalScope.document;
  const originalHTMLElement = globalScope.HTMLElement;
  const originalPlatformOS = ImportedPlatform.OS;

  beforeEach(() => {
    enableWebPlatform();
  });

  afterEach(() => {
    (ImportedPlatform as {OS: string}).OS = originalPlatformOS;
    globalScope.document = originalDocument;
    globalScope.HTMLElement = originalHTMLElement;
  });

  it("keeps in-progress drafts when the filters array is recreated", async () => {
    const onApply = mock((_values: Record<string, unknown>) => {});
    const departmentFilter = {
      field: "department",
      kind: "choice" as const,
      label: "Department",
      options: [
        {label: "Engineering", value: "engineering"},
        {label: "Operations", value: "operations"},
      ],
    };
    const Harness = ({filters}: {filters: (typeof departmentFilter)[]}): ReactElement => {
      const [applied, setApplied] = useState<Record<string, unknown>>({});
      return (
        <DataTableAdditionalFiltersWeb
          appliedValues={applied}
          filters={filters}
          onApply={(next) => {
            setApplied(next);
            onApply(next);
          }}
        />
      );
    };
    const {getByLabelText, getByTestId, rerender} = renderWithTheme(
      <Harness filters={[departmentFilter]} />
    );
    await act(async () => {
      fireEvent.press(getByTestId("data-table-additional-filters.trigger"));
    });
    await waitFor(() => {
      expect(getByLabelText("Engineering")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByLabelText("Engineering"));
    });
    rerender(<Harness filters={[{...departmentFilter}]} />);
    await act(async () => {
      fireEvent.press(getByTestId("data-table-additional-filters.apply"));
    });
    expect(onApply).toHaveBeenCalledWith({department: ["engineering"]});
  });

  it("returns null on native platforms", () => {
    (ImportedPlatform as {OS: string}).OS = "ios";
    const {toJSON} = renderWithTheme(
      <DataTableAdditionalFiltersWeb
        appliedValues={{}}
        filters={[{field: "department", kind: "text", label: "Department"}]}
        onApply={() => {}}
      />
    );
    expect(toJSON()).toBeNull();
  });

  it("clears toolbar-only drafts then applies", async () => {
    const onApply = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <DataTableAdditionalFiltersWeb
        appliedValues={{department: "engineering"}}
        filters={[{field: "department", kind: "text", label: "Department"}]}
        onApply={onApply}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("data-table-additional-filters.trigger"));
    });
    await waitFor(() => {
      expect(getByTestId("data-table-additional-filters.clear")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId("data-table-additional-filters.clear"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("data-table-additional-filters.apply"));
    });
    expect(onApply).toHaveBeenCalledWith({});
  });

  it("cancels without applying", async () => {
    const onApply = mock(() => {});
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DataTableAdditionalFiltersWeb
        appliedValues={{}}
        filters={[{field: "department", kind: "text", label: "Department"}]}
        onApply={onApply}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("data-table-additional-filters.trigger"));
    });
    await waitFor(() => {
      expect(getByTestId("data-table-additional-filters.cancel")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId("data-table-additional-filters.cancel"));
    });
    expect(queryByTestId("data-table-additional-filters.apply")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
});
